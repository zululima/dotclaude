#!/usr/bin/env bash

# Claude Code PreToolUse hook for Bash. Refuses a command that carries a
# credential as a literal value: a key in a provider's format, a password or
# token in an environment assignment, after sshpass -p, mysql -p or a flag such
# as --password, in an Authorization header, or in an address. An approved
# command is saved as typed, by "Yes, and don't ask again" into
# .claude/settings.local.json, and the transcript keeps it either way. A value
# read from a variable or a command substitution goes through, and so do
# placeholders, common local defaults such as root, and a password or token in
# a command whose every target is a local host or a container.

set -u

command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
[ -n "$cmd" ] || exit 0
cmd="${cmd//$'\\\n'/ }"

printf '%s\n' "$cmd" | grep -Eqi 'pass|pwd|secret|token|key|auth|://|sk-|_pat_|gh[pousr]_|glpat|npm_|xox|sbp_|_live_|figd_|eyJ|BEGIN|-u' || exit 0

v='[A-Za-z0-9!#%&+,./:;=?@^_~-]'
q="[\"']?"
found=()

matches() { printf '%s\n' "$cmd" | grep -oE "$@" || true; }
strip_quote() { local s="${1#[\"\']}"; printf '%s' "$s"; }

default_value() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    root | postgres | password | passwd | secret | admin | test | testing | dev | local | example | \
      changeme | mysql | mariadb | pass | guest | demo | 1234 | 123456 | 12345678 | qwerty) return 0 ;;
    *placeholder* | *redacted* | *your_* | *your-* | *_here | *-here | xxx* | '***'*) return 0 ;;
    *[!0-9]*) return 1 ;;
  esac
  return 0
}

local_host() {
  case "$1" in
    localhost | *.localhost | *.test | *.local | *.internal | 127.* | 0.0.0.0 | ::1 | '[::1]' | 10.* | 192.168.*) return 0 ;;
    172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) return 0 ;;
    *.* | *:*) return 1 ;;
  esac
  return 0
}

hosts="$(matches '[A-Za-z][A-Za-z0-9+.-]*://[^/[:space:]"'\''?#]+' | sed -E 's#^.*://##; s#^.*@##; s#:[0-9]*$##')
$(matches '(psql|pg_dump|pg_restore|mysql|mariadb|mysqldump|mysqladmin|redis-cli|mongosh)[^|;&]*[[:space:]](-h|--host)[[:space:]=]*[A-Za-z0-9.:_-]+' |
  sed -E 's/^.*(-h|--host)[[:space:]=]*//')
$(matches '(ssh|scp|sftp|rsync)[^|;&]*[[:space:]][A-Za-z0-9._-]+@[A-Za-z0-9.-]+' | sed -E 's/^.*@//')"

local_only() {
  local any=1 host
  printf '%s\n' "$cmd" | grep -Eq 'docker(-compose)?[^|;&]*[[:space:]]exec[[:space:]]' && any=0
  while IFS= read -r host; do
    [ -n "$host" ] || continue
    local_host "$host" || return 1
    any=0
  done <<EOF
$hosts
EOF
  return $any
}

secret() {
  local label="$1" value="$2"
  default_value "$value" && return
  local_only && return
  found+=("$label (${value:0:4}...)")
}

while IFS= read -r m; do
  [ -n "$m" ] || continue
  m="${m#[^A-Za-z0-9-]}"
  found+=("a key in a provider's format (${m:0:6}...)")
done <<EOF
$(for pattern in 'sk-ant-[A-Za-z0-9_-]{20,}' 'sk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}' '(gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}' \
  'glpat-[A-Za-z0-9_-]{20,}' 'npm_[A-Za-z0-9]{36}' 'xox[abprs]-[A-Za-z0-9-]{10,}' 'AKIA[0-9A-Z]{16}' 'AIza[0-9A-Za-z_-]{35}' \
  'sbp_[a-f0-9]{40}' '[sr]k_live_[A-Za-z0-9]{20,}' 'figd_[A-Za-z0-9_-]{20,}' '-----BEGIN [A-Z ]*PRIVATE KEY'; do
  matches "(^|[^A-Za-z0-9_])$pattern"
done)
EOF

while IFS= read -r m; do
  [ -n "$m" ] || continue
  secret "a JSON web token" "${m#[^A-Za-z0-9]}"
done <<EOF
$(matches '(^|[^A-Za-z0-9_])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}')
EOF

while IFS= read -r m; do
  [ -n "$m" ] || continue
  name="${m%%=*}"
  secret "the value of ${name#[^A-Za-z0-9_]}" "$(strip_quote "${m#*=}")"
done <<EOF
$(printf '%s\n' "$cmd" | grep -ioE "(^|[^A-Za-z0-9_])[A-Za-z0-9_-]*(passw(or)?d|_pwd|secret|token|api_?key|access_key)=$q$v{6,}" || true)
EOF

while IFS= read -r m; do
  [ -n "$m" ] || continue
  secret "a password after sshpass -p" "$(strip_quote "$(printf '%s' "$m" | sed -E 's/^sshpass[[:space:]]+-p[[:space:]]*//')")"
done <<EOF
$(matches "sshpass[[:space:]]+-p[[:space:]]*$q$v{4,}")
EOF

while IFS= read -r m; do
  [ -n "$m" ] || continue
  secret "a password after -p" "$(strip_quote "${m##*[[:space:]]-p}")"
done <<EOF
$(matches "(mysql|mariadb|mysqldump|mysqladmin|mysqlsh|mysqlimport)[^|;&]*[[:space:]]-p$q$v{2,}")
EOF

while IFS= read -r m; do
  [ -n "$m" ] || continue
  secret "the value of ${m%%[[:space:]]*}" "$(strip_quote "$(printf '%s' "$m" | sed -E 's/^[^[:space:]]+[[:space:]]+//')")"
done <<EOF
$(matches -e "--(password|passwd|token|api-key|apikey|secret|client-secret|auth-token|access-token)[[:space:]]+$q$v{6,}")
EOF

while IFS= read -r m; do
  [ -n "$m" ] || continue
  pair="$(strip_quote "$(printf '%s' "$m" | sed -E 's/^.*(-u|--user)[[:space:]=]*//')")"
  secret "a password after -u" "${pair#*:}"
done <<EOF
$(matches "(curl|wget|http|https)[^|;&]*[[:space:]](-u|--user)[[:space:]=]*$q[^[:space:]:\"'\$]+:$v{4,}")
EOF

while IFS= read -r m; do
  [ -n "$m" ] || continue
  secret "a token in a header" "$(printf '%s' "$m" | grep -oE '[^[:space:]:]+$')"
done <<EOF
$(printf '%s\n' "$cmd" | grep -ioE "(authorization|proxy-authorization|x-api-key|api-key|x-auth-token|private-token|x-goog-api-key|x-access-token)[[:space:]]*:[[:space:]]*((bearer|basic|token|bot)[[:space:]]+)?$v{8,}" || true)
EOF

while IFS= read -r m; do
  [ -n "$m" ] || continue
  rest="${m#*://}"
  pair="${rest%%@*}"
  password="${pair#*:}"
  host="${m##*@}"
  default_value "$password" || local_host "$host" || found+=("a password in an address on $host (${password:0:4}...)")
done <<EOF
$(matches "[A-Za-z][A-Za-z0-9+.-]*://[^/[:space:]:@\"'\$]+:[A-Za-z0-9!#%&+,.:;=?^_~-]{3,}@[A-Za-z0-9.-]*")
EOF

[ "${#found[@]}" -eq 0 ] && exit 0

{
  printf 'Refused by ~/.claude/hooks/no-secrets-in-commands.sh: the command carries a\n'
  printf 'credential as a literal value:\n\n'
  printf '  %s\n' "${found[@]}" | awk '!seen[$0]++'
  cat <<'EOF'

Claude Code saves an approved command as typed, "Yes, and don't ask again"
into .claude/settings.local.json, and the transcript keeps it either way. Have
the command read the value when it runs, from a file, the keychain or the
environment, so only a name is recorded, and never type the value into the
command in another variable either:

  set -a && . ./.env && set +a && psql "$DATABASE_URL"
  PGPASSWORD="$(security find-generic-password -w -s <item>)" psql -h <host>
  curl -H "Authorization: Bearer $(gh auth token)" https://api.github.com/user
  sshpass -f <file holding the password> ssh <user>@<host>
EOF
} >&2
exit 2
