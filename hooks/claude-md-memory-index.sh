#!/usr/bin/env bash

# Claude Code PostToolUse hook, and PreToolUse on Bash. A session that changes a
# rule in CLAUDE.md rewrites the memory notes that still state the old
# behaviour, and a grep for the words of the incident behind the rule misses a
# note that puts the same behaviour in other words. After an Edit or Write of
# CLAUDE.md, or a Bash command that names the file and changed it, this lists
# every project's memory index on stderr, which exit code 2 shows to the model,
# at most once every five minutes per session. Before such a command it keeps
# the file's checksum, so a read, or another session's edit, says nothing.

set -u

config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
rules="$config/CLAUDE.md"
[ -f "$rules" ] && command -v jq >/dev/null 2>&1 || exit 0

tool="" path="" named="" key="" event="" call=""
{
  IFS= read -r tool
  IFS= read -r path
  IFS= read -r named
  IFS= read -r key
  IFS= read -r event
  IFS= read -r call
} < <(jq -r '
  .tool_name // "",
  ((.tool_input.file_path // "") | gsub("\n"; " ")),
  ((.tool_input.command // "") | contains("CLAUDE.md")),
  (.session_id // "") + (if (.agent_id // "") == "" then "" else "-" + .agent_id end),
  .hook_event_name // "",
  .tool_use_id // ""
' 2>/dev/null)
case "$key" in "" | *[^A-Za-z0-9_-]*) key="" ;; esac
case "$call" in *[^A-Za-z0-9_-]*) call="" ;; esac
stamps="${TMPDIR:-/tmp}/claude-md-memory-index"
before="$stamps/$key.$call"

case "$tool" in
  Edit | Write) [ "$path" = "$rules" ] || exit 0 ;;
  Bash)
    [ "$named" = true ] && [ -n "$key" ] && [ -n "$call" ] || exit 0
    if [ "$event" = PreToolUse ]; then
      mkdir -p "$stamps" 2>/dev/null && cksum < "$rules" > "$before"
      exit 0
    fi
    sum="$(cat "$before" 2>/dev/null)"
    rm -f "$before"
    [ -n "$sum" ] && [ "$sum" != "$(cksum < "$rules")" ] || exit 0
    ;;
  *) exit 0 ;;
esac

if [ -n "$key" ] && mkdir -p "$stamps" 2>/dev/null; then
  [ -n "$(find "$stamps/$key" -mmin -5 2>/dev/null)" ] && exit 0
  find "$stamps" -type f -mtime +7 -delete 2>/dev/null
  touch "$stamps/$key"
fi

indexes=""
for index in "$config"/projects/*/memory/MEMORY.md; do
  [ -s "$index" ] || continue
  [ -L "$(dirname "$(dirname "$index")")" ] && continue
  indexes+="$(dirname "$index" | sed "s|^$HOME|~|")/
$(grep -v '^[[:space:]]*$' "$index" | sed 's/^/  /')
"
done
[ -n "$indexes" ] || exit 0

{
  echo "~/.claude/CLAUDE.md changed. Read each memory index line below against the rule you changed, by what the rule governs, such as a tool, a command or a kind of step, never by the words of the incident behind it. Open every note that may state the old behaviour and rewrite or delete it in this turn. The files in ~/.claude/rules/ count too."
  printf '%s' "$indexes"
} >&2
exit 2
