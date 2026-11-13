#!/usr/bin/env bash

# Claude Code PreToolUse hook on Bash. Blocks a git commit, or a sync.sh
# --commit, when a prompt its message quotes uses an abbreviation that an
# earlier commit message expanded under Abbreviations:, in the same repository
# or in the configuration checkout, and the message's own Abbreviations:
# section leaves it out. It names the lines to add, each from the newest commit
# that gave it. It reads the command text and the file named by -F, --file or
# sync.sh --commit. A word is flagged once per session and set of quoted
# prompts, so one that means something else here costs a single retry.

set -u

input="$(cat)"
case "$input" in *commit*) ;; *) exit 0 ;; esac
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
if printf '%s\n' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_.-])sync\.sh[[:space:]]+--commit[[:space:]]'; then
  form=sync
elif printf '%s\n' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_./-])git( -[Cc] [^ ]+)* commit'; then
  form=git
else
  exit 0
fi
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
[ -n "$cwd" ] || cwd="$PWD"
key="$(printf '%s' "$input" |
  jq -r '(.session_id // "") + (if (.agent_id // "") == "" then "" else "-" + .agent_id end)' 2>/dev/null)"
case "$key" in "" | *[!A-Za-z0-9_-]*) key=session ;; esac

# A path may name a variable the command sets itself, as in SP=<dir> && git
# commit -F $SP/msg.txt.
assigned="$(printf '%s\n' "$cmd" |
  grep -oE '(^|[;&|(][[:space:]]*)(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=[^[:space:];&|)]+' |
  sed -E 's/^[;&|([:space:]]*(export[[:space:]]+)?//')"

expand() {
  local path="$1" name value
  while IFS='=' read -r name value; do
    [ -n "$name" ] || continue
    value="$(printf '%s' "$value" | tr -d "\"'")"
    path="${path//\$\{$name\}/$value}"
    path="${path//\$$name/$value}"
  done <<<"$assigned"
  path="$(printf '%s' "$path" | tr -d "\"'")"
  case "$path" in
    "~/"*) printf '%s\n' "$HOME/${path#"~/"}" ;;
    /*) printf '%s\n' "$path" ;;
    *) printf '%s\n' "$2/$path" ;;
  esac
}

cd_arg="$(printf '%s\n' "$cmd" |
  sed -nE 's/.*(^|[;&|(])[[:space:]]*cd[[:space:]]+([^[:space:];&|)]+).*/\2/p' | tail -n 1)"
[ -z "$cd_arg" ] || cwd="$(expand "$cd_arg" "$cwd")"
dir="$cwd"
if [ "$form" = sync ]; then
  call="$(printf '%s\n' "$cmd" |
    grep -oE '[^[:space:];&|()]*sync\.sh[[:space:]]+--commit[[:space:]]+[^[:space:];&|)]+' | head -n 1)"
  case "${call%%[[:space:]]*}" in */*) dir="$(dirname "$(expand "${call%%[[:space:]]*}" "$cwd")")" ;; esac
  files="$(expand "${call##*[[:space:]]}" "$cwd")"
else
  c_arg="$(printf '%s\n' "$cmd" | sed -nE 's/.*git -C ([^[:space:];&|]+) .*/\1/p' | head -n 1)"
  [ -z "$c_arg" ] || dir="$(expand "$c_arg" "$cwd")"
  files="$(printf '%s\n' "$cmd" |
    grep -oE '(^|[[:space:]])(-F|--file)([[:space:]]+|=)[^[:space:];&|)]+' |
    sed -E 's/^[[:space:]]*(-F|--file)([[:space:]]+|=)//' |
    while IFS= read -r arg; do [ "$arg" = - ] || expand "$arg" "$dir"; done)"
fi
git -C "$dir" rev-parse --git-dir >/dev/null 2>&1 || exit 0

text="$cmd"
while IFS= read -r file; do
  [ -n "$file" ] && [ -f "$file" ] && text="$text
$(cat "$file")"
done <<<"$files"

# Abbreviation lines run from an Abbreviations: line to the next blank line,
# and a trailer such as Signed-off-by that follows without one is skipped.
# A key such as "pr, prs" stands for each of its words, and a word matches
# whole, ignoring case, but not as a file extension such as the md of a .md.
missing="$(awk '
  function key(line,   k) {
    sub(/^- /, "", line)
    if (line !~ /^[^:]+: ./) return ""
    k = tolower(substr(line, 1, index(line, ":") - 1))
    return (length(k) > 24 || k ~ /-by$/) ? "" : k
  }
  function hasword(s, w,   i, p, b, a) {
    p = 0
    while ((i = index(substr(s, p + 1), w)) > 0) {
      p += i
      b = substr(s, p - 1, 1)
      a = substr(s, p + length(w), 1)
      if ((p == 1 || b !~ /[a-z0-9.]/) && a !~ /[a-z0-9]/) return 1
    }
    return 0
  }
  FNR == 1 { file++; ab = 0 }
  $0 == "Abbreviations:" { ab = 1; next }
  $0 == "" || $0 == "\001" { ab = 0 }
  ab && (k = key($0)) != "" {
    line = $0
    sub(/^- /, "", line)
    n = split(k, ws, /, */)
    for (j = 1; j <= n; j++)
      if (file == 1 && !(ws[j] in gloss)) gloss[ws[j]] = line
      else if (file == 2) listed[ws[j]]
    next
  }
  file == 2 && /^Prompts behind this/ { prompts = 1; next }
  file == 2 && prompts && /^>/ { sub(/^> ?/, ""); quoted = quoted " " tolower($0) }
  END { for (w in gloss) if (!(w in listed) && hasword(quoted, w)) print w "\t" gloss[w] }
' <(git -C "$dir" log --format='%x01%n%B' 2>/dev/null
    git -C "$HOME/Projects/setup" log --format='%x01%n%B' 2>/dev/null) \
  <(printf '%s\n' "$text"))"
[ -n "$missing" ] || exit 0

state="${TMPDIR:-/tmp}/claude-abbreviations"
mkdir -p "$state" 2>/dev/null || exit 0
find "$state" -type f -mtime +7 -delete 2>/dev/null
quotes="$(printf '%s\n' "$text" | grep '^>' | cksum | cut -d ' ' -f 1)"
new=0
while IFS=$'\t' read -r word line; do
  mark="$state/$key-$quotes-$(printf '%s' "$word" | cksum | cut -d ' ' -f 1)"
  [ -f "$mark" ] || { new=1; : >"$mark"; }
done <<<"$missing"
[ "$new" -eq 1 ] || exit 0

cat >&2 <<EOF
Blocked by ~/.claude/hooks/abbreviations-listed.sh, so no part of the command
ran: the quoted prompts use abbreviations that earlier commit messages
expanded, and this message's Abbreviations: section leaves them out. Add these
lines to that section, or open one with them after the last prompt, before any
trailer:

$(printf '%s\n' "$missing" | cut -f 2- | sort -u)

A message file this command writes, as with a cat heredoc, was not written and
holds what it held before, if it exists: add the lines to the command's own
text, never to the file, and run the whole command again. Leave out a line
whose word means something else here. Each word is flagged once, so the command
then goes through.
EOF
exit 2
