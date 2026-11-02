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
# Claude Code saves hook context over 10,000 characters to a file and shows
# the session only its first 2,000, so a longer diff comes as the new text of
# each change, and what still does not fit comes with the next prompt or the
# next Bash, Edit or Write call: the copy moves on only past what was shown.

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

# Succeeds when an earlier prompt or call showed only part of a diff.
pending() {
  local suffix
  for suffix in "${suffixes[@]}"; do
    [ -f "$dir/$key$suffix.rest" ] && return 0
  done
  return 1
}

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
    [ "$guarded" = true ] || pending || exit 0
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

limit=9000 notes="" block=""
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

# Prints the added lines of each change from copy $1 to file $2 under its
# section and first line, as many as $3 characters hold. The first line
# printed is empty, or when the rest did not fit, the last line shown and the
# line of the copy it stands for.
passages() {
  diff -U0 "$1" "$2" | awk -v file="$2" -v room="$3" '
    BEGIN { while ((getline l < file) > 0) { n++; s[n] = (l ~ /^## /) ? substr(l, 4) : s[n - 1] } }
    NR <= 2 || cut { next }
    /^@@ / {
      split(substr($2, 2), o, ","); split(substr($3, 2), r, ",")
      a = o[1] + 0; c = (o[2] == "") ? 1 : o[2] + 0; line = r[1] + 0
      head = "[" (s[line] == "" ? "" : s[line] ", ") "line " line "]"
      if (r[2] == "0") { upto = line; from = a + c - 1 } else { upto = line - 1; from = (c == 0) ? a : a - 1 }
      next
    }
    /^\+/ {
      need = length($0) + (head == "" ? 0 : length(head) + 1)
      if (used + need > room) { cut = 1; next }
      out = out (head == "" ? "" : head "\n") substr($0, 2) "\n"
      used += need; head = ""; upto = line++; from = (c == 0) ? a : a + c - 1
    }
    END {
      if (cut) out = out "[The changes after line " upto " come with the next prompt or the next Bash, Edit or Write call]\n"
      printf "%s\n%s", (cut ? upto " " from : ""), out
    }'
}

check() {
  local name="$1" file="$2" snapshot="$dir/$key$3" needed="$4" changes lead cut="" stops=""
  [ -f "$file" ] || return 0
  if [ "$event" = SessionStart ]; then
    cp "$file" "$snapshot" 2>/dev/null
    rm -f "$snapshot.rest"
    return 0
  fi
  [ "$event" = PreToolUse ] && [ "$needed" != true ] && [ ! -f "$snapshot.rest" ] && return 0
  # A subagent, or a session that started before this hook watched the file,
  # takes its first look as the copy it loaded.
  [ -f "$snapshot" ] || { cp "$file" "$snapshot" 2>/dev/null; return 0; }
  cmp -s "$file" "$snapshot" && { rm -f "$snapshot.rest"; return 0; }
  [ "$file" = "${files[0]}" ] && context_only_diff "$snapshot" "$file" || stops=true
  lead="$name changed since this session last saw it. The diff below is in force now:"
  changes="$(diff -U2 "$snapshot" "$file" | tail -n +3)"
  if [ $((${#notes} + ${#lead} + ${#changes} + 3)) -gt "$limit" ]; then
    lead="$name changed since this session last saw it. Its diff is too long to show whole, so below is the new text of each change under its section and first line, with removed lines left out. It is in force now:"
    changes="$(passages "$snapshot" "$file" $((limit - ${#notes} - ${#lead} - 103)))"
    cut="${changes%%$'\n'*}" changes="${changes#*$'\n'}"
    case "$changes" in "[The changes after"*) lead="[$name changed too. Its changes come with the next prompt or the next Bash, Edit or Write call]" changes="" ;; esac
  fi
  if [ -n "$cut" ]; then
    { awk -v n="${cut% *}" 'NR > n { exit } 1' "$file" && tail -n "+$((${cut#* } + 1))" "$snapshot"; } > "$snapshot.next" &&
      mv -f "$snapshot.next" "$snapshot" && : > "$snapshot.rest" || return 0
  else
    cp "$file" "$snapshot" 2>/dev/null || return 0
    rm -f "$snapshot.rest"
  fi
  [ -n "$stops" ] && [ "$needed" = true ] && block=true
  notes="${notes:+$notes

}$lead${changes:+
$changes}"
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
