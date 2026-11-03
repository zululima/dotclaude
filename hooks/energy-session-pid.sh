#!/usr/bin/env bash

# Claude Code hook for SessionStart and UserPromptSubmit. The energy sampler in
# ~/.claude/energy groups each process under the Claude Code session that ran it,
# but a session's claude process carries no session id that another process can
# read. This writes the id into a file named after that process's pid, the first
# ancestor of this hook that is not a shell, at every start and prompt, since
# /clear gives the same process a new id. Without the sampler's log directory it
# does nothing.

set -u
dir="$HOME/Library/Logs/claude-energy/pids"
[ -d "$dir" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

session="$(jq -r '.session_id // ""' 2>/dev/null)"
case "$session" in "" | *[^A-Za-z0-9_-]*) exit 0 ;; esac

pid=$PPID
for _ in 1 2 3 4 5; do
  name="$(ps -o comm= -p "$pid" 2>/dev/null)"
  case "${name##*/}" in
    sh | bash | zsh | dash | -sh | -bash | -zsh) pid="$(ps -o ppid= -p "$pid" | tr -d ' ')" ;;
    "") exit 0 ;;
    *) break ;;
  esac
done
case "$pid" in "" | 0 | 1 | *[^0-9]*) exit 0 ;; esac

printf '%s\n' "$session" >"$dir/$pid" 2>/dev/null
exit 0
