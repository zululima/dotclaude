"""Ranks where the battery went, from the energy sampler's log and the prompt log.

Run with python3 -I. Prints Markdown tables: the battery's total, from its charge counter, the
share of Claude Code sessions, the Claude app, other apps and the rest of the Mac, then the
sessions and the prompts that used the most. A prompt is charged for its session's energy from the
moment it arrived until the session's next prompt. Joules of commands too short for the sampler to
see running are estimated from their CPU time, and the tables count them in. Where the root daemon
that install-root.sh starts logged the chip's measured power, those commands are priced from the
chip's CPU joules, the GPU's joules are shared out by GPU time, and root processes, the GPU left
over, the Neural Engine and the screen with the rest of the Mac get rows of their own; elsewhere
they are priced at a busy core's rate.

  report.py [--since <YYYY-MM-DD or YYYY-MM-DDTHH:MM>] [--until <same>] [--top <n>] [--logs <dir>]
            [--chip <dir>]

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
CHIP = "/Library/Logs/claude-energy"
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


def chip_joules(line, kind):
    seconds = line.get("elapsed_ns", 0) / 1e9
    if kind + "_power" in line and seconds:
        return line[kind + "_power"] / 1000 * seconds
    return line.get(kind + "_energy", 0) / 1000


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
    parser.add_argument("--chip", default=CHIP)
    args = parser.parse_args()
    today = datetime.datetime.combine(datetime.date.today(), datetime.time()).timestamp()
    since = moment(args.since) if args.since else today
    until = moment(args.until) if args.until else datetime.datetime.now().timestamp()

    lines = list(samples(args.logs, since, until))
    if not lines:
        print("No samples on battery in that span. Is the energy sampler installed and running?")
        return
    first, last = lines[0], lines[-1]
    seconds = sum(sample["dt"] for sample in lines)
    battery = sum(sample["b"] if "b" in sample else sample["w"] * sample["dt"] for sample in lines)

    def share(joules):
        return "%.0f%%" % (100 * joules / battery) if battery > 0 else "?"

    # A line is measured when the root log covers it and it has the CPU time of every process.
    # Then the chip's CPU joules that no process seen running used are shared between the
    # commands that ran between two lines and the processes this user cannot read, by CPU time.
    chip_lines = [line for line in samples(args.chip, since, until) if "elapsed_ns" in line]
    chip_times = [line["t"] for line in chip_lines]

    def has_chip(sample):
        i = bisect.bisect_right(chip_times, sample["t"] - sample["dt"] - 10)
        return i < len(chip_times) and chip_times[i] <= sample["t"] + 10

    measured = [sample for sample in lines if "cs" in sample and has_chip(sample)]
    measured_seconds = sum(sample["dt"] for sample in measured)
    chip = collections.Counter()
    chip_seconds = sum(line["elapsed_ns"] for line in chip_lines) / 1e9
    for line in chip_lines:
        for kind in ("cpu", "gpu", "ane"):
            chip[kind] += chip_joules(line, kind) * measured_seconds / chip_seconds
    seen = sum(use["j"] for sample in measured for use in sample["g"].values())
    unseen = sum(use["u"] for sample in measured for use in sample["g"].values())
    others = sum(sample["cs"] - sum(use["c"] + use["u"] for use in sample["g"].values())
                 for sample in measured)
    price = max(chip["cpu"] - seen, 0) / (unseen + max(others, 0)) if unseen + others > 0 else 0
    measured_ids = {id(sample) for sample in measured}

    groups = collections.Counter()
    estimated = collections.Counter()
    gpu = collections.Counter()
    all_gpu = 0.0
    session_samples = collections.defaultdict(list)
    for sample in lines:
        is_measured = id(sample) in measured_ids
        all_gpu += sample["gt"] if is_measured else 0
        for name, use in sample["g"].items():
            short = use["u"] * min(price, sample["r"]) if is_measured else use["uj"]
            joules = use["j"] + short
            groups[name] += joules
            estimated[name] += short
            if is_measured:
                gpu[name] += use["g"]
            if name.startswith("session:"):
                session_samples[name[8:]].append((sample["t"] - sample["dt"] / 2, joules))
    processes = sum(groups.values())
    measured_processes = seen + sum(
        use["u"] * min(price, sample["r"]) for sample in measured for use in sample["g"].values())
    for name in groups:
        if all_gpu > 0:
            groups[name] += chip["gpu"] * gpu[name] / all_gpu

    span = "%s to %s" % (
        datetime.datetime.fromtimestamp(first["t"]).strftime("%Y-%m-%d %H:%M"),
        datetime.datetime.fromtimestamp(last["t"]).strftime("%H:%M"),
    )
    sessions_total = sum(j for name, j in groups.items() if name.startswith("session:"))
    apps = [(name, j) for name, j in groups.items() if not name.startswith("session:")]
    apps.sort(key=lambda item: -item[1])
    print("On battery %s: %.1f h, %d%% to %d%%, %.1f Wh at %.1f W on average." % (
        span, seconds / 3600, first["pct"], last["pct"], battery / 3600,
        battery / seconds if seconds else 0))
    if seconds < 600:
        print("The battery's charge counter moves about once a minute, so under 10 minutes the"
              " total is rough.")
    if measured_seconds:
        print("The chip, measured by powermetrics over %.0f of %.0f minutes: CPU %.1f W, GPU %.1f W,"
              " Neural Engine %.1f W.\n" % (
                  measured_seconds / 60, seconds / 60, chip["cpu"] / measured_seconds,
                  chip["gpu"] / measured_seconds, chip["ane"] / measured_seconds))
    else:
        print("No powermetrics log for this span, so the screen, the GPU and root processes share"
              " the last row, and short commands are priced at a busy core's rate, an upper"
              " bound.\n")
    rows = [("Claude Code sessions", "%.0f" % sessions_total, share(sessions_total))]
    rows += [(name, "%.0f" % j, share(j)) for name, j in apps[:args.top]]
    if measured_seconds:
        extra = [
            ("Root and system processes, CPU", max(chip["cpu"] - measured_processes, 0)),
            ("GPU for the screen and other processes",
             chip["gpu"] * max(1 - sum(gpu.values()) / all_gpu, 0) if all_gpu > 0 else chip["gpu"]),
            ("Neural Engine", chip["ane"]),
        ]
        rest = battery - sum(groups.values()) - sum(j for _, j in extra)
        extra.append(("Screen and the rest of the Mac", rest))
        rows += [(name, "%.0f" % j, share(j)) for name, j in extra]
    else:
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
