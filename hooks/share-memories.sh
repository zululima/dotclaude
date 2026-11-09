#!/usr/bin/env bash

# Claude Code PostToolUse hook that shares project memory with colleagues. The
# untracked shared-memories.conf beside the hooks folder names a clone of a
# shared repository (dir=), the GitHub owners whose repositories are shared
# (owners=) and the user's handle (handle=). When the session's repository has
# its origin under one of those owners and a note of its memory changed, every
# note without share: no in its frontmatter is copied to
# <dir>/<repository>/<handle>/, with ~ for the home directory, then committed
# and pushed in the background. A note that looks like it holds a secret is
# left out, and exit code 2 names it to the model. Without the conf file the
# hook does nothing.

set -u

config_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
conf="$config_dir/shared-memories.conf"
[ -f "$conf" ] || exit 0

setting() { sed -n "s/^$1=//p" "$conf" | head -1; }
dir="$(setting dir)"
dir="${dir/#\~/$HOME}"
owners="$(setting owners)"
handle="$(setting handle)"
[ -n "$dir" ] && [ -n "$owners" ] && [ -n "$handle" ] || exit 0
git -C "$dir" rev-parse --show-toplevel > /dev/null 2>&1 || exit 0

# The memory belongs to the folder the session started in, not to wherever a cd left it.
project="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' 2> /dev/null)}"
[ -n "$project" ] || exit 0
common="$(git -C "$project" rev-parse --path-format=absolute --git-common-dir 2> /dev/null)" || exit 0
root="$(dirname "$common")"
origin="$(git -C "$root" remote get-url origin 2> /dev/null)" || exit 0
slug="$(printf '%s' "$origin" | sed -E 's#^(git@[^:]+:|ssh://[^/]+/|https?://[^/]+/)##; s#\.git$##')"
owner="${slug%%/*}"
repo="${slug#*/}"
case " $owners " in *" $owner "*) ;; *) exit 0 ;; esac

key="$(printf '%s' "$root" | sed 's/[^A-Za-z0-9]/-/g')"
memory="$config_dir/projects/$key/memory"
[ -f "$memory/MEMORY.md" ] || exit 0
state="$config_dir/shared-memories-state"
mkdir -p "$state"
stamp="$state/$key.stamp"
if [ -f "$stamp" ] && [ -z "$(find "$memory" -maxdepth 1 -name '*.md' -newer "$stamp" | head -1)" ]; then
  exit 0
fi
find "$state" -maxdepth 1 -name "$key.lock" -mmin +10 -exec rmdir {} \; 2> /dev/null
mkdir "$state/$key.lock" 2> /dev/null || exit 0
touch "$state/$key.started"

q="[\`'\"]"
nq="[^\`'\"[:space:]]"
lit="[^\$\`'\"[:space:]<{]$nq{7,}"
secret="(password|passwd|salasana)[ :=]*(is )?$q$nq{8,}$q|figd_|ghp_|gho_|ghs_|github_pat_|xox[abpors]-|(^|[^a-z0-9])sk-[a-z0-9_-]{20,}"
secret="$secret|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|npm_[a-z0-9]{36}|glpat-|sbp_[a-f0-9]{40}|[sr]k_live_|AIza[0-9a-z_-]{35}"
secret="$secret|(pgpassword|mysql_pwd|sshpass)=$q?$lit|sshpass +-p *$q?$lit|(mysql|mariadb|mysqldump)[^|;&]* -p$q?$lit"
secret="$secret|--password[= ]$q?$lit|authorization: *(bearer|basic|token) +$lit|(x-api-key|private-token): *$lit"
secret="$secret|://[^/[:space:]:@]+:[^\$/[:space:]@<{][^/[:space:]@]{5,}@[a-z0-9-]+\.[a-z]"
# Claude Code's memory tool moves the flag under metadata: and quotes it on save.
share_value() {
  awk 'NR == 1 && $0 != "---" { exit } NR > 1 && $0 == "---" { exit }
    /^ *share:/ { sub(/^ *share: */, ""); print; exit }' "$1" | tr -d "\"' "
}

new="$(mktemp -d)"
shared=" "
refused=""
for note in "$memory"/*.md; do
  name="$(basename "$note")"
  [ "$name" = MEMORY.md ] && continue
  [ "$(share_value "$note")" = no ] && continue
  if grep -q -i -E "$secret" "$note"; then
    refused="$refused  ${note/#$HOME/~}"$'\n'
    continue
  fi
  sed -e "s|$HOME|~|g" -e '/^ *originSessionId:/d' "$note" > "$new/$name"
  shared="$shared$name "
done
while IFS= read -r line; do
  target="$(printf '%s' "$line" | sed -n 's/.*](\([^)]*\.md\)).*/\1/p')"
  case "$shared" in *" $target "*) printf '%s\n' "$line" ;; esac
done < "$memory/MEMORY.md" > "$new/MEMORY.md"

dest="$dir/$repo/$handle"
mkdir -p "$dest"
rsync -a --delete --exclude '._*' "$new/" "$dest/"
rm -rf "$new"
mv "$state/$key.started" "$stamp"

(
  cd "$dir" || exit 0
  export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes"
  git add -A -- "$repo/$handle"
  if ! git diff --cached --quiet -- "$repo/$handle"; then
    git commit -q -m "Update shared memory notes" -- "$repo/$handle"
  fi
  git fetch -q && git rebase -q --autostash --committer-date-is-author-date && git push -q
  rmdir "$state/$key.lock"
) > /dev/null 2>&1 &

if [ -n "$refused" ]; then
  {
    echo "Not shared with colleagues, since these notes look like they hold a secret:"
    printf '%s' "$refused"
    echo "Move the secret out of the note, or add share: no to its frontmatter."
  } >&2
  exit 2
fi
exit 0
