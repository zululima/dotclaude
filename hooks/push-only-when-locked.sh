#!/usr/bin/env bash

# Claude Code PreToolUse hook for PushNotification. It refuses the push while
# the marker file that CLAUDE_CLIENT_PRESENCE_FILE names exists, which the
# presence listener keeps there while the screen is on and unlocked. Claude
# Code's own presence check covers only sessions bridged from the terminal, and
# the desktop app sends a session's push to the phone whenever no window shows
# that session, also while the user works in another one.

set -u

marker="${CLAUDE_CLIENT_PRESENCE_FILE:-}"
[ -n "$marker" ] && [ -e "$marker" ] || exit 0

reason="The screen is on and unlocked, so the user is at it and a push would only \
reach their phone needlessly. Leave it out: put the ask first in the reply, where \
the app's sidebar shows that this session waits."

jq -n --arg reason "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse",
  permissionDecision: "deny", permissionDecisionReason: $reason}}'
