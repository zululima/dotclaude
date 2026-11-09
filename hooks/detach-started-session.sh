#!/usr/bin/env bash

# Claude Code PostToolUse hook for start_session and hand_off_to_session. No
# session nests under another, yet a started session stays nested under its
# starter until a detach_session call moves it, and the rule alone did not
# make sessions call it. After each such call this hands the model the step.

set -u
cat >/dev/null

context="No session nests under another. If this call started a session, \
call detach_session with the local_ id its result gives in your next message, \
before any other step. A proposal card is detached in the message that learns \
the user started it. The detached session reports nothing back: link it in \
the reply."

jq -n --arg context "$context" \
  '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $context}}'
