#!/usr/bin/env bash

# Claude Code status line command. A terminal session has no tool that reads
# the plan's usage limits, but the status line input carries them as
# rate_limits, on the plans that report them and after the session's first
# response. This keeps them in ~/.claude/plan-limits.json in the shape of the
# desktop app's usage card, for the dream workflow to read where that card is
# out of reach: the machine, the time written, and per window its label,
# percentUsed and resetsAt. Every session of the machine writes the one file,
# and an idle session repeats what it last saw, so a window on file gives way
# only to the same window further along or to a later one. The file is one
# machine's state: a configuration directory that syncs between machines
# leaves it out. The limits are also the line it prints. Without rate_limits
# it writes and prints nothing.

set -u
command -v jq >/dev/null 2>&1 || exit 0
file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plan-limits.json"
machine="$(uname -n | cut -d. -f1)"
old="$(cat "$file" 2>/dev/null)"
printf '%s' "$old" | jq -e . >/dev/null 2>&1 || old=null

next="$(jq -c --arg machine "$machine" --argjson old "$old" '
  . as $in | (now | floor) as $now
  | def window($key; $label):
      ($in.rate_limits // {})[$key]
      | select(type == "object" and (.resets_at | type) == "number" and (.used_percentage | type) == "number")
      | {label: $label, percentUsed: ((.used_percentage * 10 | round) / 10),
         resetsAt: (.resets_at | floor | todate), resetsEpoch: (.resets_at | floor)};
    [window("five_hour"; "5-hour limit"), window("seven_day"; "Weekly · all models")] as $new
  | (if ($old | type) == "object" and $old.machine == $machine then $old.windows // [] else [] end) as $kept
  | select($new | length > 0)
  | {machine: $machine, writtenAt: ($now | todate), writtenEpoch: $now,
     windows: (["5-hour limit", "Weekly · all models"] | map(. as $label
       | ($new | map(select(.label == $label and .resetsEpoch > $now)) | .[0]) as $n
       | ($kept | map(select(.label == $label and .resetsEpoch > $now)) | .[0]) as $o
       | if $n == null then $o
         elif $o == null or $n.resetsEpoch > $o.resetsEpoch + 300 then $n
         elif $n.resetsEpoch < $o.resetsEpoch - 300 or $n.percentUsed < $o.percentUsed then $o
         else $n end) | map(select(. != null)))}' 2>/dev/null)"
[ -n "$next" ] || exit 0

printf '%s\n' "$next" >"$file.$$" 2>/dev/null && mv -f "$file.$$" "$file" 2>/dev/null
printf '%s\n' "$next" | jq -r '[.windows[] | "\(.label | if test("hour") then "5h" else "week" end) \(.percentUsed)%"] | join(", ")'
