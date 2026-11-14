#!/usr/bin/env bash

# Claude Code Stop hook that posts the "session finished" banner on macOS in
# place of the desktop app's own, so the app's banners can be turned off in
# macOS without losing this one. The app files every banner it posts, the
# "moved to top level", "archived" and model or effort ones too, under one
# type that none of its settings gates. It runs async and waits a few seconds
# first, since another Stop hook may send the turn back: a transcript that grew
# meanwhile means the turn went on, and its next Stop posts instead. It stays
# quiet while Claude is the front app, as it cannot tell which session is on
# screen, while background work is in flight, and after a session archived
# itself. The title and local_ id come from the app's session files under
# claude-code-sessions, whose format the app does not document; without them
# the banner names no session and a click only brings Claude to the front.
# Posting as Claude with -sender would file the banner under Claude's own
# notification setting, which is the one turned off, and terminal-notifier 3
# no longer supports it anyway.

set -u

[ "$(uname -s)" = Darwin ] || exit 0
notifier="$(PATH="$PATH:/opt/homebrew/bin:/usr/local/bin" command -v terminal-notifier)"
[ -n "$notifier" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

app=com.anthropic.claudefordesktop
input="$(cat 2>/dev/null)"
read -r event session tasks < <(printf '%s' "$input" | jq -r \
  '"\(.hook_event_name // "") \(.session_id // "") \(.background_tasks // [] | length)"' 2>/dev/null)
[ "${event:-}" = Stop ] && [ "${tasks:-}" = 0 ] || exit 0
case "${session:-}" in ""|*[!A-Za-z0-9_-]*) exit 0 ;; esac
transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)"

size() { [ -f "$transcript" ] && stat -f %z "$transcript" 2>/dev/null; }
before="$(size)"
sleep "${FINISHED_BANNER_DELAY:-4}"
[ "$(size)" = "$before" ] || exit 0

front="$(lsappinfo info -only bundleid "$(lsappinfo front 2>/dev/null)" 2>/dev/null)"
case "$front" in *"\"$app\""*) exit 0 ;; esac

if [ -f "$transcript" ] && tail -n 40 "$transcript" | jq -rs '
    [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")]
    | last | select(.name != null and (.name | endswith("archive_session")))
    | .input.session_id // empty' 2>/dev/null | grep -qx self; then
  exit 0
fi

sessions="$HOME/Library/Application Support/Claude/claude-code-sessions"
meta="$(grep -rlF --include='local_*.json' "$session" "$sessions" 2>/dev/null | head -n 1)"
id="" title=""
if [ -n "$meta" ]; then
  read -r archived id < <(jq -r '"\(.isArchived // false) \(.sessionId // "")"' "$meta" 2>/dev/null)
  [ "${archived:-false}" = true ] && exit 0
  case "${id:-}" in local_*[!A-Za-z0-9_-]*|local_) id="" ;; local_*) ;; *) id="" ;; esac
  title="$(jq -r '.title // "" | sub("^[^ -~]+ +"; "")' "$meta" 2>/dev/null)"
fi

args=(-title "${title:-Claude}" -message "Finished, waiting for you" -group "claude-finished-${id:-$session}")
if [ -n "$id" ]; then
  args+=(-open "claude://claude.ai/epitaxy/$id")
else
  args+=(-activate "$app")
fi
"$notifier" "${args[@]}" >/dev/null 2>&1
exit 0
