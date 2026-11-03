#!/usr/bin/env bash

# Prints the status line of the usage mod: a fire and the minutes the prompt
# cache stays warm, an alarm clock in its last minute, or an ice cube and since
# when it is cold, with money with wings when the last prompt came after it
# had gone cold, then how full the context window is. The other modes total
# tokens, what they would cost at the
# first-party API list prices and their energy. The transcript repeats a
# response's usage on every streamed block, so each response id counts once. A
# model missing from the price table adds tokens but no cost, and the totals
# say how many responses it gave.
#
#   usage.sh <session id>   the session's transcript under projects/
#   usage.sh <transcript>   a transcript file
#   usage.sh --status <session id or transcript>
#                           the context figure, the second the cache goes
#                           cold, the UTC offset then in seconds and the last
#                           prompt's mark, a line each, for the mod to count
#                           down from
#   usage.sh --next <session id>
#                           the other sessions of the last hour whose cache is
#                           still warm and that wait on no subagent, and those
#                           whose Chrome tabs hold a sign-in that ends unused,
#                           soonest first: the second it goes cold or ends, the
#                           title and sign-in for a sign-in, tab-separated, a
#                           line each
#   usage.sh --run <folder> the tokens, cost and energy of every transcript
#                           under the folder, such as a workflow run's, by kind
#                           and model

set -u
command -v jq >/dev/null 2>&1 || exit 0

# Dollars per million tokens: input, output, cache read, cache write for the
# 5-minute and the 1-hour cache. Writes cost 1.25 and 2 times input.
common='
  def prices: {
    "claude-fable-5-1":  [10, 50, 0.25, 12.5, 20],
    "claude-mythos-5-1": [10, 50, 0.25, 12.5, 20],
    "claude-fable-5":    [10, 50, 1, 12.5, 20],
    "claude-opus-5-5":   [4, 20, 0.2, 5, 8],
    "claude-opus-5":     [5, 25, 0.5, 6.25, 10],
    "claude-opus-4-8":   [5, 25, 0.5, 6.25, 10],
    "claude-sonnet-5-5": [2, 10, 0.2, 2.5, 4],
    "claude-sonnet-5":   [2, 10, 0.2, 2.5, 4],
    "claude-haiku-5-5":  [0.1, 0.5, 0.01, 0.125, 0.2],
    "claude-haiku-4-5":  [1, 5, 0.1, 1.25, 2]
  };
  def n: . // 0;
  def secs: (.[0:19] + "Z" | fromdateiso8601) + ((.[20:23] | tonumber?) // 0) / 1000;
  def all_in: (.input_tokens | n) + (.cache_creation_input_tokens | n)
    + (.cache_read_input_tokens | n) + (.output_tokens | n);
  def scan($main): reduce (inputs | fromjson? | select(.timestamp != null)) as $e ({seen: {}, r: [], prompts: []};
      (if $e.uuid != null then .seen[$e.uuid] = ($e.timestamp | secs) else . end)
      | if $e.type == "assistant" and $e.message.usage != null
          and $e.message.model != "<synthetic>" and $e.message.id != null
        then .r += [{id: $e.message.id, model: $e.message.model, u: $e.message.usage,
          at: ($e.timestamp | secs), parent: $e.parentUuid, main: (input_filename == $main)}]
        elif $e.type == "user" and $e.isMeta != true and $e.isCompactSummary != true
          and ($e.origin.kind // "human") == "human"
          and ($e.message.content | type == "string" or (type == "array" and any(.[]; .type == "text")))
        then .prompts += [$e.timestamp | secs]
        elif $e.type == "user" and ($e.message.content | type == "array" and .[0].type == "tool_result")
        then ($e.message.content[0].content | if type == "array" then map(.text? // "") | join("") else tostring end) as $text
          | if $text | contains("Tab Context:") then .tabs = {at: ($e.timestamp | secs), $text} else . end
        else . end);

  # A request goes out once the entry it answers is written, and the cache
  # stays warm from then. The response is stamped when its first block is
  # done, seconds later, minutes after a long thought.
  def grouped: .seen as $seen
    | .r | group_by(.id)
    | map(min_by(.at) as $first
      | ($seen[$first.parent // empty] // $first.at) as $sent
      | {id: .[0].id, model: .[0].model, u: .[-1].u, at: $first.at, sent: $sent, main: .[0].main,
         busy: ([(map(.at) | max) - $sent, 0] | max)});
  def responses($main): scan($main) | grouped;
  def ttl: if any(.[]; (.u.cache_creation.ephemeral_1h_input_tokens | n) > 0) then 3600 else 300 end;
  def cold_at: (map(.sent) | max) + ttl | floor;

  # A prompt came too late when its request went out after the cache had gone
  # cold and its first response read less than 80% of the request before it
  # from there, only the system prompt other sessions keep warm. A compaction
  # rewrites the cache too, but sending sooner would not have saved it.
  def late($prompts): ($prompts | max) as $p
    | map(select(.at < $p)) as $before
    | (map(select(.at > $p)) | min_by(.at)) as $first
    | $p != null and ($before | length) > 0 and $first != null
      and $first.sent >= ($before | cold_at)
      and ($first.u.cache_read_input_tokens | n) < 0.8 * ($before | max_by(.at).u
        | (.input_tokens | n) + (.cache_creation_input_tokens | n) + (.cache_read_input_tokens | n));

  # Energy: the seconds from the entry a response answers to its last block,
  # times the share of one request in an 8-GPU H100 node as "How Hungry is AI?"
  # (arXiv 2505.09598) models a flagship model: 8 requests to a batch, the GPUs
  # (8 x 700 W) at 45-60% of their draw, the rest of the 10.2 kW node at half,
  # and a PUE of 1.14 (AWS), about 0.75 kW. Grams of CO2e per kWh: the Ember
  # 2025 grid average (Our World in Data), the US for inference_geo "us", else
  # the world, since "global" may run anywhere.
  def kw: (5.6 * 0.525 + 4.6 * 0.5) / 8 * 1.14;
  def norm: .u as $u | {id, at, model, busy, geo: ($u.inference_geo // null), input: ($u.input_tokens | n),
    w5m: (if $u.cache_creation == null then ($u.cache_creation_input_tokens | n)
          else ($u.cache_creation.ephemeral_5m_input_tokens | n) end),
    w1h: ($u.cache_creation.ephemeral_1h_input_tokens | n), read: ($u.cache_read_input_tokens | n),
    output: ($u.output_tokens | n)};
  def rtokens: .input + .w5m + .w1h + .read + .output;
  def rcost: prices[.model] as $p | if $p == null then 0
    else (.input * $p[0] + .output * $p[1] + .read * $p[2] + .w5m * $p[3] + .w1h * $p[4]) / 1000000 end;
  def rkwh: .busy * kw / 3600;
  def rgrams: rkwh * (if .geo == "us" then 384.4 else 458.3 end);
  def summary: "\(map(rtokens) | add // 0) \(map(rcost) | add // 0) \(map(select(prices[.model] == null)) | length) \(map(rkwh) | add // 0) \(map(rgrams) | add // 0) \(map(.input) | add // 0) \(map(.w5m + .w1h) | add // 0) \(map(.read) | add // 0) \(map(.output) | add // 0) \(length) \(map(.at) | min // 0) \(map(.at) | max // 0)",
    (group_by(.model)[] | "\(.[0].model) \(map(rtokens) | add) \(map(rcost) | add) \(map(rkwh) | add) \(map(rgrams) | add)");'

human() {
  awk -v n="$1" 'BEGIN {
    if (n >= 1000000) { s = sprintf("%.1f", n / 1000000); sub(/\.0$/, "", s); printf "%sM", s }
    else if (n >= 1000) printf "%dk", n / 1000
    else printf "%d", n }'
}

energy() {
  awk -v k="$1" -v g="$2" 'BEGIN { printf(k < 0.1 ? "~%.3f kWh, ~%d g CO2e" : "~%.2f kWh, ~%d g CO2e", k, g + 0.5) }'
}

# Reads summary lines on stdin and prints the total, its split, the share of
# prompt tokens the warm cache served, and the same per model.
summarise() {
  read -r tokens cost unpriced kwh grams input write read output count first last || return 1
  note=""
  [ "$unpriced" -gt 0 ] && note=" ($unpriced responses from models without a price)"
  printf '%s tokens in %s responses, $%.2f at API list prices%s, %s\n' "$(human "$tokens")" "$count" "$cost" "$note" "$(energy "$kwh" "$grams")"
  printf '  input %s, cache write %s, cache read %s, output %s\n' "$(human "$input")" "$(human "$write")" "$(human "$read")" "$(human "$output")"
  awk -v r="$read" -v p="$((input + write + read))" -v t="$tokens" 'BEGIN { if (p > 0) printf "  warm cache: %.1f%% of prompt tokens, %.1f%% of all tokens\n", r * 100 / p, r * 100 / t }'
  while read -r model mtokens mcost mkwh mgrams; do
    printf '  %s: %s tokens, $%.2f, %s\n' "$model" "$(human "$mtokens")" "$mcost" "$(energy "$mkwh" "$mgrams")"
  done
}

transcripts() {
  find "$@" -name '*.jsonl' -type f 2>/dev/null
}

if [ "${1:-}" = --run ]; then
  [ -d "${2:-}" ] || { echo "usage.sh --run <folder>" >&2; exit 2; }
  files=()
  while IFS= read -r f; do files+=("$f"); done < <(transcripts "$2")
  [ "${#files[@]}" -gt 0 ] || { echo "no transcripts under $2" >&2; exit 1; }
  jq -nrR "$common"'responses("") | map(norm) | summary' "${files[@]}" 2>/dev/null | summarise
  exit 0
fi

# One record per response, for the usage log: usage.sh --log <after> <file>...
# prints the responses of the files that began after <after>, in seconds.
if [ "${1:-}" = --log ]; then
  after=${2:-0}
  shift 2 || exit 2
  [ "$#" -gt 0 ] || exit 0
  jq -ncR --argjson after "$after" "$common"'responses("") | map(select(.at > $after) | norm)[]' "$@" 2>/dev/null
  exit 0
fi

# Totals of the usage log for a period: usage.sh --since <ISO time> [<ISO time until>]
if [ "${1:-}" = --since ]; then
  [ -n "${2:-}" ] || { echo "usage.sh --since <ISO time> [<until>]" >&2; exit 2; }
  log="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/usage-log"
  ls "$log"/*.jsonl >/dev/null 2>&1 || { echo "no usage log in $log" >&2; exit 1; }
  jq -nrR --arg since "$2" --arg until "${3:-9999}" "$common"'
    def at_of($t): ($t | secs);
    (at_of($since)) as $from | (if $until == "9999" then 1e12 else at_of($until) end) as $to
    | reduce (inputs | fromjson? | select(.id != null)) as $r ({}; .[$r.id] = $r)
    | [.[] | select(.at >= $from and .at < $to)] | summary' "$log"/*.jsonl 2>/dev/null | {
    IFS= read -r head || exit 1
    set -- $head
    printf 'From %s to %s:\n' "$(date -r "${11%.*}" '+%a %d.%m. %H:%M' 2>/dev/null)" "$(date -r "${12%.*}" '+%a %d.%m. %H:%M' 2>/dev/null)"
    { echo "$head"; cat; } | summarise
  }
  exit 0
fi

# A session waits on a background agent until its meta says finished or the
# session got its task notification, and on a workflow run until the run's
# record is written. One quiet for an hour, such as a session the app quit
# mid-run left, no longer counts.
waiting() {
  local meta run
  for meta in "$1"/subagents/agent-*.meta.json; do
    [ -n "$(find "${meta%.meta.json}.jsonl" -mmin -65 2>/dev/null)" ] || continue
    jq -e '.requestShape == "background" and .finished != true' "$meta" >/dev/null 2>&1 || continue
    grep -qF "<task-id>$(basename "$meta" .meta.json | cut -d- -f2)</task-id>" "$1.jsonl" || return 0
  done
  for run in "$1"/subagents/workflows/wf_*; do
    [ -n "$(find "$run" -name '*.jsonl' -mmin -65 2>/dev/null | head -1)" ] || continue
    [ "$(jq -r '.status' "$1/workflows/${run##*/}.json" 2>/dev/null || echo running)" = running ] && return 0
  done
  return 1
}

# Minutes a sign-in lasts unused, from the service's own page where it gives
# one: S-Pankki 15, OmaVero 60 and a Suomi.fi identification 32. Nordea gives 5
# for its mobile bank alone, and the others publish none, so they get those 5.
# A host counts with its subdomains.
signins='
  def minutes: {
    "netbank.nordea.fi": 5, "s-pankki.fi": 15, "op.fi": 5, "danskebank.fi": 5,
    "aktia.fi": 5, "saastopankki.fi": 5, "poppankki.fi": 5, "omasp.fi": 5,
    "handelsbanken.fi": 5, "alandsbanken.fi": 5, "vero.fi": 60, "suomi.fi": 32,
    "kela.fi": 5, "kanta.fi": 5, "tyomarkkinatori.fi": 5
  };
  def signed_in_until: if . == null then 0 else .at as $at
    | [.text | split("Tab Context:") | last | match("\\(\"https?://([^/\"?#:]+)"; "g")
        | .captures[0].string | ascii_downcase] as $hosts
    | [minutes | to_entries[] | . as $s | select(any($hosts[]; . == $s.key or endswith("." + $s.key))) | .value]
    | if length > 0 then $at + min * 60 | floor else 0 end end;'

# The desktop app's record of a session says whether it is archived; a session
# without one, such as a terminal's, counts as open. A record changes whenever
# its session does, so only those of the last hour are read.
if [ "${1:-}" = --next ]; then
  now=$(date +%s)
  chrome=false
  pgrep -xq 'Google Chrome' && chrome=true
  known=$(find "$HOME/Library/Application Support/Claude/claude-code-sessions" -name 'local_*.json' \
    -mmin -65 -type f -exec jq -r '"\(.cliSessionId)\t\(.isArchived == true)\t\(.title // "")"' {} + 2>/dev/null)
  find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects -mindepth 2 -maxdepth 2 -name '*.jsonl' -mmin -65 -type f 2>/dev/null |
    while IFS= read -r f; do
      id=$(basename "$f" .jsonl)
      [ "$id" = "${2:-}" ] && continue
      archived='' title=''
      IFS=$'\t' read -r _ archived title < <(printf '%s\n' "$known" | grep -F "$id	")
      [ "$archived" = true ] && continue
      [ -n "$title" ] || title=$(grep '"type":"custom-title"' "$f" | tail -1 | jq -r '.customTitle // empty' 2>/dev/null)
      title=${title:-${id:0:8}}
      # Only responses, the entries they answer and the prompts count, a part
      # of a long transcript. A prompt warms the cache as it goes out, before
      # its first response is written. The last Claude in Chrome result lists
      # the tabs the session holds and when it last used them.
      cold=0 ends=0
      read -r cold ends < <(grep -E '"type":"(assistant|user|attachment)"' "$f" | jq -nrR "$common$signins"'
        scan("") | (.prompts | max // 0) as $prompt | (.tabs | signed_in_until) as $ends | grouped
        | (if length > 0 then ttl as $ttl | [(map(.sent) | max), $prompt] | max + $ttl | floor else 0 end) as $cold
        | "\($cold) \($ends)"' 2>/dev/null)
      # A session waiting on a subagent still holds its tabs.
      [ "$chrome" = true ] && [ "${ends:-0}" -gt "$now" ] && printf '%s\t%s\tsign-in\n' "$ends" "$title"
      waiting "${f%.jsonl}" && continue
      [ "${cold:-0}" -gt "$now" ] && printf '%s\t%s\n' "$cold" "$title"
    done | sort -n
  exit 0
fi

status=false
[ "${1:-}" = --status ] && { status=true; shift; }

transcript=${1:-}
if [ -n "$transcript" ] && [ ! -f "$transcript" ]; then
  for f in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/"$1".jsonl; do
    [ -f "$f" ] && transcript=$f
  done
fi
[ -f "$transcript" ] || exit 0

read -r ctx window warm late < <(jq -nrR --arg main "$transcript" "$common"'
  scan($main) | .prompts as $prompts | grouped
  | select(length > 0)
  | max_by(.at) as $last
  | ($last.model | if test("haiku-4|claude-3") then 200000 else 1000000 end) as $window
  | "\($last.u | all_in) \($window) \(cold_at) \(late($prompts))"
' "$transcript" 2>/dev/null)
[ -n "${warm:-}" ] || exit 0

at() { LC_ALL=C date -r "$1" "$2" 2>/dev/null || LC_ALL=C date -d "@$1" "$2" 2>/dev/null; }

brain=$(printf '\360\237\247\240')
figures="$brain $(awk -v c="$ctx" -v w="$window" 'BEGIN { printf "%d", c * 100 / w }')%"
mark=''
[ "${late:-}" = true ] && mark=$(printf '\360\237\222\270')

if [ "$status" = true ]; then
  z=$(at "$warm" +%z)
  printf '%s\n%s\n%s\n%s\n' "$figures" "$warm" "$(( ${z:0:1}(10#${z:1:2} * 3600 + 10#${z:3:2} * 60) ))" "${mark:-}"
  exit 0
fi

fire=$(printf '\360\237\224\245')
alarm=$(printf '\342\217\260')
ice=$(printf '\360\237\247\212')
left=$((warm - $(date +%s)))
if [ "$left" -ge 60 ]; then
  echo "$fire $((left / 60)) min${mark:+ $mark}, $figures"
elif [ "$left" -gt 0 ]; then
  echo "$alarm <1 min${mark:+ $mark}, $figures"
elif [ "$(at "$warm" +%F)" = "$(date +%F)" ]; then
  echo "$ice since $(at "$warm" +%H:%M), $figures"
else
  echo "$ice since $(at "$warm" '+%-d %b'), $figures"
fi
