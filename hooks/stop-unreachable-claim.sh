#!/usr/bin/env bash

# Claude Code Stop hook. When the turn's closing message says in the first
# person that Claude could not open, read, reach, access, view, download,
# upload, attach, load, find, get, fetch or list something, and no Claude in
# Chrome tool ran since the prompt, it sends the turn back once, so Chrome
# is tried or the reply says why it cannot help. A session whose transcript
# never names the extension's tools passes. The phrase list is a
# heuristic, in English and in Finnish, where the verb alone carries the
# first person. The turn is read from the transcript, whose format Claude
# Code does not document, so a change there makes this hook quietly pass.

set -u

command -v jq >/dev/null 2>&1 || exit 0
input="$(cat 2>/dev/null)"
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = false ] || exit 0
transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)"
[ -f "$transcript" ] || exit 0
browser=mcp__claude-in-chrome__
grep -qF "$browser" "$transcript" 2>/dev/null || exit 0
last="$(printf '%s' "$input" | jq -r '.last_assistant_message // empty' 2>/dev/null)"

q="['\\x{2019}]"
claim="\\bI(${q}m| am| was| have)? (could ?n${q}?t|could not|can${q}?t|cannot|can not|was ?n${q}?t able to|not able to|unable to|no way to)\\b[^.\\n]{0,40}\\b(open|read|reach|access|view|download|upload|attach|load|find|get|fetch|list)\\b"
finnish="\\b(en (saanut|pystynyt|voinut|onnistunut)\\b[^.\\n]{0,60}\\b(auki|ava|lue|luk|hae|hak|la[dt]a|tavoit|yhtey)|en päässyt\\b|jäi (lukematta|avaamatta|hakematta|lataamatta|tavoittamatta)\\b|ei (auennut|latautunut)\\b)"
claim="(${claim}|${finnish})"

jq -Rn -e --arg re "$claim" --arg last "$last" --arg browser "$browser" '
  [inputs | fromjson? // empty] as $lines
  | ([$lines | to_entries[] | select(.value.type == "user" and .value.origin != null) | .key]
     | last) as $turn
  | $turn != null
    and ([$lines[$turn:][] | select(.type == "assistant") | .message.content[]?] as $said
         | (if $last != "" then $last
            else [$said[] | select(.type == "text") | .text] | last // "" end
            | test($re; "i"))
           and all($said[] | select(.type == "tool_use") | .name; startswith($browser) | not))
' "$transcript" >/dev/null 2>&1 || exit 0

echo "This reply says something could not be opened, read, found or reached, and no Claude in Chrome tool ran this turn. Grep the project's memory for a recipe, then try it in Chrome, where the user is signed in. If Chrome cannot help, such as with the desktop app's own screen or another machine, say why in the reply." >&2
exit 2
