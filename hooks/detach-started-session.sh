#!/usr/bin/env bash

# Claude Code PostToolUse hook for start_session and hand_off_to_session. No
# session nests under another, yet a started session stays nested under its
# starter until a detach_session call moves it, and the rule alone did not
# make sessions call it. After each such call this hands the model the step,
# and the archive step of a spawner, which only the model can judge it is.

set -u
cat >/dev/null

context="No session nests under another. If this call started a session, \
call detach_session with the local_ id its result gives in your next message, \
before any other step. A proposal card is detached in the message that learns \
the user started it. The detached session reports nothing back. If this session \
is a spawner, one that handed its task to another or started the next job's \
session and has nothing else left, then once detach_session and any send of the \
task (set_session_model, set_session_effort, send_message) returned without an \
error, call wrap_up with a recap alone, then archive_session with self as the \
turn's last call, and write no closing reply: no link, no model line, no Prompt \
feedback. On any error stay and report it in a normal closing reply. A session \
with work of its own left, or one that used hand_off_to_session to answer a new \
message, is no spawner: link the new session in the reply."

jq -n --arg context "$context" \
  '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $context}}'
