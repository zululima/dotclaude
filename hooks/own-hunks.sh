#!/usr/bin/env bash

# Claude Code hook for PreToolUse, PostToolUse and PostToolUseFailure on Bash,
# Edit, Write and MultiEdit. Several sessions edit the files the dotclaude
# checkout publishes at once, so this records the changes each one makes, and
# sync.sh --commit commits only the calling session's. Before a call it writes
# each published file the call may change into the checkout's object store:
# the file an Edit or Write names, and for Bash each one the command names, the
# ones reflow.sh rewraps, or all of them when the command names another
# script. A command that runs sync.sh gets none, since a peer's edit during its
# push would count as this session's, and nor does one run in the background.
# After the call, failed or not, each of them that changed adds a line
# "<before> <after> <path>" of blob ids to .git/own-hunks/<session> in the
# checkout, unless sync.sh installed it or a pull rewrote it meanwhile. A
# published file is one the checkout tracks, PROMPTS.md aside, watched in the
# configuration directory when the mirrored list in sync.sh names it and in
# the checkout otherwise, where an Edit or Write of either copy counts. Records
# and snapshots left for 14 days are dropped. Anything missing lets the call
# through without a word.

set -u

config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
checkout="$HOME/Projects/dotclaude"
store="$checkout/.git/own-hunks"
installs="$checkout/.git/sync-installed.log"
[ -d "$checkout/.git" ] && [ -f "$checkout/sync.sh" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

event="" session="" call="" scope="" target="" command=""
{
  IFS= read -r event
  IFS= read -r session
  IFS= read -r call
  IFS= read -r scope
  IFS= read -r target
  IFS= read -r -d '' command
} < <(jq -r '
  (.tool_input.command // "") as $c
  | .hook_event_name // "",
    .session_id // "",
    .tool_use_id // "",
    (if .tool_name == "Bash" then
       if .tool_input.run_in_background == true
         or ($c | test("(^|[;&|(\\n])\\s*(\\w+=\\S*\\s+|(bash|sh|zsh|exec|time|nohup|env)\\s+)*[\"\\x27]?([^\\s;&|()<>]*/)?sync\\.sh[\"\\x27]?([\\s;&|)]|$)"))
       then "none"
       elif ($c | gsub("(reflow|sync)\\.sh"; "") | test("[\\w-]\\.(sh|zsh|bash|py|mjs|cjs|js|ts|rb|pl|swift)\\b")) then "all"
       elif ($c | test("reflow\\.sh")) then "reflow"
       else "named" end
     elif .tool_name == "Edit" or .tool_name == "Write" or .tool_name == "MultiEdit" then "target"
     else "none" end),
    .tool_input.file_path // "",
    $c
' 2>/dev/null)
case "$session" in "" | *[^A-Za-z0-9_-]*) exit 0 ;; esac
case "$call" in "" | *[^A-Za-z0-9_-]*) exit 0 ;; esac
pending="$store/pending/$session.$call"

# Prints "<path>\t<file>" for each published path and the copy of it watched.
published() {
  git -C "$checkout" -c core.quotePath=false ls-files 2>/dev/null | LC_ALL=C awk -v config="$config" -v checkout="$checkout" '
    FNR == NR { if ($0 == "mirrored=(") on = 1; else if ($0 == ")") on = 0; else if (on) mirrored[$1] = 1; next }
    $0 != "PROMPTS.md" { print $0 "\t" ($0 in mirrored ? config : checkout) "/" $0 }
  ' "$checkout/sync.sh" -
}

# Succeeds when sync.sh installed file $1 at or after epoch $2.
installed_since() {
  [ -f "$installs" ] && awk -v t="$2" -v f="$1" '$1 >= t && substr($0, index($0, " ") + 1) == f { found = 1 } END { exit 1 - found }' "$installs"
}

case "$event" in
  PreToolUse)
    case "$scope" in
      none) exit 0 ;;
      target) case "$target" in "$config"/* | "$checkout"/*) ;; *) exit 0 ;; esac ;;
    esac
    mkdir -p "$store/pending" 2>/dev/null || exit 0
    find "$store" -type f -mtime +14 -delete 2>/dev/null
    watched="$(published | CMD="$command" LC_ALL=C awk -F '\t' -v scope="$scope" -v target="$target" -v checkout="$checkout" '
      function named(path,   base) { base = path; sub(/.*\//, "", base); return index(ENVIRON["CMD"], path) || index(ENVIRON["CMD"], base) }
      scope == "target" { if (target == $2 || target == checkout "/" $1) print $1 "\t" target; next }
      scope == "all" || named($1) || (scope == "reflow" && $1 ~ /^((CLAUDE|README)\.md|skills\/pull-requests\/SKILL\.md|docs\/[^\/]*\.md)$/)
    ' | while IFS=$'\t' read -r path file; do
      [ ! -f "$file" ] || printf '%s\t%s\n' "$path" "$file"
    done)"
    [ -n "$watched" ] || exit 0
    blobs="$(printf '%s\n' "$watched" | cut -f 2 | git -C "$checkout" hash-object -w --no-filters --stdin-paths 2>/dev/null)" || exit 0
    {
      date +%s
      git -C "$checkout" rev-parse HEAD 2>/dev/null || echo none
      paste <(printf '%s\n' "$blobs") <(printf '%s\n' "$watched")
    } > "$pending" 2>/dev/null
    ;;
  PostToolUse | PostToolUseFailure)
    [ -f "$pending" ] || exit 0
    { IFS= read -r started; IFS= read -r head; watched="$(cat)"; } < "$pending"
    rm -f "$pending"
    now="$(git -C "$checkout" rev-parse HEAD 2>/dev/null || echo none)"
    present="$(printf '%s\n' "$watched" | while IFS=$'\t' read -r before path file; do
      [ ! -f "$file" ] || printf '%s\t%s\t%s\n' "$before" "$path" "$file"
    done)"
    [ -n "$present" ] || exit 0
    afters="$(printf '%s\n' "$present" | cut -f 3 | git -C "$checkout" hash-object -w --no-filters --stdin-paths 2>/dev/null)" || exit 0
    paste <(printf '%s\n' "$afters") <(printf '%s\n' "$present") | while IFS=$'\t' read -r after before path file; do
      [ "$after" != "$before" ] || continue
      installed_since "$file" "$started" && continue
      [ "$now" != "$head" ] && [ "$(git -C "$checkout" rev-parse --verify --quiet "$now:$path")" = "$after" ] && continue
      printf '%s %s %s\n' "$before" "$after" "$path" >> "$store/$session"
    done
    ;;
esac
exit 0
