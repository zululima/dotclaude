#!/usr/bin/env bash

# Claude Code Stop hook for the usage mod. Only a Stop hook's input lists the
# background work still in flight, since on a Team or Enterprise plan the
# engine's own security plugin keeps classic events from mods. When the turn
# ends with some, it writes the time into the session's file under
# usage-waiting/, and when it ends with none it empties that file. Then it
# rewrites the usage beacon, so every session's mod reads the folder again
# within seconds and puts a gear before the title of each session whose file is
# fresh. The session's own mod keeps the file fresh while its process runs.
# The mod also writes the time into usage-tasks/<session> when Claude shows the
# tasks pane and empties it when Claude closes the pane, so a turn that ends
# with no background work in flight and the pane still shown goes back once.

set -u

command -v jq >/dev/null 2>&1 || exit 0

read -r session count active < <(jq -r '"\(.session_id // "") \(.background_tasks // [] | length) \(.stop_hook_active // false)"' 2>/dev/null)
case "${session:-}" in ""|*[!A-Za-z0-9_-]*) exit 0 ;; esac
case "${count:-}" in ""|*[!0-9]*) count=0 ;; esac

dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
file="$dir/usage-waiting/$session"
if [ "$count" -gt 0 ]; then
  mkdir -p "$dir/usage-waiting" && date +%s > "$file"
  printf '%s\n' "$session" > "$dir/usage-beacon"
elif [ -s "$file" ]; then
  : > "$file"
  printf '%s\n' "$session" > "$dir/usage-beacon"
fi

if [ "$count" -eq 0 ] && [ "${active:-false}" = false ] && [ -s "$dir/usage-tasks/$session" ]; then
  echo "No background work is in flight, but the tasks pane Claude showed is still open. Call close_pane with tasks before the reply." >&2
  exit 2
fi
