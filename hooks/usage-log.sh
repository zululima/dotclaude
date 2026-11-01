#!/usr/bin/env bash

# Claude Code Stop hook. Appends one record per model response to
# ~/.claude/usage-log/<YYYY-MM>.jsonl: its id, time, model, tokens by kind,
# the seconds it ran and its inference_geo, so a week's tokens, cost, energy and
# CO2e can be totalled with usage.sh --since long after cleanupPeriodDays has
# deleted the transcripts. A transcript is read again only when it has grown,
# and only responses after the last one logged from it are added.
#
#   usage-log.sh          as a Stop hook: the session's transcript and its agents
#   usage-log.sh --all    every transcript under projects/, which also backfills

set -u
command -v jq >/dev/null 2>&1 || exit 0
root="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
usage="$HOME/.claude/mods/session-usage/usage.sh"
[ -x "$usage" ] || exit 0
log="$root/usage-log"
state="$log/.state"
mkdir -p "$state" 2>/dev/null || exit 0

if [ "${1:-}" = --all ]; then
  files=$(find "$root/projects" -name '*.jsonl' -type f 2>/dev/null)
else
  transcript=$(jq -r '.transcript_path // empty' 2>/dev/null)
  [ -f "$transcript" ] || exit 0
  files=$(printf '%s\n' "$transcript"; find "${transcript%.jsonl}" -name '*.jsonl' -type f 2>/dev/null)
fi

printf '%s\n' "$files" | while IFS= read -r f; do
  [ -f "$f" ] || continue
  key="$state/$(printf '%s' "$f" | shasum | cut -c1-20)"
  seen_size=0
  after=0
  [ -f "$key" ] && read -r seen_size after < "$key"
  size=$(stat -c %s "$f" 2>/dev/null || stat -f %z "$f" 2>/dev/null || echo 0)
  [ "$size" != "$seen_size" ] || continue
  latest=$("$usage" --log "${after:-0}" "$f" \
    | jq -r '"\(.at | floor | todate | .[0:7])\t\(.at)\t\(tojson)"' 2>/dev/null \
    | awk -F '\t' -v dir="$log" -v latest="${after:-0}" '
        { print $3 >> (dir "/" $1 ".jsonl"); if ($2 + 0 > latest + 0) latest = $2 }
        END { print latest }')
  echo "$size ${latest:-$after}" > "$key"
done
exit 0
