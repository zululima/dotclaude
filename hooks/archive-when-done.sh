#!/usr/bin/env bash

# Claude Code Stop hook for the rule that a session with nothing left to do
# says that the user can archive it, and a spawner, which handed its task to
# another session, archives itself. When the turn's next-step box asked
# nothing, no background work is in flight, the working directory is on no
# branch but its repository's default one, and the turn's last message does
# not say that the user can archive the session, it sends the turn back once.
# A mention of another session's archive does not count. The box call is read
# from the transcript, whose format Claude Code does not document, so a change
# there makes this hook quietly pass. The last message comes from
# last_assistant_message, as in prompt-feedback-box.sh.

set -u

command -v jq >/dev/null 2>&1 || exit 0
input="$(cat 2>/dev/null)"
read -r event active tasks < <(printf '%s' "$input" | jq -r \
  '"\(.hook_event_name // "") \(.stop_hook_active // false) \(.background_tasks // [] | length)"' 2>/dev/null)
[ "${event:-}" = Stop ] && [ "${active:-}" = false ] && [ "${tasks:-}" = 0 ] || exit 0
transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)"
[ -f "$transcript" ] || exit 0
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"

if [ -n "$cwd" ] && branch="$(git -C "$cwd" symbolic-ref --quiet --short HEAD 2>/dev/null)"; then
  default="$(git -C "$cwd" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)"
  default="${default#origin/}"
  [ -z "$default" ] || [ "$branch" = "$default" ] || exit 0
fi

last="$(printf '%s' "$input" | jq -c 'if has("last_assistant_message") then .last_assistant_message // "" else null end' 2>/dev/null)"
[ -n "$last" ] || exit 0

jq -Rn -e --arg box mcp__ccd_turn__wrap_up --argjson last "$last" '
  def text: if type == "string" then . else [.[]? | select(.type == "text") | .text] | join("\n") end;
  [inputs | fromjson? // empty] as $lines
  | ([$lines | to_entries[] | select(.value.type == "user" and .value.origin != null) | .key]
     | last) as $turn
  | ([$lines[$turn:][] | select(.type == "assistant") | .message.content[]?
      | select(.type == "tool_use" and .name == $box)] | last) as $call
  | $call != null
    and (($call.input.ask // "") | tostring | length) == 0
    and (($call.input.actions // []) | length) == 0
    and ($last // ([$lines[$turn:][] | select(.type == "assistant") | .message.content[]?
                    | select(.type == "text") | .text] | last // "")
         | text | test("(you|user)( can| may)? archive|archive (this|the) session|arkisto"; "i") | not)
' "$transcript" >/dev/null 2>&1 || exit 0

echo "The next-step box asked nothing and no background work is in flight. When nothing is \
left for the user or the session to do, its PRs merged or closed, the closing reply says so and \
that the user can archive the session, in its text alone. A spawner, a session that handed its \
task to another or started the next job's session with nothing else left, writes no such reply: \
when every call of the hand-over returned without an error, call archive_session with self now, \
as the turn's last call, and write nothing more. Anyone else adds that line now as the turn's \
last message, without calling wrap_up again. When something is still left, such as an open PR, a \
step the user takes or an error of the hand-over, name it in that message instead." >&2
exit 2
