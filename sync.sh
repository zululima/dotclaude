#!/usr/bin/env bash

# Keeps the mirrored files in sync between the local Claude Code configuration
# directory and this checkout, in both directions, then scans everything that
# would be published for values that must stay private. Exits non-zero on a
# conflict or a scan hit, so nothing gets committed by reflex.
#
#   sync.sh            pull, reconcile, scan, show git status
#   sync.sh --install  copy every mirrored file from the checkout into the
#                      configuration directory (first run on a new machine);
#                      an existing file that differs is kept as <file>.bak
#   sync.sh --commit <message-file> <path>...
#                      sync, then commit the paths, . for everything, with the
#                      message, list what stays uncommitted and push, then
#                      commit and push the same paths in every mirror, the
#                      message gaining a line that names the commit here, then
#                      list the open PRs of the gh user whose body links this
#                      repository but not the commit just pushed. Named paths
#                      of which none but PROMPTS.md has a change stop the run
#                      before the commit.
#
# Reconciling: a file the pull changed is installed locally, a file changed
# only in the checkout, its local copy still as committed, is installed
# locally too, any other local change is copied into the checkout, and a file
# changed both locally and by the pull stops the run. So does a pull git
# refuses, such as one a change in the checkout would be overwritten by; a
# fetch that fails, as when offline, does not. Literals listed one per line in
# sync-allow.txt are exempt from the scan.
#
# Lock: hooks/dotclaude-sync.sh runs this on every prompt of every session, so
# a run takes .git/sync.lock, holding its process id, and waits for another
# that holds it. A run between another's pull and its installs would copy the
# old local file over the pulled one.
#
# Install log: each file installed into the configuration directory adds a
# line "<epoch> <path>" to .git/sync-installed.log, so
# hooks/claude-md-changed.sh can tell an install from a session's own edit.
#
# Checks: this script, reflow.sh and every mirrored shell script must parse,
# every mirrored file needs an entry in docs/what-you-get.md, its own or its
# folder's, and no prose line of CLAUDE.md, README.md, docs/ or the
# pull-requests skill may pass 100 columns, leaving out front matter, code
# blocks, tables and the evals block; reflow.sh rewraps the paragraphs an edit
# touched. A CLAUDE.md larger than the byte count in claude-md-budget.txt gets
# its sections listed by size, and fails the check when --commit names it. A
# failed check, like a scan hit, stops the mirror copy and the commit.
#
# Key order: a mirrored JSON file changed locally is first put back into the
# key order the checkout has, when jq is installed, so a tool that writes the
# whole file back in its own order leaves a diff of the values alone.
#
# Literals listed one per line in sync-deny.txt, which git ignores, fail the
# scan wherever they appear, in any case: the names and labels of a private
# project. sync.sh --check-message <file> checks a commit message against the
# same list, for a commit-msg hook, less the literals listed one per line in
# sync-deny-skip.txt in the git directory of the repository it runs in, such
# as an employer's name in a repository the employer owns.
#
# Mirrors: directories listed one per line in sync-mirrors.txt, which git
# ignores, get a copy of every published file after a clean scan, for a second
# copy kept in another repository. A leading ~/ stands for the home directory.
# A file this checkout has deleted is removed from a mirror too.
#
# Private files: paths under the configuration directory listed one per line
# in sync-private.txt, which git ignores, are copied from there into every
# mirror and never into this checkout. They skip the identity and deny-list
# scans and keep the credential scans. Named after --commit they are committed
# in the mirrors only, and when they are all the run names, or the only ones
# with a change, nothing is committed here. --install takes each from the
# first mirror that has it.
#
# PROMPTS.md, when the checkout has one, is rebuilt by hooks/prompts-md.sh
# before the scan, with the commit message when there is one, and goes into
# every commit. A rebuild left uncommitted is dropped before the pull, which
# it would block, since every commit changes the file.

set -euo pipefail

source_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
checkout="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
installed_log="$checkout/.git/sync-installed.log"
{ : >> "$installed_log"; } 2>/dev/null || installed_log=/dev/null

message_file=""
commit_paths=()
if [ "${1:-}" = "--commit" ]; then
  if [ ! -f "${2:-}" ]; then
    echo "sync: --commit needs a message file" >&2
    exit 2
  fi
  message_file="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
  shift 2
  if [ "$#" -eq 0 ]; then
    echo "sync: --commit needs the paths this session changed after the message file" >&2
    exit 2
  fi
  commit_paths=("$@")
fi

deny_args=()
if [ -f "$checkout/sync-deny.txt" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "" | "#"*) ;;
      *) deny_args+=(-e "$line") ;;
    esac
  done < "$checkout/sync-deny.txt"
fi

if [ "${1:-}" = "--check-message" ]; then
  skip="$(git rev-parse --git-common-dir 2>/dev/null || true)/sync-deny-skip.txt"
  if [ -f "$skip" ] && [ "${#deny_args[@]}" -gt 0 ]; then
    terms=("${deny_args[@]}")
    deny_args=()
    for ((i = 1; i < ${#terms[@]}; i += 2)); do
      grep -q -i -x -F -e "${terms[i]}" "$skip" || deny_args+=(-e "${terms[i]}")
    done
  fi
  if [ "${#deny_args[@]}" -gt 0 ] && grep -v '^#' "$2" | grep -n -i -F "${deny_args[@]}" >&2; then
    echo "sync: the commit message names a term from sync-deny.txt" >&2
    exit 1
  fi
  exit 0
fi

mirrored=(
  CLAUDE.md
  settings.json
  hooks/calendar-free-busy-only.sh
  hooks/dotclaude-sync.sh
  hooks/git-fetch-prune.sh
  hooks/git-fetch-before-remote-base.sh
  hooks/git-prune-gone-branches.sh
  hooks/git-submodule-update-after-switch.sh
  hooks/check-not-piped.sh
  hooks/no-git-checkout.sh
  hooks/no-identity-override.sh
  hooks/no-home-search.sh
  hooks/prompt-log.sh
  hooks/memory-plain-characters.sh
  hooks/claude-md-memory-index.sh
  hooks/share-memories.sh
  hooks/stop-running-stack.sh
  hooks/usage-log.sh
  hooks/stack-held-by-peer.sh
  hooks/claude-md-changed.sh
  hooks/no-github-posts.sh
  hooks/one-draft-pr-per-repo.sh
  hooks/prompt-feedback-box.sh
  hooks/no-meta-prompts.sh
  hooks/abbreviations-listed.sh
  hooks/prompts-md.sh
  hooks/prompts-md-current.sh
  hooks/cd-fall-through.sh
  hooks/slack-user-search-own-workspace.sh
  hooks/permission-mode-changed.sh
  hooks/no-foreground-wait.sh
  hooks/stop-unreachable-claim.sh
  hooks/no-slow-binary-grep.sh
  hooks/push-only-when-locked.sh
  hooks/pane-bridge.mjs
  presence/install.sh
  presence/lock-listener.swift
  mods/session-usage/.claude-plugin/plugin.json
  mods/session-usage/hooks/hooks.json
  mods/session-usage/hooks/register.ts
  mods/session-usage/hooks/register.test.ts
  mods/session-usage/usage.sh
  skills/commit-messages/SKILL.md
  skills/dotclaude/SKILL.md
  skills/pull-requests/SKILL.md
  skills/pull-requests/pane-upload.sh
  skills/pull-requests/review-page/build.py
  skills/pull-requests/review-page/template.html
  skills/slack-draft/SKILL.md
  skills/slack-draft/copy-rich.sh
  workflows/dream.js
  agents/dream-worker.md
)

install_file() {
  mkdir -p "$(dirname "$2")"
  cp "$1" "$2"
  case "$2" in "$source_dir"/*) echo "$(date +%s) $2" >> "$installed_log" ;; esac
}

same_file() {
  [ "$(git hash-object "$1" 2>/dev/null)" = "$(git hash-object "$2" 2>/dev/null)" ]
}

same_as_commit() {
  [ "$(git rev-parse --verify --quiet "$1:$2")" = "$(git hash-object "$3")" ]
}

keep_key_order() {
  command -v jq >/dev/null 2>&1 || return 0
  same_file "$1" "$2" && return 0
  local ordered
  ordered="$(jq --slurpfile old "$1" '
    def order($o):
      if type == "object" and ($o | type) == "object" then
        . as $n
        | [($o | keys_unsorted[] | select(. as $k | $n | has($k))),
           ($n | keys_unsorted[] | select(. as $k | $o | has($k) | not))]
        | reduce .[] as $k ({}; .[$k] = ($n[$k] | order($o[$k])))
      else . end;
    order($old[0])' "$2" 2>/dev/null)" || return 0
  printf '%s\n' "$ordered" | cmp -s - "$2" || printf '%s\n' "$ordered" > "$2"
}

mirror_dirs=()
if [ -f "$checkout/sync-mirrors.txt" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "") ;;
      "~/"*) mirror_dirs+=("$HOME/${line#"~/"}") ;;
      *) mirror_dirs+=("$line") ;;
    esac
  done < "$checkout/sync-mirrors.txt"
fi

private=()
if [ -f "$checkout/sync-private.txt" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "" | "#"*) ;;
      *) private+=("$line") ;;
    esac
  done < "$checkout/sync-private.txt"
fi

is_private() {
  local path
  for path in ${private[@]+"${private[@]}"}; do
    [ "$path" != "$1" ] || return 0
  done
  return 1
}

if [ "${1:-}" = "--install" ]; then
  for path in "${mirrored[@]}"; do
    target="$source_dir/$path"
    if [ -f "$target" ] && ! same_file "$checkout/$path" "$target"; then
      cp "$target" "$target.bak"
    fi
    install_file "$checkout/$path" "$target"
  done
  for path in ${private[@]+"${private[@]}"}; do
    target="$source_dir/$path"
    for dir in ${mirror_dirs[@]+"${mirror_dirs[@]}"}; do
      if [ -f "$dir/$path" ]; then
        if [ -f "$target" ] && ! same_file "$dir/$path" "$target"; then
          cp "$target" "$target.bak"
        fi
        install_file "$dir/$path" "$target"
        break
      fi
    done
  done
  exit 0
fi

public_paths=()
private_paths=()
for path in ${commit_paths[@]+"${commit_paths[@]}"}; do
  if is_private "$path"; then
    private_paths+=("$path")
  else
    public_paths+=("$path")
  fi
done

lock="$checkout/.git/sync.lock"
waited=0
until (set -o noclobber; echo "$$" > "$lock") 2>/dev/null; do
  holder="$(cat "$lock" 2>/dev/null || true)"
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    rm -f "$lock"
    continue
  fi
  if [ "$waited" -ge 120 ]; then
    echo "sync: run $holder still holds $lock" >&2
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done
trap 'rm -f "$lock"' EXIT

cd "$checkout"
before="$(git rev-parse HEAD)"
failed=0
if git fetch --quiet 2>/dev/null; then
  git restore -- PROMPTS.md 2>/dev/null || true
  if ! merge_error="$(git merge --ff-only --quiet '@{upstream}' 2>&1)"; then
    printf 'sync: pull refused, reconciling against the local HEAD only\n%s\n' "$merge_error" >&2
    failed=1
  fi
else
  echo "sync: fetch failed, reconciling against the local HEAD only" >&2
fi

for path in "${mirrored[@]}"; do
  local_file="$source_dir/$path"
  repo_file="$checkout/$path"
  if [ ! -f "$local_file" ]; then
    install_file "$repo_file" "$local_file"
    continue
  fi
  if git diff --quiet "$before" HEAD -- "$path"; then
    case "$path" in *.json) keep_key_order "$repo_file" "$local_file" ;; esac
    if ! same_file "$local_file" "$repo_file"; then
      if same_as_commit HEAD "$path" "$local_file"; then
        install_file "$repo_file" "$local_file"
        echo "sync: $path changed only in the checkout, installed locally"
      else
        install_file "$local_file" "$repo_file"
      fi
    fi
  elif same_as_commit "$before" "$path" "$local_file"; then
    install_file "$repo_file" "$local_file"
  elif ! same_file "$local_file" "$repo_file"; then
    echo "sync: $path changed both locally and in the pulled commits, merge by hand" >&2
    failed=1
  fi
done

if [ -n "$message_file" ] && [ "${commit_paths[*]}" != . ] && { [ "${#public_paths[@]}" -eq 0 ] ||
  [ -z "$(git status --porcelain -- "${public_paths[@]}" ':(exclude)PROMPTS.md')" ]; }; then
  if [ "${#private_paths[@]}" -eq 0 ]; then
    echo "sync: none of the named paths changed, nothing committed" >&2
    exit 1
  fi
  public_paths=()
fi

if [ -f "$checkout/PROMPTS.md" ]; then
  if [ -n "$message_file" ] && [ "${#public_paths[@]}" -gt 0 ]; then
    "$checkout/hooks/prompts-md.sh" --message "$message_file"
    case " ${public_paths[*]} " in *" . "* | *" PROMPTS.md "*) ;; *) public_paths+=(PROMPTS.md) ;; esac
  else
    "$checkout/hooks/prompts-md.sh"
  fi
fi

allow_args=()
if [ -f "$checkout/sync-allow.txt" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    if [ -n "$line" ]; then
      allow_args+=(-e "$line")
    fi
  done < "$checkout/sync-allow.txt"
fi

files=()
scan_files=()
while IFS= read -r -d '' path; do
  [ -e "$path" ] || continue
  files+=("$path")
  case "$path" in LICENSE*|sync-allow.txt) continue ;; esac
  scan_files+=("$path")
done < <(git ls-files -z --cached --others --exclude-standard)
if [ "${#scan_files[@]}" -eq 0 ]; then
  exit "$failed"
fi

scan() {
  local label="$1"
  shift
  local hits
  hits="$(grep -n "$@" -- "${scan_files[@]}" 2>/dev/null || true)"
  if [ -n "$hits" ] && [ "${#allow_args[@]}" -gt 0 ]; then
    hits="$(printf '%s\n' "$hits" | grep -v -F "${allow_args[@]}" || true)"
  fi
  if [ -n "$hits" ]; then
    printf 'sync: %s in\n' "$label" >&2
    printf '%s\n' "$hits" | cut -d: -f1,2 | sed 's/^/  /' >&2
    failed=1
  fi
}

private_values=("$HOME")
login="$(id -un)"
if [ "$login" != root ]; then
  private_values+=("$login")
fi
for key in user.name user.email; do
  value="$(git config --global "$key" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    private_values+=("$value")
  fi
  case "$value" in *@*) private_values+=("${value#*@}") ;; esac
done
for value in "${private_values[@]}"; do
  scan "local identity" -i -F -e "$value"
done

scan "home path" -E -e '/(Users|home)/[A-Za-z0-9._-]+'
if [ "${#deny_args[@]}" -gt 0 ]; then
  scan "term from sync-deny.txt" -i -F "${deny_args[@]}"
fi
scan "email address" -E -e '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
scan_credentials() {
  scan "credential-like string$1" -E \
    -e '(gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}' \
    -e 'sk-[A-Za-z0-9_-]{16,}' \
    -e 'xox[abprs]-[A-Za-z0-9-]+' \
    -e 'AKIA[0-9A-Z]{16}' \
    -e 'AIza[0-9A-Za-z_-]{35}' \
    -e 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}' \
    -e '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  scan "credential-like assignment$1" -i -E \
    -e '(api[_-]?key|secret|token|passw(or)?d)[^A-Za-z0-9]{0,3}[:=][^A-Za-z0-9]{0,3}[A-Za-z0-9/+_.-]{16,}'
}
scan_credentials ""

scan_files=()
for path in ${private[@]+"${private[@]}"}; do
  if [ -f "$source_dir/$path" ]; then
    scan_files+=("$source_dir/$path")
  else
    echo "sync: private file $path is missing locally, its mirror copies stay as they are" >&2
  fi
done
if [ "${#scan_files[@]}" -gt 0 ]; then
  scan_credentials " in a private file"
fi

for path in sync.sh reflow.sh "${mirrored[@]}"; do
  case "$path" in *.sh) bash -n "$path" || failed=1 ;; esac
done
for path in ${scan_files[@]+"${scan_files[@]}"}; do
  case "$path" in *.sh) bash -n "$path" || failed=1 ;; esac
done
for path in "${mirrored[@]}"; do
  entry="$path"
  until grep -q -F -e "(../$entry)" -e "(../$entry/" docs/what-you-get.md; do
    case "$entry" in
      */*/*) entry="${entry%/*}" ;;
      *)
        echo "sync: docs/what-you-get.md has no entry for $path" >&2
        failed=1
        break
        ;;
    esac
  done
done
long="$(LC_ALL=C awk '
  FNR == 1 { front = ($0 == "---"); code = 0; evals = 0 }
  front { if (FNR > 1 && $0 == "---") front = 0; next }
  /^[ \t]*```/ { code = !code; next }
  /^<!-- evals:start -->/ { evals = 1 }
  /^<!-- evals:end -->/ { evals = 0; next }
  code || evals || /^[ \t]*\|/ { next }
  { s = $0; gsub(/[\200-\277]/, "", s) }
  length(s) > 100 { print "  " FILENAME ":" FNR }
' CLAUDE.md README.md docs/*.md skills/pull-requests/SKILL.md)"
if [ -n "$long" ]; then
  printf 'sync: line over 100 columns in\n%s\n' "$long" >&2
  printf 'sync: %s rewraps them, run it on its own\n' "$checkout/reflow.sh" >&2
  failed=1
fi

if [ -f claude-md-budget.txt ]; then
  claude_md_size="$(wc -c < CLAUDE.md | tr -d ' ')"
  claude_md_budget="$(tr -d ' \n' < claude-md-budget.txt)"
  if [ "$claude_md_size" -gt "$claude_md_budget" ]; then
    printf 'sync: CLAUDE.md is %s bytes, %s over claude-md-budget.txt, by section:\n' \
      "$claude_md_size" "$((claude_md_size - claude_md_budget))" >&2
    LC_ALL=C awk '/^## / { name = $0 } name != "" { size[name] += length($0) + 1 }
      END { for (s in size) printf "  %6d %s\n", size[s], s }' CLAUDE.md | sort -rn >&2
    echo "sync: --commit refuses CLAUDE.md until it fits, the dotclaude skill says what to ask" >&2
    case " ${public_paths[*]+${public_paths[*]}} " in
      *" . "* | *" CLAUDE.md "* | *" ./CLAUDE.md "*) failed=1 ;;
    esac
  fi
fi

if [ "$failed" -eq 0 ] && [ "${#mirror_dirs[@]}" -gt 0 ]; then
  for dir in "${mirror_dirs[@]}"; do
    if [ ! -d "$dir" ]; then
      echo "sync: mirror directory $dir does not exist" >&2
      failed=1
      continue
    fi
    for path in "${files[@]}"; do
      install_file "$checkout/$path" "$dir/$path"
    done
    for path in ${private[@]+"${private[@]}"}; do
      if [ -f "$source_dir/$path" ]; then
        install_file "$source_dir/$path" "$dir/$path"
      fi
    done
    published=$'\n'"$(printf '%s\n' "${files[@]}")"$'\n'
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      case "$published" in *$'\n'"$path"$'\n'*) continue ;; esac
      rm -f "$dir/$path"
    done < <({
      git log --no-renames --diff-filter=D --name-only --format=
      git diff --cached --no-renames --diff-filter=D --name-only
      git ls-files --deleted
    } | sort -u)
    [ -n "$message_file" ] || echo "sync: published files copied into $dir, commit there too"
  done
fi

git status --short

if [ -n "$message_file" ] && [ "$failed" -ne 0 ]; then
  echo "sync: nothing committed, fix the above first" >&2
elif [ -n "$message_file" ]; then
  committed=0
  if [ "${#public_paths[@]}" -gt 0 ]; then
    git add -A -- "${public_paths[@]}"
    if git diff --cached --quiet -- "${public_paths[@]}"; then
      echo "sync: nothing to commit here" >&2
    else
      git commit -q -F "$message_file" -- "${public_paths[@]}"
      committed=1
    fi
  fi
  left="$(git status --short)"
  [ -z "$left" ] || printf 'sync: left uncommitted\n%s\n' "$left"
  git push -q
  hash="$(git rev-parse --short HEAD)"
  echo "sync: $hash pushed"
  mirror_message="$(mktemp)"
  if [ "$committed" -eq 1 ]; then
    awk -v line="Mirrors $(basename "$checkout") $hash." '
      done == 0 && /^Prompts behind this commit/ { print line; print ""; done = 1 }
      { print }
      END { if (done == 0) { print ""; print line } }
    ' "$message_file" > "$mirror_message"
  else
    cp "$message_file" "$mirror_message"
  fi
  mirror_paths=(${public_paths[@]+"${public_paths[@]}"} ${private_paths[@]+"${private_paths[@]}"})
  for dir in ${mirror_dirs[@]+"${mirror_dirs[@]}"}; do
    git -C "$dir" fetch -q
    git -C "$dir" rebase -q --autostash --committer-date-is-author-date
    git -C "$dir" add -A -- "${mirror_paths[@]}"
    git -C "$dir" diff --cached --quiet -- "${mirror_paths[@]}" ||
      git -C "$dir" commit -q -F "$mirror_message" -- "${mirror_paths[@]}"
    git -C "$dir" push -q
    echo "sync: $(git -C "$dir" rev-parse --short HEAD) pushed in $dir"
  done
  rm -f "$mirror_message"
  if command -v gh >/dev/null 2>&1; then
    repo_url="$(git remote get-url origin | sed -E 's#^git@([^:]+):#https://\1/#; s#\.git$##')"
    pin="$repo_url/tree/$(git rev-parse HEAD)"
    stale="$(gh search prs --author @me --state open --limit 100 --json url --jq '.[].url' |
      while IFS= read -r pr; do
        body="$(gh pr view "$pr" --json body --jq .body)" || continue
        if [[ "$body" == *"$repo_url"* && "$body" != *"$pin"* ]]; then
          echo "  $pr"
        fi
      done)" || echo "sync: could not list the open PRs" >&2
    [ -z "$stale" ] || printf 'sync: open PRs whose link pins an older commit\n%s\n' "$stale"
  fi
fi
exit "$failed"
