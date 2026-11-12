#!/usr/bin/env bash

# Claude Code UserPromptSubmit hook that logs the session's prompts, and the
# reader that prints them for a commit message or a PR body, so the prompts are
# quoted as typed instead of retyped from the conversation. As a hook it prints
# nothing, because whatever a UserPromptSubmit hook prints is added to the
# model's context, and it always exits 0, so it never blocks a prompt.
#
#   prompt-log.sh                              append the prompt in the hook
#                                              input to prompt-log/<session>.jsonl
#   prompt-log.sh print [--commit] [-C repo] [--from n] [--model id]
#                       [--effort level]       print the session's prompts
#   prompt-log.sh mask [--quoted]              mask stdin as print does, with
#                                              --quoted only the lines from >
#   prompt-log.sh turns [--from n]             print each prompt with its turn
#                                              as a line of JSON
#
# print numbers every prompt of the session in CLAUDE_CODE_SESSION_ID, or in
# PROMPT_LOG_SESSION when set, as **n.** and > lines under a Model: line for a
# PR body, or with --commit as n. and > lines wrapped at 72 columns under the
# two heading lines of a commit's prompts section. --from n starts at prompt n.
# With --commit it then names on stderr the Abbreviations: lines that earlier
# commit messages gave for words of the printed prompts, each from the newest
# commit that gave it in the repository -C names, by default the working
# directory's, then in ~/Projects/dotclaude, matched as abbreviations-listed.sh
# matches them.
# The log keeps each prompt as it arrived. print drops what the harness wraps
# in tags: reminders, artifact context, peer session messages, subagent
# hand-backs and notifications, and an entry with nothing else in it gets no
# number, nor does a cross-session notice or the app's note that it compacted
# the conversation. A pasted block comes out as [pasted: n lines], URLs and
# email addresses as [pasted: an address], a home path with ~, a temporary path
# as [a temporary path] and a password or token value as [redacted].
# A prompt identical to the one before it, such as one sent again after a hook
# blocked it, is printed once.
# mask applies those last masks alone, so prompts-md.sh can apply them to
# prompts quoted in commit messages written before print masked anything.
#
# The model and effort of each prompt come from the replies to it in the
# session's transcript, projects/*/<session>.jsonl, whose message.model and
# effort fields are internal to Claude Code and may change. Where it records
# none, the model comes from --model and the effort from --effort, CLAUDE_EFFORT
# or the model's effortLevel in settings.json. Without a model, or with an
# effort other than low, medium, high, xhigh or max, print leaves the heading
# out, prints the prompts and exits 1 with the reason. A fork's transcript opens
# with the records it copied from the session it was forked from, under that
# session's id, so print takes the fork's earlier prompts from that session's
# log, up to the last record copied from it, and numbers on from there. Where no
# log holds them, prompts the transcript holds from before the log began count
# towards the numbers.
#
# turns numbers the prompts as print does and gives each as {n, prompt, recap,
# reply, start, end}: the prompt as print has it before the masks, the recap of
# the last wrap_up call of the desktop app in its turn, the turn's last
# message as its reply, and the turn's bounds in epoch seconds, end null for
# the last. A turn runs from its prompt to the next one, so the turns a
# notification or a peer session's message starts count towards the prompt
# before them.

set -u

config_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
log_dir="$config_dir/prompt-log"

masks=(
  's#[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]]*[^[:space:].,;:!?)]#[pasted: an address]#g'
  's#[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^[:space:]]*[^[:space:].,;:!?)]#[pasted: an address]#g'
  's#[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}#[pasted: an address]#g'
  's#(/private)?/tmp/claude-[0-9]+/[^[:space:]"]*#[a temporary path]#g'
  's#/(Users|home)/[^/[:space:]"]+#~#g'
  's#((mysql|mariadb|mysqldump|mysqladmin)[^|;&]*[[:space:]]-p)[^[:space:]]+#\1[redacted]#g'
  's#((PASSWORD|PASSWD|TOKEN|SECRET|PWD|[Pp]assword|[Pp]asswd|[Tt]oken|[Ss]ecret)=)[^[:space:]]+#\1[redacted]#g'
)

mask() {
  local args=() m
  for m in "${masks[@]}"; do args+=(-e "$1$m"); done
  sed -E "${args[@]}"
}

if [ "${1:-}" = mask ]; then
  case "${2:-}" in
    "") mask "" ;;
    --quoted) mask "/^>/" ;;
    *) echo "prompt-log: unknown argument $2" >&2; exit 2 ;;
  esac
  exit
fi

if [ "${1:-}" != print ] && [ "${1:-}" != turns ]; then
  umask 077
  input="$(cat)"
  session="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)"
  case "$session" in ""|*[!A-Za-z0-9_-]*) exit 0 ;; esac
  mkdir -p "$log_dir" 2>/dev/null || exit 0
  printf '%s' "$input" \
    | jq -c --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{timestamp: $t, session_id, cwd, prompt}' \
      >>"$log_dir/$session.jsonl" 2>/dev/null
  exit 0
fi

form=pr
[ "$1" = turns ] && form=turns
shift
from=1
model=
effort=
repo=.
quoted=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --commit) form=commit ;;
    -C) repo="${2:-}"; shift ;;
    --from) from="${2:-}"; shift ;;
    --model) model="${2:-}"; shift ;;
    --effort) effort="${2:-}"; shift ;;
    *) echo "prompt-log: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
case "$from" in ""|*[!0-9]*) echo "prompt-log: --from takes a prompt number" >&2; exit 2 ;; esac
[ -d "$repo" ] || { echo "prompt-log: -C takes a repository" >&2; exit 2; }

session="${PROMPT_LOG_SESSION:-${CLAUDE_CODE_SESSION_ID:-}}"
log="$log_dir/$session.jsonl"
if [ -z "$session" ] || [ ! -f "$log" ]; then
  echo "prompt-log: no prompt log for session '$session', set PROMPT_LOG_SESSION" >&2
  exit 1
fi
transcript=
for f in "$config_dir"/projects/*/"$session".jsonl; do
  [ -f "$f" ] && transcript="$f" && break
done

clean='def typed:
  . != "" and (test("\\A(<command-|<local-command-|\\[Request interrupted|\\[Cross-session [a-z]+ notice\\]|The context window filled up while you were working)") | not);
def clean:
  gsub("<(?<t>system-reminder|artifact-view-context|cross-session-message|agent-message|task-notification|teammate-message)[\\s>][\\s\\S]*?</\\k<t>\\s*>"; "")
  | sub("\\A\\s+"; "") | sub("\\s+\\z"; "");'

prior_logs() {
  [ -n "$transcript" ] || return 0
  jq -n -r --arg s "$session" '
    reduce (inputs | select(.isSidechain != true and (.sessionId | type) == "string"
        and .sessionId != $s and (.timestamp | type) == "string")) as $r
      ({}; .[$r.sessionId] = ([.[$r.sessionId], $r.timestamp] | max))
    | to_entries[] | "\(.key)\t\(.value)"' "$transcript" 2>/dev/null \
    | while IFS=$'\t' read -r sid last; do
        case "$sid" in ""|*[!A-Za-z0-9_-]*) continue ;; esac
        jq -c --arg last "$last" 'def epoch: sub("\\.[0-9]+Z\\z"; "Z") | fromdateiso8601;
          select((.timestamp | epoch) <= ($last | epoch))' "$log_dir/$sid.jsonl" 2>/dev/null
      done
}

# The awk of abbreviations-listed.sh, printing in the order of the logs.
abbreviations() {
  [ -n "$1" ] || return 0
  awk '
    function key(line,   k) {
      sub(/^- /, "", line)
      if (line !~ /^[^:]+: ./) return ""
      k = tolower(substr(line, 1, index(line, ":") - 1))
      return (length(k) > 24 || k ~ /-by$/) ? "" : k
    }
    function hasword(s, w,   i, p, b, a) {
      p = 0
      while ((i = index(substr(s, p + 1), w)) > 0) {
        p += i
        b = substr(s, p - 1, 1)
        a = substr(s, p + length(w), 1)
        if ((p == 1 || b !~ /[a-z0-9.]/) && a !~ /[a-z0-9]/) return 1
      }
      return 0
    }
    FNR == 1 { file++; ab = 0 }
    $0 == "Abbreviations:" { ab = 1; next }
    $0 == "" || $0 == "\001" { ab = 0 }
    ab && (k = key($0)) != "" {
      line = $0
      sub(/^- /, "", line)
      n = split(k, ws, /, */)
      for (j = 1; j <= n; j++)
        if (file == 1 && !(ws[j] in gloss)) { gloss[ws[j]] = line; order[++count] = ws[j] }
      next
    }
    file == 2 && /^>/ { sub(/^> ?/, ""); quoted = quoted " " tolower($0) }
    END {
      for (i = 1; i <= count; i++)
        if (hasword(quoted, order[i]) && !(gloss[order[i]] in shown)) { shown[gloss[order[i]]]; print gloss[order[i]] }
    }
  ' <(git -C "$repo" log --format='%x01%n%B' 2>/dev/null
      git -C "$HOME/Projects/dotclaude" log --format='%x01%n%B' 2>/dev/null) \
    <(printf '%s' "$1")
}

{
  IFS= read -r -d '' note && IFS= read -r -d '' problem && IFS= read -r -d '' heading || exit 1
  [ -z "$note" ] || echo "prompt-log: $note" >&2
  if [ "$form" = turns ]; then
    cat
    exit 0
  fi
  if [ -n "$heading" ] && [ "$form" = commit ]; then
    printf 'Prompts behind this commit, as given to Claude Code\n'
    printf '%s\n' "$heading" | fold -s -w 72 | sed -e 's/ *$//'
    printf '\n'
  elif [ -n "$heading" ]; then
    printf '%s\n\n' "$heading"
  fi
  while IFS= read -r -d '' item; do
    n="${item%%$'\t'*}"
    prompt="$(printf '%s\n' "${item#*$'\t'}" | mask "")"
    if [ "$form" = commit ]; then
      printf '%s.\n' "$n"
      lines="$(printf '%s\n' "$prompt" | fold -s -w 70 | sed -e 's/ *$//' -e 's/^/> /' -e 's/^> $/>/')"
      printf '%s\n' "$lines"
      quoted+="$lines"$'\n'
    else
      printf '**%s.**\n' "$n"
      printf '%s\n' "$prompt" | sed -e 's/^/> /' -e 's/^> $/>/'
    fi
    printf '\n'
  done
  named="$(abbreviations "$quoted")"
  [ -z "$named" ] || printf 'prompt-log: %s\n%s\n' "earlier commits gave these Abbreviations: lines for words of the prompts; add each whose word stays in the message and means the same here:" "$named" >&2
  [ -z "$problem" ] || { echo "prompt-log: $problem" >&2; exit 1; }
} < <(jq -j -s --arg from "$from" --arg form "$form" --arg model "$model" --arg effort "$effort" \
  --slurpfile rec <(if [ -n "$transcript" ]; then jq -c "$clean"'
    select(.isSidechain != true)
    | . as $r
    | if .type == "assistant" and .message.model != "<synthetic>" then
        {t: .timestamp, model: .message.model, effort},
        (.message.content | arrays | .[]
          | if .type == "text" and (.text | type) == "string" and (.text | test("\\S")) then
              {t: $r.timestamp, id: $r.message.id, text}
            elif .type == "tool_use" and (.name | type) == "string" and (.name | endswith("__wrap_up"))
              and (.input.recap | type) == "string" then
              {t: $r.timestamp, recap: .input.recap}
            else empty end)
      elif .type == "user" and .isMeta != true and .isCompactSummary != true and .toolUseResult == null then
        (.message.content
          | if type == "string" then . elif type == "array" then map(select(.type == "text") | .text) | join("") else "" end
          | clean) as $p
        | select($p | typed)
        | {t: .timestamp, prompt: true}
      else empty end' "$transcript" 2>/dev/null; fi) \
  --slurpfile prior <(prior_logs) \
  --slurpfile settings <(jq -c '.modelSettings // {}' "$config_dir/settings.json" 2>/dev/null) \
  "$clean"'
  def epoch: sub("\\.[0-9]+Z\\z"; "Z") | fromdateiso8601;
  def fill: reduce range(1; length) as $i (.; .[$i] //= .[$i - 1]);
  def nearest: fill | reverse | fill | reverse;
  def levels: ["low", "medium", "high", "xhigh", "max"];
  def id: if . == null or . == "" then null else sub("\\[1m\\]\\z"; "") end;
  def lastmessage: if length == 0 then null else last as $l
    | if $l.id == null then $l.text else [.[] | select(.id == $l.id) | .text] | join("\n\n") end end;
  def ranges:
    reduce .[] as $x ([]; if length > 0 and .[-1].v == $x.v then .[-1].to = $x.n else . + [{v: $x.v, from: $x.n, to: $x.n}] end)
    | if length == 1 then .[0].v else to_entries | map(.key as $k | .value
        | "\(.v) for \(if $k > 0 then "" elif .from == .to then "prompt " else "prompts " end)\(.from)\(if .from == .to then "" else " to \(.to)" end)")
      | join(", ") end;
  ($from | tonumber) as $from
  | ([($prior | sort_by(.timestamp))[], .[] | {t: (.timestamp | epoch), p: (.prompt // "" | clean
      | gsub("<pasted_content[^>]*>(?<b>[\\s\\S]*?)</pasted_content[^>]*>";
          "[pasted: \(.b | sub("\\A\\s+"; "") | sub("\\s+\\z"; "") | split("\n") | length) lines]"))}
      | select(.p | typed)]
      | reduce .[] as $x ([]; if length > 0 and .[-1].p == $x.p and $x.t - .[-1].t < 10 then . else . + [$x] end)) as $log
  | ($log[0].t // 0) as $start
  | ([$rec[] | select(.prompt and (.t | epoch) < $start - 5)] | length) as $offset
  | [$rec[] | select(.model) | {t: (.t | epoch), model: (.model | id), effort}] as $replies
  | [range($log | length) | {i: ., n: (. + $offset + 1)} | select(.n >= $from)] as $printed
  | [$printed[] | $log[.i].t as $a | ($log[.i + 1].t // infinite) as $b
      | [$replies[] | select(.t >= $a and .t < $b)][0]] as $seen
  | ($seen | map(.model) | nearest) as $models
  | ($seen | map(.effort) | nearest) as $efforts
  | [$printed | to_entries[] | .key as $k | ($models[$k] // ($model | id)) as $m
      | (if $efforts[$k] != null then {v: $efforts[$k], from: "the transcript"}
         elif $effort != "" then {v: $effort, from: "--effort"}
         elif ($ENV.CLAUDE_EFFORT // "") != "" then {v: $ENV.CLAUDE_EFFORT, from: "CLAUDE_EFFORT"}
         elif $m != null and $settings[0][$m].effortLevel != null then {v: $settings[0][$m].effortLevel, from: "settings.json"}
         else {v: null, from: null} end) as $e
      | {n: .value.n, model: $m, effort: $e.v, source: $e.from}] as $heads
  | ([if $offset > 0 then "the log began after prompt \($offset) of the session, so its first prompt is \($offset + 1)" else empty end,
      if $offset > 0 and $from <= $offset then "prompts \($from) to \($offset) came before it and are left out" else empty end]
     | join("; ")) as $note
  | ([$heads[] | select(.model == null or (.model | test("\\A[A-Za-z0-9._-]+\\z") | not))][0]) as $nomodel
  | ([$heads[] | select(.effort as $v | levels | index([$v]) | not)][0]) as $noeffort
  | (if ($printed | length) == 0 then "no prompt from \($from) on, the log holds prompts \($offset + 1) to \($offset + ($log | length))"
     elif $nomodel != null then "no model recorded for prompt \($nomodel.n), so the heading is left out; pass the model id of the session with --model"
     elif $noeffort.effort == null and $noeffort != null then "no effort recorded for prompt \($noeffort.n), so the heading is left out; pass the level get_session gives with --effort"
     elif $noeffort != null then "\($noeffort.source) gives effort \($noeffort.effort | tojson) for prompt \($noeffort.n), which is not one of \(levels | join(", ")), so the heading is left out"
     else "" end) as $problem
  | (if $problem != "" then ""
     elif $form == "commit" then "(model \($heads | map({n, v: .model}) | ranges), effort \($heads | map({n, v: .effort}) | ranges)):"
     else "Model: \($heads | map({n, v: .model}) | ranges), effort: \($heads | map({n, v: .effort}) | ranges)" end) as $heading
  | [$rec[] | select(.recap or .text) | .t |= epoch] as $said
  | $note, "\u0000", $problem, "\u0000", $heading, "\u0000",
    if $form == "turns" then
      ($printed[] | $log[.i].t as $a | $log[.i + 1].t as $b
        | [$said[] | select(.t >= $a and ($b == null or .t < $b))] as $turn
        | {n, prompt: $log[.i].p, recap: ([$turn[] | select(.recap)] | last | .recap // null),
           reply: ([$turn[] | select(.text)] | lastmessage), start: $a, end: $b}
        | tojson + "\n")
    else ($printed[] | "\(.n)\t\($log[.i].p)\u0000") end' "$log")
