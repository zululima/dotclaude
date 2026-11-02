#!/bin/bash

# Moves what an archived desktop session left behind, its drafts folder and the
# ~/Downloads files named after it, to ~/.claude/archive/<task>/, and rewrites
# the memory notes and background files that name an old path. The
# archive-files mod runs it whenever the desktop app rewrites its index of
# archived sessions. That index and the session records beside it are the
# app's own undocumented files, so an app update can stop this without an
# error; the log then shows no runs after an archive.
#
# A session's tasks are the ~/.claude/drafts/<task> folders its tool calls
# name. A task moves when the session changed its folder or one of its
# ~/Downloads/<task>-* files, and no session still open names it.
#
#   archive-files.sh                          move for every session archived since the last run
#   archive-files.sh --dry-run <local_id>...  print what would move for those sessions

set -u
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

sessions="$HOME/Library/Application Support/Claude/claude-code-sessions"
archive="$HOME/.claude/archive"
seen="$archive/.archived-sessions"
log="$HOME/Library/Logs/claude-archive-files.log"
dry=

say() {
  if [ -n "$dry" ]; then echo "$*"; else echo "$(date '+%F %T') $*" >>"$log"; fi
}

tool_inputs() {
  jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
    | .input | tostring' "$1" 2>/dev/null
}

transcript_of() {
  local cli
  cli=$(jq -r '.cliSessionId // empty' "$1")
  [ -n "$cli" ] || return 0
  find "$HOME/.claude/projects" -mindepth 2 -maxdepth 2 -name "$cli.jsonl" 2>/dev/null | head -1
}

# The transcripts of the sessions not archived, read once per run.
open_transcripts() {
  [ -n "${open_list:-}" ] && return
  open_list="$work/open"
  : >"$open_list"
  for r in "$sessions"/*/*/local_*.json; do
    [ "$(jq -r '.isArchived == true' "$r" 2>/dev/null)" = false ] || continue
    t=$(transcript_of "$r")
    [ -n "$t" ] && echo "$t" >>"$open_list"
  done
}

named_by_open_session() {
  local t
  open_transcripts
  while IFS= read -r t; do
    [ "$t" = "$current" ] && continue
    grep -qF "drafts/$1" "$t" 2>/dev/null || continue
    tool_inputs "$t" | grep -qE "\.claude/drafts/$1([^A-Za-z0-9._-]|$)" && return 0
  done <"$open_list"
  return 1
}

rewrite_notes() {
  local old=$1 new=$2 f
  for f in "$HOME"/.claude/projects/*/memory/*.md "$HOME"/.claude/rules/*.md "$HOME"/.claude/about-me/*.md; do
    [ -f "$f" ] || continue
    grep -qF -e "~/${old#"$HOME"/}" -e "$old" "$f" || continue
    cp "$f" "$work/note"
    OLD="~/${old#"$HOME"/}" NEW="~/${new#"$HOME"/}" perl -pi -e 's{\Q$ENV{OLD}\E(?![A-Za-z0-9._-])}{$ENV{NEW}}g' "$f"
    OLD="$old" NEW="$new" perl -pi -e 's{\Q$ENV{OLD}\E(?![A-Za-z0-9._-])}{$ENV{NEW}}g' "$f"
    cmp -s "$f" "$work/note" || say "  rewrote ${f/#$HOME/~}"
  done
}

move_task() {
  local task=$1 since=$2 drafts="$HOME/.claude/drafts/$1" dest="$archive/$1" files=() f e changed=
  shopt -s nullglob dotglob
  for f in "$HOME/Downloads/$task"-* "$HOME/Downloads/$task".*; do
    [ -f "$f" ] && [ -n "$(find "$f" -mmin "-$since")" ] && files+=("$f")
  done
  [ -d "$drafts" ] && [ -n "$(find "$drafts" -type f -mmin "-$since" | head -1)" ] && changed=1
  if [ -z "$changed" ] && [ ${#files[@]} -eq 0 ]; then
    say "  $task: nothing this session changed"
    return
  fi
  if named_by_open_session "$task"; then
    say "  $task: kept, a session still open names it"
    return
  fi
  if [ -n "$dry" ]; then
    [ -d "$drafts" ] && say "  $task: would move ${drafts/#$HOME/~} to ${dest/#$HOME/~}"
    for f in ${files[@]+"${files[@]}"}; do say "  $task: would move ${f/#$HOME/~} to ${dest/#$HOME/~}/downloads/"; done
    return
  fi
  mkdir -p "$archive"
  if [ -d "$drafts" ]; then
    if [ -e "$dest" ]; then
      for e in "$drafts"/*; do
        to=$(place "$e" "$dest")
        [ "$to" = "$dest/${e##*/}" ] || rewrite_notes "$e" "$to"
      done
      rmdir "$drafts"
    else
      mv "$drafts" "$dest"
    fi
    say "  $task: moved ${drafts/#$HOME/~} to ${dest/#$HOME/~}"
    rewrite_notes "$drafts" "$dest"
  fi
  for f in ${files[@]+"${files[@]}"}; do
    mkdir -p "$dest/downloads"
    to=$(place "$f" "$dest/downloads")
    say "  $task: moved ${f/#$HOME/~} to ${to/#$HOME/~}"
    rewrite_notes "$f" "$to"
  done
}

# Moves $1 into the folder $2, numbering its name when the folder holds it
# already, as render-2.html, and prints where it went.
place() {
  local name=${1##*/} stem ext n=2 to
  stem=$name ext=
  if [ -f "$1" ] && [[ $name == ?*.* ]]; then
    stem=${name%.*} ext=.${name##*.}
  fi
  to="$2/$name"
  while [ -e "$to" ]; do
    to="$2/$stem-$n$ext"
    n=$((n + 1))
  done
  mv "$1" "$to"
  echo "$to"
}

handle() {
  local record=$1 t created since task
  t=$(transcript_of "$record")
  current=$t
  say "$(jq -r '.title // .sessionId' "$record")"
  if [ -z "$t" ]; then
    say "  no transcript on this machine"
    return
  fi
  created=$(jq -r '(.createdAt // 0) / 1000 | floor' "$record")
  since=$(( ($(date +%s) - created) / 60 + 2 ))
  for task in $(tool_inputs "$t" | grep -oE '\.claude/drafts/[A-Za-z0-9_-][A-Za-z0-9._-]*' | sed 's|.*/||' | sort -u); do
    [ -f "$HOME/.claude/drafts/$task" ] || move_task "$task" "$since"
  done
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ "${1:-}" = --dry-run ]; then
  dry=1
  shift
  for id in "$@"; do
    for record in "$sessions"/*/*/"$id".json; do
      [ -f "$record" ] && handle "$record"
    done
  done
  exit 0
fi

lock="$archive/.archive-files.lock"
mkdir -p "$archive"
locked=
for _ in $(seq 60); do
  mkdir "$lock" 2>/dev/null && locked=1 && break
  [ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ] && rmdir "$lock"
  sleep 1
done
[ -n "$locked" ] || exit 0
trap 'rm -rf "$work"; rmdir "$lock"' EXIT

: >"$work/now"
for idx in "$sessions"/*/*/archived-sessions.idx; do
  [ -f "$idx" ] || continue
  jq -r '.archived[]' "$idx" | sort >"$work/ids"
  cat "$work/ids" >>"$work/now"
  [ -f "$seen" ] || continue
  for id in $(comm -13 "$seen" "$work/ids"); do
    [ -f "${idx%/*}/$id.json" ] && handle "${idx%/*}/$id.json"
  done
done
sort -u "$work/now" >"$seen"
