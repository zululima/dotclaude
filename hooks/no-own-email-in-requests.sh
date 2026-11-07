#!/usr/bin/env bash

# Claude Code PreToolUse hook for Bash, Write, Edit, MultiEdit, NotebookEdit,
# WebFetch and WebSearch. Refuses a call that would send one of your own email
# addresses to a website, or writes a script that would: in a User-Agent, a
# From header or a mailto contact, in a URL, or in a web search. The addresses
# come from the signed-in account, CLAUDE_CODE_USER_EMAIL, git config and the
# untracked ~/.claude/own-addresses.txt, one per line, so none is written here.
# A script that reads the address while it runs from a file it was not given
# in the same call is not seen.

set -u

command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
tool="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null)" || exit 0
case "$tool" in
  Bash | Write | Edit | MultiEdit | NotebookEdit | WebFetch | WebSearch) ;;
  *) exit 0 ;;
esac
file="$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")"
case "$file" in */hooks/no-own-email-in-requests.sh) exit 0 ;; esac

text="$(jq -r '.tool_input
  | [.command, .content, .new_string, .new_source, .url, .query,
     (.edits // [] | .[].new_string)]
  | map(select(type == "string")) | join("\n")' <<<"$input")"
lower="$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]')"
case "$lower" in
  *@* | *%40* | *claude_code_user_email* | *user.email* | *oauthaccount*) ;;
  *) exit 0 ;;
esac

cwd="$(jq -r '.cwd // empty' <<<"$input")"
addrs="$(
  {
    jq -r '.oauthAccount.emailAddress // empty' "$HOME/.claude.json" 2>/dev/null
    printf '%s\n' "${CLAUDE_CODE_USER_EMAIL:-}"
    git config --global user.email 2>/dev/null
    [ -n "$cwd" ] && git -C "$cwd" config user.email 2>/dev/null
    grep -v '^#' "$HOME/.claude/own-addresses.txt" 2>/dev/null
  } | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]//g' | grep '@' | sort -u
)"

named=0
in_url=0
urls="$(printf '%s\n' "$lower" | grep -Eo 'https?://[^[:space:]"'"'"'<>`]+')"
while IFS= read -r addr; do
  [ -n "$addr" ] || continue
  encoded="${addr/@/%40}"
  case "$lower" in *"$addr"* | *"$encoded"*) named=1 ;; *) continue ;; esac
  if [ -n "$urls" ] && printf '%s\n' "$urls" | grep -qF -e "$addr" -e "$encoded"; then
    in_url=1
  fi
done <<<"$addrs"
case "$lower" in
  *claude_code_user_email* | *user.email* | *oauthaccount*) referenced=1 ;;
  *) referenced=0 ;;
esac
[ "$named" = 1 ] || [ "$referenced" = 1 ] || exit 0

where=()
case "$tool" in
  WebSearch) [ "$named" = 1 ] && where+=("a web search") ;;
  WebFetch) [ "$in_url" = 1 ] && where+=("a URL") ;;
  *)
    [ "$in_url" = 1 ] && where+=("a URL")
    if printf '%s\n' "$lower" | grep -Eq 'user[-_ ]?agent' ||
      printf '%s\n' "$text" | grep -Eq '(^|[^[:alnum:]_-])(curl([[:space:]][^|;&]*)?[[:space:]]-A|wget([[:space:]][^|;&]*)?[[:space:]]-U)([[:space:]"'"'"']|$)'; then
      where+=("a User-Agent")
    fi
    if printf '%s\n' "$lower" | grep -Eq -- '-h[[:space:]]*["'"'"']?from:|["'"'"']from["'"'"'][[:space:]]*:[[:space:]]*([a-z_]+[,}]|["'"'"'][^"'"'"']*@)'; then
      where+=("a From header")
    fi
    if printf '%s\n' "$lower" |
      sed -E 's/href=["'"'"']?mailto:/href=/g; s/\]\(mailto:/](/g' |
      grep -Eq 'mailto["'"'"']?[[:space:]]*[:=]'; then
      where+=("a mailto contact")
    fi
    ;;
esac
[ "${#where[@]}" -gt 0 ] || exit 0

places="$(printf '%s, ' "${where[@]}")"
places="${places%, }"
cat >&2 <<EOF
Refused by ~/.claude/hooks/no-own-email-in-requests.sh: this call would send
one of the user's own email addresses to a website, or writes a script that
would, in ${places}. A site that asks scripts for a contact address is no
reason to give it theirs. Send a generic User-Agent such as
claude-code/<version> with no contact, or leave the address out. If the user
asked in chat for their address to go to this site, give them the command to
run themselves.
EOF
exit 2
