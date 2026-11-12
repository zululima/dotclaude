#!/usr/bin/env bash

# Writes a Claude Code session as Markdown for others to read and prints the
# file's path. Each prompt is quoted under a heading with its number, as
# prompt-log.sh numbers it for commits, and masked as prompt-log.sh print masks
# it. Under it come the messages Claude wrote, with their links kept, and one
# line per tool call saying what it ran, read or changed. Tool output, thinking,
# system reminders, messages from other sessions and subagent work are left
# out, and a note marks where a notification or a peer's message came in.
#
#   export-session.sh [--session id] [-o file]
#
# The session is the one in CLAUDE_CODE_SESSION_ID unless --session names one,
# and the file is drafts/share/<session>.md under the Claude Code config folder
# unless -o names one.

set -euo pipefail

config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
prompt_log="$config/hooks/prompt-log.sh"
session="${CLAUDE_CODE_SESSION_ID:-}"
out=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --session) session="${2:-}"; shift ;;
    -o) out="${2:-}"; shift ;;
    *) echo "export-session: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
case "$session" in "" | *[!A-Za-z0-9_-]*) echo "export-session: no session id" >&2; exit 2 ;; esac
transcript=
for f in "$config"/projects/*/"$session".jsonl; do
  [ -f "$f" ] && transcript="$f" && break
done
[ -n "$transcript" ] || { echo "export-session: no transcript for session $session" >&2; exit 1; }
[ -x "$prompt_log" ] || { echo "export-session: $prompt_log is missing" >&2; exit 1; }
[ -n "$out" ] || { mkdir -p "$config/drafts/share"; out="$config/drafts/share/$session.md"; }

turns="$(PROMPT_LOG_SESSION="$session" "$prompt_log" turns)"
[ -n "$turns" ] || { echo "export-session: the prompt log of session $session holds no prompt" >&2; exit 1; }
heading="$(PROMPT_LOG_SESSION="$session" "$prompt_log" print 2>/dev/null | head -n 1 || true)"
case "$heading" in "Model: "*) heading="${heading#Model: }" ;; *) heading= ;; esac

jq -r -s --slurpfile turns <(printf '%s\n' "$turns") --arg heading "$heading" '
  def epoch: sub("\\.[0-9]+Z\\z"; "Z") | fromdateiso8601;
  def text: if type == "string" then . elif type == "array" then map(select(.type == "text") | .text) | join("") else "" end;
  def code: "`" + (tostring | gsub("`"; "")) + "`";
  def tool:
    .name as $n | (.input // {}) as $i
    | if ($n | test("\\A(ToolSearch|mcp__ccd_turn__.*|mcp__ccd_view__.*|mcp__ccd_session__mark_chapter|.*__set_session_title|TodoWrite)\\z")) then empty
      elif $n == "Bash" then "Ran: " + (($i.description // "") | if . != "" then . else ($i.command // "" | split("\n")[0] | .[0:100] | code) end)
      elif $n == "Read" then "Read " + ($i.file_path // "" | code)
      elif $n == "Edit" or $n == "MultiEdit" or $n == "NotebookEdit" then "Edited " + ($i.file_path // $i.notebook_path // "" | code)
      elif $n == "Write" then "Wrote " + ($i.file_path // "" | code)
      elif $n == "Grep" then "Searched for " + ($i.pattern // "" | code)
      elif $n == "Glob" then "Listed " + ($i.pattern // "" | code)
      elif $n == "Skill" then "Loaded the " + ($i.skill // "") + " skill"
      elif $n == "Agent" or $n == "Task" then "Started a subagent: " + ($i.description // "")
      elif $n == "WebFetch" then "Fetched " + ($i.url // "")
      elif $n == "WebSearch" then "Searched the web for " + ($i.query // "" | code)
      else "Used " + ($n | sub("\\Amcp__.*__"; "")) end;
  def note:
    if test("\\A\\s*<task-notification>") then "[a background task finished]"
    elif test("\\A\\s*<cross-session-message") then "[a message from another session, left out]"
    elif test("\\A\\s*<side-sessions-event") then "[a note on side sessions, left out]"
    else empty end;
  def demote:
    split("\n")
    | reduce .[] as $l ({fenced: false, out: []};
        if ($l | test("\\A\\s*```")) then .fenced = (.fenced | not) | .out += [$l]
        elif (.fenced | not) and ($l | test("\\A#{1,5} ")) then .out += ["#" + $l]
        else .out += [$l] end)
    | .out | join("\n");
  def squeeze:
    reduce .[] as $x ([];
      if $x.k == "tool" and length > 0 and .[-1].k == "tool" and .[-1].line == $x.s then .[-1].times += 1
      else . + [$x + {line: $x.s, times: 1}] end)
    | map(if .times > 1 then .s = "\(.line) (\(.times) times)" else . end);
  def blocks:
    squeeze
    | reduce .[] as $x ([];
      if $x.k == "tool" and length > 0 and .[-1].k == "tool" then .[-1].s += "\n- " + $x.s
      elif $x.k == "tool" then . + [{k: "tool", s: ("- " + $x.s)}]
      elif $x.k == "note" then . + [{k: "note", s: ("*" + $x.s + "*")}]
      else . + [$x] end)
    | map(.s) | join("\n\n");
  . as $records
  | ([$records[] | select(.type == "custom-title") | .customTitle // empty] | last // ""
      | sub("\\A[^A-Za-z0-9]+"; "")) as $title
  | ([$records[] | select((.timestamp | type) == "string") | .timestamp][0] // "" | if . == "" then "" else epoch | localtime | strftime("%Y-%m-%d") end) as $day
  | ([$records[] | select(.cwd | type == "string") | .cwd][0] // "" | split("/") | last) as $folder
  | [$records[] | select(.isSidechain != true and (.timestamp | type) == "string") | (.timestamp | epoch) as $t | {t: $t, r: .}] as $timed
  | "# \(if $title == "" then "A Claude Code session" else $title end)\n\n"
    + "A Claude Code session\(if $folder == "" then "" else " in " + $folder end)\(if $day == "" then "" else " from " + $day end)"
    + "\(if $heading == "" then "" else ", model " + ($heading | sub(", effort: "; ", effort ")) end). "
    + "Each prompt is quoted as typed, under its number. Tool output, thinking, system reminders, "
    + "messages from other sessions and subagent work are left out, and square brackets mark what "
    + "was masked or taken out.\n",
    ($turns[] | .start as $s | .end as $e
      | "\n## \(.n)\n\n"
        + (.prompt | split("\n") | map(if . == "" then ">" else "> " + . end) | join("\n"))
        + ([$timed[] | select(.t >= $s and ($e == null or .t < $e)) | .r
            | if .type == "assistant" and .message.model != "<synthetic>" then
                .message.content | arrays | .[]
                | if .type == "text" and (.text | test("\\S")) then {k: "text", s: (.text | sub("\\A\\s+"; "") | sub("\\s+\\z"; "") | demote)}
                  elif .type == "tool_use" then (tool | {k: "tool", s: .})
                  else empty end
              elif .type == "user" and .isMeta != true and .toolUseResult == null then
                (.message.content | text | note | {k: "note", s: .})
              else empty end]
          | if length == 0 then "" else "\n\n" + blocks end)
        + "\n")
' "$transcript" | "$prompt_log" mask --quoted | "$prompt_log" mask --unquoted-links >"$out"
printf '%s\n' "$out"
