#!/usr/bin/env bash

# Puts a conversation, already written as Markdown, on the claude-sessions
# branch of the repository the session works in, and prints its GitHub
# address. The file goes to <GitHub handle>/<date>-<title>.md, from the date of
# the session's first record and its title, and a session shared again
# replaces its earlier file, which a comment at its top names. The branch gets
# a README.md when it has none.
#
#   share-session.sh [--push | --dry-run] [--public] [-C repo] [--session id]
#                    <markdown file>
#
# The session is the one in CLAUDE_CODE_SESSION_ID unless --session names one.
# Without --push the commit stays on the local branch, and --dry-run only
# prints the address the file would get. A repository that gh does not show
# as private stops the share unless --public is given.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
branch=claude-sessions
remote=origin
repo=.
push=()
public=0
dry=0
session="${CLAUDE_CODE_SESSION_ID:-}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --push) push=(--push) ;;
    --dry-run) dry=1 ;;
    --public) public=1 ;;
    -C) repo="${2:-}"; shift ;;
    --session) session="${2:-}"; shift ;;
    -*) echo "share-session: unknown argument $1" >&2; exit 2 ;;
    *) break ;;
  esac
  shift
done
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "share-session: give the Markdown file" >&2; exit 2; }
markdown="$1"
case "$session" in "" | *[!A-Za-z0-9_-]*) echo "share-session: no session id" >&2; exit 2 ;; esac
top="$(git -C "$repo" rev-parse --show-toplevel)"
g() { git -C "$top" "$@"; }
url="$(g config --get "remote.$remote.url" || true)"
case "$url" in
  *github.com[:/]*) ;;
  *) echo "share-session: $remote of $top is no GitHub repository" >&2; exit 1 ;;
esac
name="${url#*github.com[:/]}"
name="${name%.git}"
if [ "$public" -eq 0 ] &&
  [ "$(GH_PROMPT_DISABLED=1 gh api "repos/$name" --jq .private 2>/dev/null || true)" != true ]; then
  echo "share-session: $name is public, or gh cannot read it, so nothing was shared; --public shares there anyway" >&2
  exit 1
fi

config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
transcript=
for f in "$config"/projects/*/"$session".jsonl; do
  [ -f "$f" ] && transcript="$f" && break
done
[ -n "$transcript" ] || { echo "share-session: no transcript for session $session" >&2; exit 1; }

handle="$(GH_PROMPT_DISABLED=1 gh api user --jq .login 2>/dev/null || true)"
case "$handle" in "" | *[!A-Za-z0-9-]*) echo "share-session: gh gives no GitHub handle; run gh auth login" >&2; exit 1 ;; esac

slug() {
  LC_ALL=C tr '[:upper:]' '[:lower:]' | LC_ALL=C sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-60 | sed -E 's/-+$//'
}
started="$(jq -r 'select((.timestamp | type) == "string") | .timestamp' "$transcript" | head -n 1)"
day="$(jq -rn --arg t "$started" '$t | sub("\\.[0-9]+Z\\z"; "Z") | fromdateiso8601 | localtime | strftime("%Y-%m-%d")')"
title="$(jq -r 'select(.type == "custom-title") | .customTitle // empty' "$transcript" | tail -n 1 | slug)"
[ -n "$title" ] || title="session-${session:0:8}"

if g ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
  g fetch --quiet "$remote" "+refs/heads/$branch:refs/remotes/$remote/$branch"
fi
tip="$(g rev-parse -q --verify "refs/heads/$branch" || g rev-parse -q --verify "refs/remotes/$remote/$branch" || true)"
marker="<!-- claude-session: $session -->"
path=
if [ -n "$tip" ]; then
  path="$(g grep -l -F -e "$marker" "$tip" -- "$handle/" 2>/dev/null | head -n 1 | sed "s#^$tip:##")" || true
fi
[ -n "$path" ] || path="$handle/$day-$title.md"
if [ "$dry" -eq 1 ]; then
  printf 'https://github.com/%s/blob/%s/%s\n' "$name" "$branch" \
    "$(jq -rn --arg p "$path" '$p | split("/") | map(@uri) | join("/")')"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
{ printf '%s\n\n' "$marker"; cat "$markdown"; } >"$tmp/session.md"
files=("$path" "$tmp/session.md")
if [ -z "$tip" ] || ! g cat-file -e "$tip:README.md" 2>/dev/null; then
  cat >"$tmp/README.md" <<'EOF'
# Claude Code sessions

Conversations with Claude Code that people working on this repository chose to share, one folder
per GitHub account and one Markdown file per session, named by the day it started and its title.
A session shared again replaces its file. This branch shares no history with the code branches and
is never merged into them.
EOF
  files+=(README.md "$tmp/README.md")
fi

"$here/write-to-branch.sh" -C "$top" --remote "$remote" ${push[@]+"${push[@]}"} \
  -m "Share $path" "$branch" "${files[@]}"
