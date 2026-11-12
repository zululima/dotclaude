#!/usr/bin/env bash

# Says whether the Claude plan's limits last at the pace so far, for the models
# skill. Reads the result of the desktop app's get_usage tool as JSON on stdin,
# the whole result, its plan object or its windows array, and prints a line per
# limit: how much is used and what it is on pace for at its reset. The lines
# after those give the verdict:
#
#   verdict: fits     every limit lasts with 5 points to spare
#   verdict: tight    then the limit that binds, with the share of the pace so
#                     far that work from now on may cost for that limit to
#                     last, and any other limit that is tight too
#   verdict: unknown  no limit could be read
#
# The 5-hour limit is projected in a straight line over its window, once the
# window is 15 minutes old or 10% used: sessions that start together can spend
# a fifth of a window in its first half hour. A weekly limit is projected over
# the shape of the user's own weeks: the share of a week's usage that the last
# four whole weeks had spent by this point of the week, from the log that
# hooks/usage-log.sh keeps, each response weighted by its tokens and its
# model's family. A straight line would count an idle weekend at the start of
# a week as time gone and promise room that the working days then use up. The
# shape leaves out the last day of each week, when the eve and final runs of
# /dream spend what is left, so a weekly limit is projected to a day before its
# reset and those runs get what the week's own work leaves. With under two
# whole weeks in the log it falls back to the straight line and says so.

set -u
command -v jq >/dev/null 2>&1 || { echo "pace.sh needs jq" >&2; exit 1; }
root="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

plan=$(cat)
printf '%s' "$plan" | jq -e . >/dev/null 2>&1 || {
  echo "pace.sh: pass the result of get_usage as JSON on stdin" >&2
  exit 2
}

logs=()
for f in "$root"/usage-log/*.jsonl; do
  [ -f "$f" ] && logs+=("$f")
done
n=${#logs[@]}
[ "$n" -gt 3 ] && logs=("${logs[@]:$((n - 3))}")
[ "$n" -eq 0 ] && logs=(/dev/null)

jq -n -r --argjson plan "$plan" --argjson margin 5 '
  def ts: sub("\\.[0-9]+"; "") | fromdateiso8601;
  def pct: . + 0.5 | floor;
  def when: strflocaltime("%a %d %b %H:%M");
  # Relative weights for the shape of a week, not prices.
  def weight:
    ((.input // 0) + 5 * (.output // 0) + 0.05 * (.read // 0) + 1.25 * (.w5m // 0) + 2 * (.w1h // 0))
    * ((.model // "") | if test("fable|mythos") then 8 elif test("opus") then 4 elif test("sonnet") then 2 else 0.2 end);

  now as $now
  | 604800 as $week
  | ($plan | if type == "array" then . else (.plan.windows? // .windows? // []) end) as $windows
  | ($windows | map(select(((.label // "") | test("week"; "i")) and .resetsAt != null))
     | (map(select(.label | test("all models"; "i"))) + .) | (.[0].resetsAt // null)) as $resets
  | (if $resets then ($resets | ts) else null end) as $reset
  | (if $reset then
       reduce inputs as $r ({first: null, total: [0, 0, 0, 0, 0], upto: [0, 0, 0, 0, 0]};
         ($r.at // null) as $at
         | if $at == null then . else
             (if .first == null or $at < .first then .first = $at else . end)
             | ((($reset - $at) / $week) | floor) as $k
             | ($at - ($reset - ($k + 1) * $week)) as $into
             | if $k >= 1 and $k <= 4 and $into < $week - 86400 then
                 ($r | weight) as $w
                 | .total[$k] += $w
                 | if $into <= $now - ($reset - $week) then .upto[$k] += $w else . end
               else . end
           end)
     else {first: null, total: [0, 0, 0, 0, 0], upto: [0, 0, 0, 0, 0]} end) as $log
  | (if $reset == null or $log.first == null then []
     else [range(1; 5) | select($log.first <= $reset - (. + 1) * $week and $log.total[.] > 0)] end) as $weeks
  | (if ($weeks | length) >= 2
     then ([$weeks[] | $log.upto[.]] | add) / ([$weeks[] | $log.total[.]] | add)
     else null end) as $shape

  | def project:
      (.label // "limit") as $label
      | (.percentUsed // null) as $used
      | (if ($label | test("hour"; "i")) then 18000 elif ($label | test("week"; "i")) then $week else null end) as $length
      | if $used == null or $length == null or (.resetsAt // null) == null
        then {label: $label, used: $used, how: "unread"}
        else
          (.resetsAt | ts) as $end
          | ([[$now - ($end - $length), 0] | max, $length] | min) as $gone
          | {label: $label, used: $used, end: $end, gone: $gone}
          | if $used >= 100 - $margin then .how = "full"
            elif $length == 18000 then
              (if $gone < 900 and $used < 10 then .how = "early" else .how = "line" | .f = $gone / $length end)
            elif $shape != null and $shape >= 0.05 and (($end - $reset) | fabs) < 3600 then .how = "shape" | .f = $shape
            elif $gone / $length >= 0.05 then .how = "line" | .f = $gone / $length
            else .how = "early" end
        end
      | if .how == "full" then .share = 0
        elif .f != null and .f > 0 then
          .p = .used / .f
          | .share = (if .p <= 100 - $margin then 1 else (100 - $margin - .used) / (.p - .used) end)
        else . end;

  def line:
    "\(.label): " + (if .used == null then "" else "\(.used | pct)% used, " end)
    + (if .how == "unread" then "not read"
       elif .how == "full" then "within \($margin) points of full until its reset on \(.end | when)"
       elif .how == "early" then "\(.gone / 60 | floor) min into its window, too early to project"
       elif .how == "shape" then
         "on pace for \(.p | pct)% a day before its reset on \(.end | when): the last \($weeks | length) whole weeks had spent \(.f * 100 | pct)% of that by this point of the week"
       elif (.label | test("hour"; "i")) then
         "on pace for \(.p | pct)% at its reset on \(.end | when), \(.gone / 60 | floor) min into its 5 hours"
       else
         "on pace for \(.p | pct)% at its reset on \(.end | when), in a straight line, since the usage log holds under two whole weeks"
       end);

  ($windows | map(project)) as $all
  | ($all | map(select(.share != null and .share < 1)) | sort_by(.share)) as $tight
  | ($all[] | line),
    (if ($all | map(select(.how != "unread")) | length) == 0 then "verdict: unknown"
     elif ($tight | length) == 0 then "verdict: fits"
     else
       "verdict: tight",
       "binds: \($tight[0].label), work from here may cost \($tight[0].share * 100 | pct)% of the pace so far",
       ($tight[1:][] | "also tight: \(.label), \(.share * 100 | pct)%")
     end)
' "${logs[@]}"
