#!/usr/bin/env bash

# Claude Code hook for SessionStart, UserPromptSubmit, and PreToolUse and
# PostToolUse on Bash, Edit, Write and MultiEdit.
# A session reads CLAUDE.md and the pull-requests and commit-messages skills
# once, so an edit made from another session while it runs stays invisible to
# it. This keeps a copy of each file per session and, once one differs from
# its copy, adds the diff to the next prompt or to the next command that
# depends on it: a commit or pull request command for CLAUDE.md and the
# commit-messages skill, a pull request command for the pull-requests skill.
# That command is blocked once with the diff on stderr, unless every change
# lies in a CLAUDE.md section named in context_only. A tool call that starts
# while a file matches its copy and changes it within a minute is the
# session's own edit and updates the copy, apart from an Edit or Write of
# another of the files, a call during which sync.sh's log in the checkout's
# git directory names the file as installed, which the sync at the start of
# another session's prompt can do, and a sync.sh run with no such log.
# Anything else missing lets the prompt or the command through.

set -u

config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
command -v jq >/dev/null 2>&1 || exit 0

event="" key="" pr="" guarded="" tool="" call="" target="" syncs=""
{
  IFS= read -r event
  IFS= read -r key
  IFS= read -r pr
  IFS= read -r guarded
  IFS= read -r tool
  IFS= read -r call
  IFS= read -r target
  IFS= read -r syncs
} < <(jq -r '
  .hook_event_name // "",
  (.session_id // "") + (if (.agent_id // "") == "" then "" else "-" + .agent_id end),
  ((.tool_input.command // "") | test("(^|[^A-Za-z0-9_./-])gh pr (create|edit|merge)")),
  ((.tool_input.command // "") | test("(^|[^A-Za-z0-9_./-])(git( -[Cc] [^ ]+)* commit|gh pr (create|edit|merge))([^A-Za-z0-9_-]|$)") or test("(^|[^A-Za-z0-9_-])sync\\.sh --commit([^A-Za-z0-9_-]|$)")),
  .tool_name // "",
  .tool_use_id // "",
  .tool_input.file_path // "",
  ((.tool_input.command // "") | test("sync\\.sh"))
' 2>/dev/null)
case "$key" in "" | *[^A-Za-z0-9_-]*) exit 0 ;; esac
case "$call" in *[^A-Za-z0-9_-]*) call="" ;; esac

dir="${TMPDIR:-/tmp}/claude-md-snapshots"
mkdir -p "$dir" 2>/dev/null || exit 0

files=("$config/CLAUDE.md" "$config/skills/pull-requests/SKILL.md" "$config/skills/commit-messages/SKILL.md")
suffixes=("" ".pull-requests" ".commit-messages")
installs="$HOME/Projects/dotclaude/.git/sync-installed.log"

# Succeeds when sync.sh keeps no log or installed file $1 at or after epoch $2.
installed_since() {
  [ -f "$installs" ] || return 0
  awk -v t="$2" -v f="$1" '$1 >= t && substr($0, index($0, " ") + 1) == f { found = 1 } END { exit 1 - found }' "$installs"
}

# Prints the marker path of each watched file this tool call may count as its own edit.
own_markers() {
  local i
  [ -n "$call" ] || return 0
  for i in 0 1 2; do
    case "$tool" in
      Bash) ;;
      Edit | Write | MultiEdit) [ "$target" = "${files[$i]}" ] || continue ;;
      *) continue ;;
    esac
    printf '%s %s\n' "$i" "$dir/$key${suffixes[$i]}.pre.$call"
  done
}

case "$event" in
  SessionStart) find "$dir" -type f -mtime +7 -delete 2>/dev/null ;;
  UserPromptSubmit) ;;
  PreToolUse)
    while read -r i marker; do
      snapshot="$dir/$key${suffixes[$i]}"
      [ -f "$snapshot" ] && cmp -s "${files[$i]}" "$snapshot" && date +%s > "$marker"
    done < <(own_markers)
    [ "$guarded" = true ] || exit 0
    ;;
  PostToolUse)
    while read -r i marker; do
      [ -f "$marker" ] || continue
      started="$(cat "$marker" 2>/dev/null)"
      rm -f "$marker"
      case "$started" in "" | *[^0-9]*) continue ;; esac
      [ $(($(date +%s) - started)) -le 60 ] || continue
      { [ "$syncs" = true ] || [ -f "$installs" ]; } && installed_since "${files[$i]}" "$started" && continue
      snapshot="$dir/$key${suffixes[$i]}"
      cmp -s "${files[$i]}" "$snapshot" || cp "${files[$i]}" "$snapshot" 2>/dev/null
    done < <(own_markers)
    exit 0
    ;;
  *) exit 0 ;;
esac

limit=80 notes="" block=""
# CLAUDE.md sections whose rules shape no commit message or PR body.
context_only="Remote state|Git commands|Running things|Documents read aloud|Permissions|Memory hygiene|Prompt feedback"

# Succeeds when every changed line of the diff from the copy lies in a context_only section.
context_only_diff() {
  local touched
  touched="$(diff -U0 "$1" "$2" | awk -v file="$2" '
    BEGIN { while ((getline l < file) > 0) { n++; s[n] = (l ~ /^## /) ? substr(l, 4) : s[n - 1] } }
    /^[-+]## / { print "(heading)" }
    /^@@ / {
      split(substr($3, 2), r, ",")
      first = r[1] + 0
      count = (r[2] == "") ? 1 : r[2] + 0
      if (count == 0) print s[first]
      for (i = first; i < first + count; i++) print s[i]
    }')"
  [ -n "$touched" ] && ! printf '%s\n' "$touched" | grep -qvxE "$context_only"
}

check() {
  local name="$1" file="$2" snapshot="$dir/$key$3" needed="$4" changes total stops=""
  [ -f "$file" ] || return 0
  if [ "$event" = SessionStart ]; then
    cp "$file" "$snapshot" 2>/dev/null
    return 0
  fi
  [ "$event" = PreToolUse ] && [ "$needed" != true ] && return 0
  # A subagent, or a session that started before this hook watched the file,
  # takes its first look as the copy it loaded.
  [ -f "$snapshot" ] || { cp "$file" "$snapshot" 2>/dev/null; return 0; }
  cmp -s "$file" "$snapshot" && return 0
  [ "$file" = "${files[0]}" ] && context_only_diff "$snapshot" "$file" || stops=true
  changes="$(diff -U2 "$snapshot" "$file" | tail -n +3)"
  total="$(printf '%s\n' "$changes" | wc -l | tr -d ' ')"
  if [ "$total" -gt "$limit" ]; then
    changes="$(printf '%s\n' "$changes" | head -n "$limit")
[$((total - limit)) more diff lines cut, read the whole file with the Read tool]"
  fi
  cp "$file" "$snapshot" 2>/dev/null || return 0
  [ -n "$stops" ] && block=true
  notes="${notes:+$notes

}$name changed since this session last saw it. The diff below is in force now:
$changes"
}

check "~/.claude/CLAUDE.md" "${files[0]}" "${suffixes[0]}" "$guarded"
check "~/.claude/skills/pull-requests/SKILL.md" "${files[1]}" "${suffixes[1]}" "$pr"
check "~/.claude/skills/commit-messages/SKILL.md" "${files[2]}" "${suffixes[2]}" "$guarded"
[ -n "$notes" ] || exit 0

if [ "$event" = PreToolUse ] && [ "$block" = true ]; then
  printf '%s\n%s\n' "Blocked once, so no part of the command ran. Bring the message or body in line with the diff below, then run the whole command again." "$notes" >&2
  exit 2
fi
jq -n --arg event "$event" --arg context "$notes" '{hookSpecificOutput: {hookEventName: $event, additionalContext: $context}}'
