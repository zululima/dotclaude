#!/usr/bin/env python3
"""Builds a pull request's review page: the steps of its How to verify?
section exactly as GitHub holds them, its screenshots embedded, and the
review's own results, findings and added steps from an optional overlay.

usage: build.py <owner/repo#n> [--out page.html] [--review overlay.json]

Without --out the page goes to .reviews/<repo>-<n>.html in the checkout the
command runs in, a folder this adds to the checkout's .git/info/exclude so
git never sees it.

The overlay is JSON:
  {"results": [{"name": "...", "outcome": "pass|fail|skip",
                "detail": "a few words, such as 119 of 119 on abc1234"}],
   "findings": [{"severity": "high|medium|low", "title": "...", "body": "...",
                 "step": "<step id>"}],
   "added_steps": [{"after": "<step id, or empty for before the first>",
                    "title": "...", "body": "..."}],
   "missed": [{"step": "<step id>", "text": "...", "fi": "..."}],
   "fi": {"<step id>": {"title": "...", "body": "..."},
          "section:<section slug>": {"title": "...", "note": "..."}}}
Findings come first on the page, as steps, and each miss shows inside the
step it concerns. A finding or a miss with "fixed": "<commit>" stays off
the page, since the reader has nothing left to do about it. With "fi" the
page is in Finnish: every step needs its title and text there, and each
miss its "fi", while the step's pictures come from the English step. Bodies are Markdown in the form the pull-requests skill
writes. Step ids are the section's slug and the step's number in the PR's list, such as
setup-2, while the page numbers the steps from 1 across all sections; build.py prints the ids.

Run it with python3 -I. It needs the gh CLI signed in to the PR's host.
It exits 1 after writing the page when a worktree other than the main
checkout holds the PR's branch, and names the command that frees it.
"""

import base64
import hashlib
import html
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.expanduser("~/.claude/drafts/review-page-images")
IMAGE_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp")

STRINGS = {
    "en": {
        "steps": "Steps", "step": "Step %d", "added": "Added by the review",
        "finding": "Finding %d, %s", "severity": {"high": "high", "medium": "medium", "low": "low"},
        "done_label": "Done: %s", "findings": "Findings",
        "findings_note": "Read these before the manual steps, so changes can be requested first.",
        "go_to_step": "Go to the step that shows it", "missed": "Missed in the PR",
        "before": "Before the steps", "failed": "Failed", "not_run": "Not run",
        "open_one": "1 open finding (%s), the first step below.",
        "open_many": "%d open findings (%s), the first steps below.",
        "copy": "Copy", "address": "address", "enlarge": "Enlarge %s", "screenshot": "Screenshot",
        "into": "%s into %s", "head": "head %s", "by": "By %s", "built": "Review built %s",
        "js": {
            "done": "done", "read": "read", "next": "next", "back": "back", "screenshot": "screenshot",
            "copies": "copies this", "noCommand": "This step has no command", "copied": "Copied",
            "selected": "Selected, press Cmd+C to copy", "noScreenshot": "This step has no screenshot",
            "pick": "Press j to pick a step first", "count": "%n of %t done",
            "noStorage": "This view cannot keep progress; ticks last until the page closes.",
        },
    },
    "fi": {
        "steps": "Vaiheet", "step": "Vaihe %d", "added": "Katselmoinnin lisäämä",
        "finding": "Havainto %d, %s", "severity": {"high": "vakava", "medium": "keskitason", "low": "vähäinen"},
        "done_label": "Tehty: %s", "findings": "Havainnot",
        "findings_note": "Lue nämä ennen käsin tehtäviä vaiheita, niin muutoksia voi pyytää ensin.",
        "go_to_step": "Siirry vaiheeseen, jossa se näkyy", "missed": "PR:stä puuttui",
        "before": "Ennen vaiheita", "failed": "Epäonnistui", "not_run": "Ei ajettu",
        "open_one": "1 avoin havainto (%s), ensimmäinen vaihe alla.",
        "open_many": "%d avointa havaintoa (%s), ensimmäiset vaiheet alla.",
        "copy": "Kopioi", "address": "osoite", "enlarge": "Suurenna %s", "screenshot": "Kuvakaappaus",
        "into": "%s haaraan %s", "head": "head %s", "by": "Tekijä %s", "built": "Koottu %s",
        "js": {
            "done": "tehty", "read": "luettu", "next": "seuraava", "back": "edellinen", "screenshot": "kuva",
            "copies": "kopioi tämän", "noCommand": "Tässä vaiheessa ei ole komentoa", "copied": "Kopioitu",
            "selected": "Valittu, kopioi Cmd+C:llä", "noScreenshot": "Tässä vaiheessa ei ole kuvaa",
            "pick": "Valitse vaihe ensin j:llä", "count": "%n / %t tehty",
            "noStorage": "Tämä näkymä ei voi tallentaa edistymistä, rastit säilyvät kunnes sivu suljetaan.",
        },
    },
}
UI = STRINGS["en"]


def gh_json(*args):
    out = subprocess.run(["gh", *args], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def fetch_image(url):
    """The image as a data URI, or None when it is no image, such as a video."""
    os.makedirs(CACHE, exist_ok=True)
    key = hashlib.sha256(url.encode()).hexdigest()[:32]
    meta_path = os.path.join(CACHE, key + ".type")
    body_path = os.path.join(CACHE, key + ".bin")
    if not os.path.exists(body_path):
        token = subprocess.run(
            ["gh", "auth", "token"], check=True, capture_output=True, text=True
        ).stdout.strip()
        # Private attachments answer only with the token, then redirect to a
        # signed storage address that refuses one. curl drops the header when
        # the redirect changes host; urllib would carry it along.
        result = subprocess.run(
            ["curl", "-sSfL", "-H", "@-", "-H", "Accept: application/octet-stream",
             "-o", body_path, "-w", "%{content_type}", url],
            input="Authorization: Bearer %s\n" % token,
            check=True, capture_output=True, text=True,
        )
        with open(meta_path, "w") as f:
            f.write(result.stdout.split(";")[0].strip())
    with open(meta_path) as f:
        content_type = f.read().strip()
    if content_type not in IMAGE_TYPES:
        return None
    with open(body_path, "rb") as f:
        return "data:%s;base64,%s" % (content_type, base64.b64encode(f.read()).decode())


def slug(text):
    text = re.sub(r"[^\w\s-]", "", text.lower(), flags=re.UNICODE)
    return re.sub(r"[\s_]+", "-", text).strip("-") or "steps"


CODE_SPAN = re.compile(r"`([^`]+)`")
BOLD = re.compile(r"\*\*(.+?)\*\*")
LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
AUTOLINK = re.compile(r"<(https?://[^>\s]+)>")


def inline(text):
    spans = []

    def keep(match):
        spans.append("<code>%s</code>" % html.escape(match.group(1)))
        return "\x00%d\x00" % (len(spans) - 1)

    text = CODE_SPAN.sub(keep, text)
    text = html.escape(text, quote=False)
    text = BOLD.sub(r"<strong>\1</strong>", text)
    text = LINK.sub(r'<a href="\2" target="_blank" rel="noopener">\1</a>', text)
    text = AUTOLINK.sub(r'<a href="\1" target="_blank" rel="noopener">\1</a>', text)
    return re.sub("\x00(\\d+)\x00", lambda m: spans[int(m.group(1))], text)


IMG_TAG = re.compile(r"<img\b[^>]*>", re.I)
ATTR = re.compile(r'(\w+)="([^"]*)"')
ATTACHMENT = re.compile(r"^https://github\.com/user-attachments/\S+$")


def render_image(tag):
    attrs = dict(ATTR.findall(tag))
    src = attrs.get("src", "")
    alt = attrs.get("alt", "")
    data = fetch_image(src) if src.startswith("https://") else None
    if not data:
        return '<p><a href="%s" target="_blank" rel="noopener">%s</a></p>' % (
            html.escape(src),
            html.escape(alt or "Attachment on GitHub"),
        )
    return (
        '<figure class="shot"><button type="button" class="zoom" aria-label="%s">'
        '<img src="%s" alt="%s"></button></figure>'
        % (html.escape(UI["enlarge"] % (alt or UI["screenshot"])), data, html.escape(alt))
    )


def render_shots(lines):
    """Only the pictures of a step, which its translation keeps."""
    out = []
    for line in lines:
        stripped = line.strip()
        if IMG_TAG.fullmatch(stripped):
            out.append(render_image(stripped))
        elif ATTACHMENT.match(stripped):
            out.append(render_image('<img src="%s" alt="Recording on GitHub">' % stripped))
    return "".join(out)


def render_blocks(lines):
    """Markdown lines, already dedented, to HTML: paragraphs, lists, fenced
    blocks with a copy button, pictures and bare attachment links."""
    out = []
    para = []
    items = []

    def flush():
        if para:
            out.append("<p>%s</p>" % inline(" ".join(para)))
            para.clear()
        if items:
            out.append("<ul>%s</ul>" % "".join("<li>%s</li>" % inline(i) for i in items))
            items.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        fence = re.match(r"^```(\w*)\s*$", stripped)
        if fence:
            flush()
            lang = fence.group(1) or "text"
            code = []
            i += 1
            while i < len(lines) and lines[i].strip() != "```":
                code.append(lines[i])
                i += 1
            body = "\n".join(code)
            if lang == "text" and re.fullmatch(r"https?://\S+", body.strip()):
                # An address to open: a link the reader clicks, and still copies.
                url = html.escape(body.strip())
                out.append(
                    '<div class="block" data-lang="address"><div class="block-bar"><span>%s</span>'
                    '<button type="button" class="copy">%s</button></div>'
                    '<pre><code><a href="%s" target="_blank" rel="noopener">%s</a></code></pre></div>'
                    % (UI["address"], UI["copy"], url, url)
                )
                i += 1
                continue
            out.append(
                '<div class="block" data-lang="%s"><div class="block-bar"><span>%s</span>'
                '<button type="button" class="copy">%s</button></div>'
                "<pre><code>%s</code></pre></div>"
                % (html.escape(lang), html.escape(lang), UI["copy"], html.escape(body))
            )
        elif IMG_TAG.fullmatch(stripped):
            flush()
            out.append(render_image(stripped))
        elif ATTACHMENT.match(stripped):
            flush()
            out.append(render_image('<img src="%s" alt="Recording on GitHub">' % stripped))
        elif not stripped:
            flush()
        elif re.match(r"^[-*] ", stripped):
            if para:
                flush()
            items.append(stripped[2:])
        elif items and line.startswith("  "):
            items[-1] += " " + stripped
        else:
            if items:
                flush()
            para.append(stripped)
        i += 1
    flush()
    return "".join(out)


def dedent(lines):
    widths = [len(l) - len(l.lstrip(" ")) for l in lines if l.strip()]
    cut = min(widths) if widths else 0
    return [l[cut:] if len(l) >= cut else l.lstrip(" ") for l in lines]


def parse_verify(body):
    """Sections of the How to verify? part, each with its note and steps."""
    body = re.sub(r"<!--.*?-->", "", body.replace("\r\n", "\n"), flags=re.S)
    match = re.search(r"^##\s+[^\n]*how to verify[^\n]*$", body, re.I | re.M)
    if not match:
        return []
    rest = body[match.end():]
    end = re.search(r"^##\s", rest, re.M)
    part = rest[: end.start()] if end else rest

    sections = []
    current = {"title": None, "note": [], "steps": []}

    def close():
        if current["steps"] or any(line.strip() for line in current["note"]):
            sections.append(dict(current))

    in_fence = False
    for line in part.split("\n"):
        if line.strip().startswith("```"):
            in_fence = not in_fence
        heading = None if in_fence else re.match(r"^###+\s+(.*)$", line)
        # A section titled in a bold paragraph, such as "**1. Title.** note".
        bold = None if in_fence else re.match(r"^\*\*(\d+\.\s+.+?)\.?\*\*\s*(.*)$", line)
        number = None if in_fence else re.match(r"^(\d+)\.\s+(.*)$", line)
        if heading:
            close()
            current = {"title": heading.group(1).strip(), "note": [], "steps": []}
        elif bold:
            close()
            current = {"title": bold.group(1).strip(), "note": [bold.group(2)], "steps": []}
        elif number:
            current["steps"].append({"n": int(number.group(1)), "first": number.group(2), "lines": []})
        elif current["steps"]:
            current["steps"][-1]["lines"].append(line)
        else:
            current["note"].append(line)
    close()

    used = set()
    result = []
    for section in sections:
        base = slug(section["title"] or "Steps")
        while base in used:
            base += "-x"
        used.add(base)
        steps = []
        for step in section["steps"]:
            lines = step["lines"]
            while lines and not lines[-1].strip():
                lines.pop()
            steps.append(
                {
                    "id": "%s-%d" % (base, step["n"]),
                    "n": step["n"],
                    "title": inline(step["first"]),
                    "body": render_blocks(dedent(lines)),
                    "shots": render_shots(lines),
                }
            )
        result.append(
            {"slug": base, "title": section["title"] or UI["steps"], "note": render_blocks(dedent(section["note"])),
             "steps": steps}
        )
    return result


def add_review_steps(sections, review):
    for k, extra in enumerate(review.get("added_steps", []), 1):
        lines = extra.get("body", "").split("\n")
        if not extra.get("after"):
            # Before the PR's first step, such as command steps the PR lacks.
            sections.insert(0, {"slug": "review", "title": UI["added"], "note": "", "steps": []})
            sections[0]["steps"].append(
                {
                    "id": "review-%d" % k,
                    "n": None,
                    "title": inline(extra["title"]),
                    "body": render_blocks(lines),
                    "shots": render_shots(lines),
                    "added": True,
                }
            )
            if len(sections) > 1 and sections[1]["slug"] == "review":
                sections[0]["steps"] = sections[1]["steps"] + sections[0]["steps"]
                del sections[1]
            continue
        for section in sections:
            ids = [s["id"] for s in section["steps"]]
            if extra["after"] in ids:
                at = ids.index(extra["after"]) + 1
                section["steps"].insert(
                    at,
                    {
                        "id": "%s-review-%d" % (extra["after"], k),
                        "n": None,
                        "title": inline(extra["title"]),
                        "body": render_blocks(lines),
                        "shots": render_shots(lines),
                        "added": True,
                    },
                )
                break
        else:
            sys.exit("added step %d: no step %s" % (k, extra["after"]))


def still_open(entries):
    return [e for e in entries if not e.get("fixed")]


def add_findings(sections, review):
    """The findings as the page's first steps, so changes can be requested
    before the manual pass starts."""
    findings = still_open(review.get("findings", []))
    if not findings:
        return
    steps = []
    for n, f in enumerate(findings, 1):
        lines = f.get("body", "").split("\n")
        tail = ""
        if f.get("step"):
            tail = '<p><a class="to-step" href="#%s" data-step="%s">%s</a></p>' % (
                f["step"], f["step"], UI["go_to_step"])
        steps.append(
            {
                "id": "finding-%d" % n,
                "n": n,
                "title": inline(f["title"]),
                "body": render_blocks(lines) + tail,
                "shots": render_shots(lines),
                "tail": tail,
                "finding": f["severity"],
            }
        )
    sections.insert(0, {
        "slug": "findings",
        "title": UI["findings"],
        "note": "<p>%s</p>" % UI["findings_note"],
        "steps": steps,
    })


def translate(sections, review):
    """Every step and miss in Finnish, from the overlay's fi, for the people
    who read the page; the PR's steps stay English."""
    fi = review.get("fi")
    if not fi:
        return
    steps = {s["id"]: s for section in sections for s in section["steps"]}
    known = set(steps) | {"section:" + section["slug"] for section in sections}
    unknown = sorted(set(fi) - known)
    if unknown:
        sys.exit("fi: no step or section %s" % ", ".join(unknown))
    missing = [i for i in steps if i not in fi]
    if missing:
        sys.exit("fi: no translation for %s" % ", ".join(missing))
    for m in still_open(review.get("missed", [])):
        if not m.get("fi"):
            sys.exit("missed: no fi for step %s" % m.get("step"))
    for section in sections:
        t = fi.get("section:" + section["slug"])
        if t:
            section["title"] = t.get("title", section["title"])
            if "note" in t:
                section["note"] = render_blocks(dedent(t["note"].split("\n")))
    for step_id, t in fi.items():
        if step_id in steps:
            step = steps[step_id]
            step["title"] = inline(t["title"])
            step["body"] = (step.get("shots", "") + render_blocks(dedent(t.get("body", "").split("\n")))
                            + step.get("tail", ""))


def add_missed(sections, review):
    missed = review.get("missed", [])
    if isinstance(missed, str):
        sys.exit("missed: give a list of {step, text}, each shown inside its step")
    by_id = {s["id"]: s for section in sections for s in section["steps"]}
    for m in still_open(missed):
        if m.get("step") not in by_id:
            sys.exit("missed: no step %s" % m.get("step"))
        text = m["fi"] if UI is STRINGS["fi"] else m["text"]
        by_id[m["step"]]["body"] = (
            '<div class="missed"><span class="missed-label">%s</span>%s</div>'
            % (UI["missed"], render_blocks(text.split("\n")))
        ) + by_id[m["step"]]["body"]


def render_review(review):
    """A notice above the steps, only when a check did not pass or a finding
    is still open; a review where all is well shows none."""
    results = review.get("results", [])
    for r in results:
        if len(r.get("detail", "")) > 60:
            sys.exit("result %r: keep the detail to a few words, such as the head it ran on and a count"
                     % r["name"])
    problems = [r for r in results if r["outcome"] != "pass"]
    findings = still_open(review.get("findings", []))
    if not problems and not findings:
        return ""
    parts = []
    if problems:
        rows = "".join(
            '<li class="result %s"><span class="pill">%s</span><span class="result-name">%s</span>'
            '<span class="result-detail">%s</span></li>'
            % (
                html.escape(r["outcome"]),
                html.escape({"fail": UI["failed"], "skip": UI["not_run"]}.get(r["outcome"], r["outcome"])),
                inline(r["name"]),
                inline(r.get("detail", "")),
            )
            for r in problems
        )
        parts.append('<ul class="results">%s</ul>' % rows)
    if findings:
        by = {}
        for f in findings:
            by[f["severity"]] = by.get(f["severity"], 0) + 1
        counts = ", ".join(
            "%d %s" % (by[k], UI["severity"][k]) for k in ("high", "medium", "low") if k in by)
        parts.append(
            "<p>%s</p>" % (UI["open_one"] % counts if len(findings) == 1
                           else UI["open_many"] % (len(findings), counts))
        )
    return (
        '<section class="review" aria-labelledby="review-h"><h2 id="review-h">%s</h2>%s</section>'
        % (UI["before"], "".join(parts))
    )


SHOT = re.compile(r'<figure class="shot">.*?</figure>', re.S)


def render_sections(sections):
    out = []
    count = 0
    for section in sections:
        steps = []
        for step in section["steps"]:
            if step.get("finding"):
                label = UI["finding"] % (step["n"], UI["severity"][step["finding"]])
                kind = " finding " + html.escape(step["finding"])
            elif step.get("added"):
                label, kind = UI["added"], " added"
            else:
                count += 1
                label, kind = UI["step"] % count, ""
            # The pictures leave the text, so the page can size them on their own.
            shots = "".join(SHOT.findall(step["body"]))
            if shots:
                kind += " has-shots"
            steps.append(
                '<li class="step%s" id="%s" data-id="%s" tabindex="-1">'
                '<button type="button" class="check" role="checkbox" aria-checked="false" aria-label="%s"></button>'
                '<div class="step-main"><div class="step-head"><div class="step-label">%s</div>'
                '<div class="step-title">%s</div></div>%s<div class="step-body">%s</div></div></li>'
                % (
                    kind,
                    step["id"],
                    step["id"],
                    html.escape(UI["done_label"] % re.sub("<[^>]+>", "", step["title"])),
                    label,
                    step["title"],
                    '<div class="step-shots">%s</div>' % shots if shots else "",
                    SHOT.sub("", step["body"]),
                )
            )
        out.append(
            '<section class="group"><h2>%s</h2>%s<ol class="steps">%s</ol></section>'
            % (html.escape(section["title"]), '<div class="note">%s</div>' % section["note"] if section["note"] else "", "".join(steps))
        )
    return "".join(out)


def default_out(name, number):
    top = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], check=True, capture_output=True, text=True
    ).stdout.strip()
    common = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    exclude = os.path.join(common, "info", "exclude")
    os.makedirs(os.path.dirname(exclude), exist_ok=True)
    lines = open(exclude).read().split("\n") if os.path.exists(exclude) else []
    if "/.reviews/" not in lines:
        with open(exclude, "a") as f:
            f.write(("" if not lines or lines[-1] == "" else "\n") + "/.reviews/\n")
    os.makedirs(os.path.join(top, ".reviews"), exist_ok=True)
    return os.path.join(top, ".reviews", "%s-%s.html" % (name, number))


def worktrees_holding(branch):
    listing = subprocess.run(
        ["git", "worktree", "list", "--porcelain"], check=True, capture_output=True, text=True
    ).stdout
    trees = [dict(line.split(" ", 1) for line in tree.splitlines() if " " in line) for tree in listing.split("\n\n")]
    # The first entry is the main checkout, where the reader's switch runs.
    return [t["worktree"] for t in trees[1:] if t.get("branch") == "refs/heads/" + branch]


def take(args, flag):
    if flag not in args:
        return None
    at = args.index(flag)
    value = args[at + 1]
    del args[at : at + 2]
    return value


def main():
    args = sys.argv[1:]
    review_path = take(args, "--review")
    out_path = take(args, "--out")
    review = {}
    if review_path:
        with open(review_path) as f:
            review = json.load(f)
    if len(args) != 1 or "#" not in args[0]:
        sys.exit(__doc__)
    repo, number = args[0].split("#")

    pr = gh_json(
        "pr", "view", number, "--repo", repo,
        "--json", "title,url,body,headRefName,baseRefName,headRefOid,author,updatedAt,isDraft",
    )
    global UI
    UI = STRINGS["fi" if review.get("fi") else "en"]
    sections = parse_verify(pr["body"])
    if not sections:
        sys.exit("%s#%s has no How to verify? section" % (repo, number))
    if review:
        add_review_steps(sections, review)
        add_findings(sections, review)
        translate(sections, review)
        add_missed(sections, review)

    with open(os.path.join(HERE, "template.html")) as f:
        page = f.read()
    name = repo.split("/")[-1]
    out_path = out_path or default_out(name, number)
    fields = {
        "TITLE": html.escape("Review PR %s" % number),
        "PR_TITLE": inline(pr["title"]),
        "PR_URL": html.escape(pr["url"]),
        "PR_REF": html.escape("%s#%s" % (repo, number)),
        "LANG": "fi" if UI is STRINGS["fi"] else "en",
        "BRANCH": html.escape(UI["into"] % (pr["headRefName"], pr["baseRefName"])),
        "HEAD": html.escape(UI["head"] % pr["headRefOid"][:7]),
        "AUTHOR": html.escape(UI["by"] % pr["author"]["login"]),
        "BUILT": html.escape(UI["built"] % datetime.now(timezone.utc).astimezone().strftime("%-d.%-m.%Y %H.%M")),
        "SCREENSHOT": html.escape(UI["screenshot"]),
        "UI_JSON": json.dumps(UI["js"], ensure_ascii=False).replace("</", "<\\/"),
        "REVIEW": render_review(review),
        "SECTIONS": render_sections(sections),
        "STORAGE_KEY": html.escape("review:%s#%s" % (repo, number)),
    }
    for key, value in fields.items():
        page = page.replace("{{%s}}" % key, value)
    with open(out_path, "w") as f:
        f.write(page)
    for section in sections:
        print(section["title"] + ": " + ", ".join(s["id"] for s in section["steps"]))
    print("wrote %s (%d kB)" % (out_path, os.path.getsize(out_path) // 1024))
    held = worktrees_holding(pr["headRefName"])
    if held:
        sys.exit(
            "%s is checked out in %s, so the reader's git switch to it fails. Free it before the reply:\n%s"
            % (pr["headRefName"], ", ".join(held), "\n".join("git -C %s switch --detach" % t for t in held))
        )


if __name__ == "__main__":
    main()
