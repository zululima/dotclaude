#!/usr/bin/env bash

# Claude Code UserPromptSubmit hook, wired twice. Run bare, as an async hook, it
# runs sync.sh of the dotclaude checkout, so every prompt brings GitHub's commits
# into the configuration directory and local edits into the checkout, without a
# prompt ever waiting on the network or on a credential prompt. It commits and
# pushes nothing, and skips its turn while another run holds the lock. An async
# hook's output reaches no one, so with --report it adds what the last run
# stopped on to the context, once per session for each failure. A run that only
# could not reach GitHub counts as clean. No checkout, or anything else missing,
# lets the prompt through without a word.

set -u

checkout="$HOME/Projects/dotclaude"
failure="$checkout/.git/claude-code-sync-failure"
[ -x "$checkout/sync.sh" ] || exit 0

if [ "${1:-}" != --report ]; then
  [ ! -e "$checkout/.git/sync.lock" ] || exit 0
  ssh_command="${GIT_SSH_COMMAND:-$(git -C "$checkout" config core.sshCommand 2>/dev/null || echo ssh)}"
  if output="$(GIT_TERMINAL_PROMPT=0 \
    GIT_ASKPASS=true \
    GIT_SSH_COMMAND="$ssh_command -o BatchMode=yes" \
    "$checkout/sync.sh" 2>&1 >/dev/null)"; then
    rm -f "$failure"
  else
    printf '%s\n' "$output" >"$failure"
  fi
  exit 0
fi

command -v jq >/dev/null 2>&1 || exit 0
[ -s "$failure" ] || exit 0
session="$(jq -r '.session_id // ""' 2>/dev/null)"
case "$session" in "" | *[^A-Za-z0-9_-]*) exit 0 ;; esac

dir="${TMPDIR:-/tmp}/claude-dotclaude-sync"
mkdir -p "$dir" 2>/dev/null || exit 0
find "$dir" -type f -mtime +7 -delete 2>/dev/null
sum="$(cksum <"$failure")"
[ "$(cat "$dir/$session" 2>/dev/null)" != "$sum" ] || exit 0
printf '%s\n' "$sum" >"$dir/$session" 2>/dev/null

jq -n --arg failure "$(cat "$failure")" '{hookSpecificOutput: {
  hookEventName: "UserPromptSubmit",
  additionalContext: "The dotclaude sync that runs at the start of each prompt stopped on this, so ~/.claude may lag behind GitHub. Name it in the reply in one line:\n\($failure)"
}}'
exit 0
