#!/usr/bin/env bash

# Claude Code PreToolUse hook for start_session. Refuses a proposal card, an
# "own_initiative" or an "offer", which the user has to click, where a
# next-step box question takes one shortcut. The models skill's rule alone did
# not stop the cards. Starting a session the user said yes to goes through.

set -u

command -v jq >/dev/null 2>&1 || exit 0
initiation="$(jq -r '.tool_input.initiation // empty' 2>/dev/null)" || exit 0
case "$initiation" in own_initiative | offer) ;; *) exit 0 ;; esac

cat >&2 <<'EOF'
Refused by ~/.claude/hooks/no-session-cards.sh: an offer to start a session is
a question in the next-step box, never a card. Load the models skill, then ask
in wrap_up whether to start the task in its own session, with its model and
effort in full and the yes as the first button, and say in the closing message
why that model and effort fit its task. On the yes, call start_session with
initiation "user_asked".
EOF
exit 2
