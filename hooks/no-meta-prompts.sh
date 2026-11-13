#!/usr/bin/env bash

# Claude Code PreToolUse hook on Bash. Blocks a git commit, or a gh pr create,
# edit or merge, once when a prompt its message or body quotes has a sentence
# that opens with mirror, global ruling, global memory or memory:, the words
# that mark an ask about the Claude Code setup, which stays out of a project's
# history, or with dotclaude, the name of the setup repository until
# 2026-11-13, which older prompts still open with. It reads the command text
# and the files named by -F, --file and --body-file. The configuration checkout
# and the directories its sync-mirrors.txt lists are let through, since there
# such prompts are the ones behind the change, and so is the same command with
# the same message run again.

set -u

command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
printf '%s\n' "$cmd" |
  grep -Eq '(^|[^A-Za-z0-9_./-])(git( -[Cc] [^ ]+)* commit|gh pr (create|edit|merge))' || exit 0
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
[ -n "$cwd" ] || cwd="$PWD"
key="$(printf '%s' "$input" |
  jq -r '(.session_id // "") + (if (.agent_id // "") == "" then "" else "-" + .agent_id end)' 2>/dev/null)"
case "$key" in "" | *[!A-Za-z0-9_-]*) key=session ;; esac

expand() {
  local path
  path="$(printf '%s' "$1" | tr -d "\"'")"
  case "$path" in
    "~/"*) printf '%s\n' "$HOME/${path#"~/"}" ;;
    /*) printf '%s\n' "$path" ;;
    *) printf '%s\n' "$2/$path" ;;
  esac
}

dir="$cwd"
c_arg="$(printf '%s\n' "$cmd" | sed -nE 's/.*git -C ([^[:space:];&|]+) .*/\1/p' | head -n 1)"
[ -z "$c_arg" ] || dir="$(expand "$c_arg" "$cwd")"

config_repo="$HOME/Projects/setup"
top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)"
if [ -n "$top" ]; then
  [ "$top" = "$config_repo" ] && exit 0
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    case "$(expand "$line" "$config_repo")/" in "$top"/*) exit 0 ;; esac
  done < <(cat "$config_repo/sync-mirrors.txt" 2>/dev/null)
fi

text="$cmd"
while IFS= read -r arg; do
  [ "$arg" != - ] || continue
  file="$(expand "$arg" "$dir")"
  [ -f "$file" ] && text="$text
$(cat "$file")"
done < <(printf '%s\n' "$cmd" |
  grep -oE '(^|[[:space:]])(-F|--file|--body-file)([[:space:]]+|=)[^[:space:];&|)]+' |
  sed -E 's/^[[:space:]]*(-F|--file|--body-file)([[:space:]]+|=)//')

# A prompt is a number line, 3. or **3.**, then its > lines, joined so that a
# sentence wrapped across lines still counts and a wrapped line does not count
# as a sentence start. A blank > line ends a sentence.
hits="$(printf '%s\n' "$text" | awk '
  function flush() {
    if (n != "" && !(n in seen) &&
        tolower(quote) ~ /(^|[.?!|] )(mirror|dotclaude|global (ruling|memory)|memory:)/) {
      seen[n]
      hits = hits (hits == "" ? "" : ", ") n
    }
    quote = ""
  }
  /^(\*\*)?[0-9]+\.(\*\*)?[[:space:]]*$/ { flush(); n = $0; gsub(/[^0-9]/, "", n); next }
  /^[[:space:]]*>/ {
    sub(/^[[:space:]]*> ?/, "")
    quote = ($0 == "" ? quote " |" : (quote == "" ? $0 : quote " " $0))
    next
  }
  { flush(); n = "" }
  END { flush(); print hits }')"
[ -n "$hits" ] || exit 0

state="${TMPDIR:-/tmp}/claude-meta-prompts"
mkdir -p "$state" 2>/dev/null || exit 0
find "$state" -type f -mtime +7 -delete 2>/dev/null
mark="$state/$key-$(printf '%s' "$text" | cksum | cut -d ' ' -f 1)"
[ -f "$mark" ] && exit 0
: >"$mark" 2>/dev/null || exit 0

case "$hits" in *,*) which="prompts $hits" ;; *) which="prompt $hits" ;; esac
cat >&2 <<EOF
Blocked once by ~/.claude/hooks/no-meta-prompts.sh, so no part of the command
ran: a sentence in quoted $which opens with mirror, dotclaude, global ruling,
global memory or memory:, the words that mark an ask about the Claude Code
setup. ~/.claude/CLAUDE.md leaves meta prompts out of a project's commits and
PR bodies. Replace that part with a bracketed note such as [a request about the
Claude Code setup left out], and leave out a prompt that holds nothing else. A
message or body file this command writes, as with a cat heredoc, was not
written and holds what it held before, if it exists: make the change in the
command's own text, never in the file, and run the whole command again. When
the words are about the change itself, run the command again unchanged.
EOF
exit 2
