#!/usr/bin/env bash

# Claude Code PreToolUse hook on Bash. Refuses the gh commands that post on
# GitHub under the user's name: a comment, a review, a review thread reply, a
# comment on closing or reopening, and resolving a review thread. Exit code 2
# blocks the call in every permission mode, bypassPermissions included, and
# hands stderr to the model. It reads the command text only, so a mutation
# kept in a file passed with --input gets through.
#
# A gh pr review, gh pr comment, gh issue comment or a close or reopen with
# --comment passes when every word it posts is in a prompt the user typed in
# this session, as prompt-log.sh keeps them: each body, inline or in a
# --body-file, whitespace aside. An approval with no body posts no words and
# passes too.

set -u

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
[ -n "$cmd" ] || exit 0

# Quoted text is dropped before looking for a gh command, so a grep or a jq
# filter that names one does not count. A double-quoted string with a $ in it
# stays, since it may hold a $(gh ...).
code="$(printf '%s\n' "$cmd" | sed -E "s/'[^']*'//g; s/\"[^\"\$]*\"//g")"
gh='(^|[;&|({]|[[:space:]](do|then|else))[[:space:]]*([^[:space:];&|()]*/)?gh[[:space:]]+'

runs() {
  printf '%s\n' "$code" | grep -Eq -- "$gh$1"
}

block() {
  cat >&2 <<EOF
Blocked by ~/.claude/hooks/no-github-posts.sh: $1.
~/.claude/CLAUDE.md says never post a comment, a review thread reply, a review
or an issue comment on GitHub: every word posted goes out under the user's
name. A review or comment whose every word the user typed in a prompt of this
session passes, as does an approval with no body. Answer a review finding with
the commit that fixes it, and tell the user per thread what changed and in
which commit, so they can answer and resolve the threads themselves. Editing a
PR body, assigning, and closing or reopening without --comment stay allowed.
EOF
  exit 2
}

# Every body the command posts is in a prompt of this session.
worded_by_user() {
  local session log
  session="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)"
  log="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/prompt-log/$session.jsonl"
  [ -n "$session" ] && [ -f "$log" ] || return 1
  HOOK_CMD="$cmd" HOOK_CWD="$(printf '%s' "$input" | jq -r '.cwd // empty')" \
    python3 -I - "$log" <<'PY'
import json, os, re, shlex, sys

def norm(text):
    return re.sub(r"\s+", " ", text).strip()

prompts = []
with open(sys.argv[1], encoding="utf-8") as log:
    for line in log:
        try:
            prompt = json.loads(line).get("prompt", "")
        except ValueError:
            continue
        if prompt and not prompt.lstrip().startswith("<"):
            prompts.append(norm(prompt))

try:
    lexer = shlex.shlex(os.environ["HOOK_CMD"], posix=True, punctuation_chars=";&|()")
    lexer.whitespace_split = True
    tokens = list(lexer)
except ValueError:
    sys.exit(1)

posts = []
for i, token in enumerate(tokens):
    if os.path.basename(token) != "gh" or i + 2 >= len(tokens):
        continue
    args = []
    for t in tokens[i + 1:]:
        if t in (";", "&", "&&", "|", "||", "(", ")"):
            break
        args.append(t)
    if args[:2] in (["pr", "review"], ["pr", "comment"], ["issue", "comment"]) or (
        args[:2] in (["pr", "close"], ["pr", "reopen"], ["issue", "close"], ["issue", "reopen"])
        and any(a in ("-c", "--comment") or a.startswith("--comment=") for a in args)
    ):
        posts.append(args)

for args in posts:
    if args[1] in ("close", "reopen"):
        flags = {"-c": "body", "--comment": "body"}
    else:
        flags = {"-b": "body", "--body": "body", "-F": "file", "--body-file": "file"}
    bodies = []
    rest = iter(args[2:])
    for a in rest:
        name, _, value = a.partition("=")
        if name in flags and a.startswith("--") and "=" in a:
            kind = flags[name]
        elif a in flags:
            kind, value = flags[a], next(rest, None)
            if value is None:
                sys.exit(1)
        else:
            continue
        if kind == "file":
            if value == "-":
                sys.exit(1)
            path = os.path.join(os.environ.get("HOOK_CWD") or ".", os.path.expanduser(value))
            try:
                with open(path, encoding="utf-8") as f:
                    value = f.read()
            except OSError:
                sys.exit(1)
        bodies.append(norm(value))
    if not bodies:
        if args[:2] == ["pr", "review"] and any(a in ("-a", "--approve") for a in args):
            continue
        sys.exit(1)
    for body in bodies:
        if not body or not any(body in p for p in prompts):
            sys.exit(1)
sys.exit(0 if posts else 1)
PY
}

if runs '(pr|issue)[[:space:]]+comment'; then
  worded_by_user || block "gh pr comment and gh issue comment post a comment"
fi
if runs 'pr[[:space:]]+review'; then
  worded_by_user || block "gh pr review posts a review"
fi
if runs '(pr|issue)[[:space:]]+(close|reopen)[^;&|]*[[:space:]](-c|--comment)([[:space:]=]|$)'; then
  worded_by_user || block "--comment on a close or a reopen posts a comment"
fi

runs 'api[[:space:]]' || exit 0
printf '%s\n' "$cmd" |
  grep -Eq 'add(Discussion)?Comment|addPullRequestReview|submitPullRequestReview|update(IssueComment|PullRequestReview)|resolveReviewThread' &&
  block "the GraphQL mutation posts, edits or resolves as the user"
call="$(printf '%s\n' "$cmd" | grep -oE 'gh[[:space:]]+api[[:space:]][^;&|]*' |
  grep -E '(issues|pulls)/[^[:space:]]*(comments|replies|reviews)')" || exit 0
printf '%s\n' "$call" | grep -Eq "(-X|--method)[[:space:]=]*[\"']?(POST|PATCH|PUT)" &&
  block "the call writes a comment, a reply or a review"
printf '%s\n' "$call" | grep -Eq '[[:space:]](-f|-F|--field|--raw-field|--input)([[:space:]=]|$)' &&
  ! printf '%s\n' "$call" | grep -Eq "(-X|--method)[[:space:]=]*[\"']?GET" &&
  block "gh api sends fields as a POST without -X GET, so the call writes to a comments, replies or reviews path; add -X GET to read"
exit 0
