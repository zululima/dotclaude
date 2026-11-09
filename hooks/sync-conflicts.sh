#!/usr/bin/env bash

# Claude Code UserPromptSubmit hook. When the configuration directory syncs
# between machines with Syncthing, a file both changed before they synced is
# kept twice: one version under its own name, the other beside it as
# <name>.sync-conflict-<date>-<time>-<device>.<ext>. Nothing else notices such a
# copy, so this hook lists every one in the context, once per session for each
# new set, for Claude to merge back. Folders that only ever hold one machine's
# runtime state are skipped. No copy, or jq missing, lets the prompt through
# without a word.

set -u

command -v jq >/dev/null 2>&1 || exit 0
config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
[ -d "$config" ] || exit 0
session="$(jq -r '.session_id // ""' 2>/dev/null)"
case "$session" in "" | *[^A-Za-z0-9_-]*) exit 0 ;; esac

found="$(find "$config" \( -path "$config/.stversions" -o -path "$config/telemetry" \
  -o -path "$config/session-env" -o -path "$config/shell-snapshots" \
  -o -path "$config/plugins" -o -path "$config/file-history" \) -prune \
  -o -name '*.sync-conflict-*' -print 2>/dev/null | sort)"
[ -n "$found" ] || exit 0

dir="${TMPDIR:-/tmp}/claude-sync-conflicts"
mkdir -p "$dir" 2>/dev/null || exit 0
find "$dir" -type f -mtime +7 -delete 2>/dev/null
sum="$(printf '%s\n' "$found" | cksum)"
[ "$(cat "$dir/$session" 2>/dev/null)" != "$sum" ] || exit 0
printf '%s\n' "$sum" >"$dir/$session" 2>/dev/null

count="$(printf '%s\n' "$found" | wc -l | tr -d ' ')"
list="$(printf '%s\n' "$found" | head -n 20 |
  awk -v home="$HOME/" 'index($0, home) == 1 { $0 = "~/" substr($0, length(home) + 1) } 1')"
[ "$count" -le 20 ] || list="$list
and $((count - 20)) more"

jq -n --arg count "$count" --arg list "$list" '{hookSpecificOutput: {
  hookEventName: "UserPromptSubmit",
  additionalContext: "Syncthing kept \($count) file(s) of the Claude Code configuration twice, because two machines changed them before they synced. Each copy below sits beside the file it is named after, the part from .sync-conflict- on left out. Merge each copy that still exists into that file, keeping what each version adds, delete the copy, and name each merge in the reply in one line:\n\($list)"
}}'
exit 0
