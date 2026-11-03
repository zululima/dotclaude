"""Ranks where the battery went, from the energy sampler's log and the prompt log.

Run with python3 -I. Prints Markdown tables: the battery's total, the share of Claude Code
sessions, the Claude app, other apps and the rest of the Mac, then the sessions and the prompts
that used the most. A prompt is charged for its session's energy from the moment it arrived until
the session's next prompt. Joules of commands too short for the sampler to see running are
estimated from their CPU time, and the tables count them in.

  report.py [--since <YYYY-MM-DD or YYYY-MM-DDTHH:MM>] [--until <same>] [--top <n>] [--logs <dir>]

--since defaults to the start of today, local time.
"""

import argparse
import bisect
import collections
import datetime
import json
import os
import re

LOGS = os.path.expanduser("~/Library/Logs/claude-energy")
PROMPTS = os.path.expanduser("~/.claude/prompt-log")


def moment(text):
    return datetime.datetime.fromisoformat(text).timestamp()


def samples(logs, since, until):
    day = datetime.date.fromtimestamp(since)
    while datetime.datetime.combine(day, datetime.time()).timestamp() <= until:
        path = os.path.join(logs, day.isoformat() + ".jsonl")
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    try:
                        sample = json.loads(line)
                    except ValueError:
                        continue
                    if since <= sample["t"] <= until:
                        yield sample
        day += datetime.timedelta(days=1)


def snippet(prompt):
    text = re.sub(r"<pasted_content[^>]*>.*?</pasted_content[^>]*>", "[pasted]", prompt, flags=re.S)
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S)
    tag = re.match(r"\s*<([a-z-]+)", text)
    if tag:
        text = "[" + tag.group(1) + "]"
    text = " ".join(text.split()).replace("|", "/")
    return text[:70] + ("..." if len(text) > 70 else "")


def prompt_log(sessions):
    prompts = {}
    for session in sessions:
        path = os.path.join(PROMPTS, session + ".jsonl")
        entries = []
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    try:
                        entry = json.loads(line)
                        when = moment(entry["timestamp"].replace("Z", "+00:00"))
                    except (ValueError, KeyError):
                        continue
                    entries.append((when, entry.get("cwd", ""), entry.get("prompt", "")))
        entries.sort()
        prompts[session] = entries
    return prompts


def project(cwd):
    if "/scratch-workspaces/" in cwd:
        return "No folder"
    return os.path.basename(cwd.rstrip("/")) or "?"


def table(header, rows):
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since")
    parser.add_argument("--until")
    parser.add_argument("--top", type=int, default=10)
    parser.add_argument("--logs", default=LOGS)
    args = parser.parse_args()
    today = datetime.datetime.combine(datetime.date.today(), datetime.time()).timestamp()
    since = moment(args.since) if args.since else today
    until = moment(args.until) if args.until else datetime.datetime.now().timestamp()

    battery = seconds = 0.0
    first = last = None
    groups = collections.Counter()
    estimated = collections.Counter()
    session_samples = collections.defaultdict(list)
    for sample in samples(args.logs, since, until):
        battery += sample["w"] * sample["dt"]
        seconds += sample["dt"]
        first = first or sample
        last = sample
        for name, use in sample["g"].items():
            joules = use["j"] + use["uj"]
            groups[name] += joules
            estimated[name] += use["uj"]
            if name.startswith("session:"):
                session_samples[name[8:]].append((sample["t"] - sample["dt"] / 2, joules))
    if not first:
        print("No samples on battery in that span. Is the energy sampler installed and running?")
        return

    def share(joules):
        return "%.0f%%" % (100 * joules / battery) if battery > 0 else "?"

    span = "%s to %s" % (
        datetime.datetime.fromtimestamp(first["t"]).strftime("%Y-%m-%d %H:%M"),
        datetime.datetime.fromtimestamp(last["t"]).strftime("%H:%M"),
    )
    sessions_total = sum(j for name, j in groups.items() if name.startswith("session:"))
    apps = [(name, j) for name, j in groups.items() if not name.startswith("session:")]
    apps.sort(key=lambda item: -item[1])
    processes = sum(groups.values())
    print("On battery %s: %.1f h, %d%% to %d%%, %.1f Wh at %.1f W on average.\n" % (
        span, seconds / 3600, first["pct"], last["pct"], battery / 3600,
        battery / seconds if seconds else 0))
    rows = [("Claude Code sessions", "%.0f" % sessions_total, share(sessions_total))]
    rows += [(name, "%.0f" % j, share(j)) for name, j in apps[:args.top]]
    rest = battery - processes
    rows.append(("Screen, GPU, root processes and the rest", "%.0f" % rest, share(rest)))
    print(table(("Where it went", "Joules", "Share"), rows))

    prompts = prompt_log(session_samples)
    by_session = sorted(session_samples, key=lambda s: -groups["session:" + s])
    rows = []
    for session in by_session[:args.top]:
        entries = prompts.get(session) or [(0, "", "")]
        joules = groups["session:" + session]
        rows.append((
            session[:8], project(entries[-1][1]), "%.0f" % joules, share(joules),
            "%.0f%%" % (100 * estimated["session:" + session] / joules) if joules else "0%",
            snippet(entries[0][2]),
        ))
    print("\n" + table(
        ("Session", "Project", "Joules", "Share", "Short commands", "First prompt"), rows))

    charged = collections.Counter()
    for session, use in session_samples.items():
        entries = prompts.get(session, [])
        times = [entry[0] for entry in entries]
        for when, joules in use:
            i = bisect.bisect_right(times, when) - 1
            charged[(session, i)] += joules
    rows = []
    for (session, i), joules in charged.most_common(args.top):
        entries = prompts.get(session, [])
        when, cwd, prompt = entries[i] if i >= 0 else (0, "", "(before its first logged prompt)")
        rows.append((
            datetime.datetime.fromtimestamp(when).strftime("%m-%d %H:%M") if when else "?",
            session[:8], project(cwd), "%.0f" % joules, share(joules), snippet(prompt),
        ))
    print("\n" + table(("Prompt at", "Session", "Project", "Joules", "Share", "Prompt"), rows))


main()
