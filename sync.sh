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
# locally too, and any other local change is copied into the checkout. A file
# changed both locally and by the pull is copied into the checkout as well
# when its local copy holds the pulled change already, as it does once a file
# sync between two computers brought it over from the one that committed it:
# against the pulled version it removes no line the pull wrote and adds back
# no line the pull removed. Any other such file stops the run. So does a pull
# git refuses, such as one that would overwrite a change here to a file that
# is not mirrored; a fetch that fails, as when offline, does not. Literals
# listed one per line in sync-allow.txt are exempt from the scan.
#
# Refused pull: a pull refused only over mirrored files whose copy here holds
# the same bytes as the local one runs after all. Those copies go back to
# HEAD, which loses nothing while the local copy stands, the pull
# fast-forwards, and the reconciling above copies back what the local copy
# holds beyond the pulled commits. That is the state a file sync leaves when
# the other computer committed and pushed the file first.
#
# Lock: hooks/mirror-sync.sh runs this on every prompt of every session, so
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
# A file this checkout has deleted is removed from a mirror too. From the copy
# to the mirror's push, a run holds claude-clone.lock in the git directory of
# each mirror's clone, which hooks/share-memories.sh takes too before it writes
# there, and a lock older than 10 minutes counts as left behind. A clone with a
# rebase stopped halfway stops the run, and under --commit a rebase onto the
# fetched commits that stops is undone.
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
#
# Own edits: hooks/own-hunks.sh records each edit a session makes to a
# published file in .git/own-hunks/<session>, and --commit builds its commit
# in an index of its own, starting from HEAD. A named file that the session in
# CLAUDE_CODE_SESSION_ID has recorded edits of gets HEAD's version with those
# edits made in it in turn, any HEAD holds already skipped, so another
# session's changes stay in the work tree; any other named file, a new one, and
# every file for ., goes in whole. An edit that changes lines HEAD lacks stops
# the run with its diff, since it waits for the commit of the session that
# wrote them; deleting the session's lines for that path from its records lets
# the file go in whole instead. So that no commit takes another session's
# hunks, the run also stops on a version to commit that holds an edit another
# session recorded and HEAD lacks, and on a file that goes in whole and changed
# since a call of another session that watches it began, if that call began in
# the last 15 minutes and still runs. The checks then read the staged version
# of each named file and pass over the others, a scan hit in the work tree only
# keeps that file out of the mirror copy, each mirror commits the version
# committed here, and the session's records of the named files go once they
# are in.

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
  hooks/mirror-sync.sh
  hooks/git-fetch-prune.sh
  hooks/git-fetch-before-remote-base.sh
  hooks/git-prune-gone-branches.sh
  hooks/git-submodule-update-after-switch.sh
  hooks/check-not-piped.sh
  hooks/no-git-checkout.sh
  hooks/no-identity-override.sh
  hooks/no-own-email-in-requests.sh
  hooks/no-secrets-in-commands.sh
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
  hooks/archive-when-done.sh
  hooks/no-meta-prompts.sh
  hooks/abbreviations-listed.sh
  hooks/prompts-md.sh
  hooks/prompts-md-current.sh
  hooks/cd-fall-through.sh
  hooks/slack-user-search-own-workspace.sh
  hooks/detach-started-session.sh
  hooks/no-session-cards.sh
  hooks/permission-mode-changed.sh
  hooks/no-foreground-wait.sh
  hooks/stop-unreachable-claim.sh
  hooks/no-slow-binary-grep.sh
  hooks/own-hunks.sh
  hooks/push-only-when-locked.sh
  hooks/pane-bridge.mjs
  hooks/chrome-background.sh
  hooks/chrome-anchor.html
  hooks/chrome-anchor-kwin.js
  hooks/energy-session-pid.sh
  hooks/usage-waiting.sh
  hooks/sync-conflicts.sh
  hooks/plan-limits.sh
  presence/install.sh
  presence/lock-listener.swift
  presence/lock-listener-kde.sh
  energy/install.sh
  energy/energy-sampler.swift
  energy/report.py
  overload/install.sh
  overload/overload.swift
  overload/Info.plist
  mods/session-usage/.claude-plugin/plugin.json
  mods/session-usage/hooks/hooks.json
  mods/session-usage/hooks/register.ts
  mods/session-usage/hooks/register.test.ts
  mods/session-usage/usage.sh
  mods/archive-files/.claude-plugin/plugin.json
  mods/archive-files/hooks/hooks.json
  mods/archive-files/hooks/register.ts
  mods/archive-files/hooks/register.test.ts
  mods/archive-files/archive-files.sh
  skills/commit-messages/SKILL.md
  skills/mirror/SKILL.md
  skills/pull-requests/SKILL.md
  skills/pull-requests/pane-upload.sh
  skills/pull-requests/review-page/build.py
  skills/pull-requests/review-page/template.html
  skills/slack-draft/SKILL.md
  skills/slack-draft/copy-rich.sh
  skills/share/SKILL.md
  skills/share/export-session.sh
  skills/share/share-session.sh
  skills/share/write-to-branch.sh
  skills/chrome/SKILL.md
  skills/emoji-and-stickers/SKILL.md
  skills/pages/SKILL.md
  skills/portfolio-work/SKILL.md
  skills/scheduling/SKILL.md
  skills/vpn-check/SKILL.md
  skills/read-aloud/SKILL.md
  skills/models/SKILL.md
  skills/models/pace.sh
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

git_diff() {
  git -c core.quotePath=false diff --no-index --no-color --no-ext-diff -a "$@" || [ "$?" -eq 1 ]
}

is_mirrored() {
  local path
  for path in "${mirrored[@]}"; do
    [ "$path" != "$1" ] || return 0
  done
  return 1
}

# Prints the changed files that keep a fast-forward to the upstream from
# running. Fails when there is none, or when one of them is not a mirrored file
# whose copy here and local copy hold the same bytes.
pull_blockers() {
  local path found=1
  git merge-base --is-ancestor HEAD '@{upstream}' 2>/dev/null || return 1
  while IFS= read -r path; do
    [ -n "$(git status --porcelain -- ":(literal)$path")" ] || continue
    is_mirrored "$path" && git cat-file -e "HEAD:$path" 2>/dev/null &&
      [ -f "$checkout/$path" ] && same_file "$checkout/$path" "$source_dir/$path" || return 1
    printf '%s\n' "$path"
    found=0
  done < <(git -c core.quotePath=false diff --name-only --no-renames HEAD '@{upstream}')
  return "$found"
}

# True when file $3 holds the change path $2 took from commit $1 to HEAD:
# against HEAD's version it removes no line that change wrote, and where that
# change only removed lines it adds none of them back.
holds_pulled() {
  local dir held=1
  dir="$(mktemp -d)"
  git cat-file blob "$1:$2" > "$dir/before" 2>/dev/null || : > "$dir/before"
  if git cat-file blob "HEAD:$2" > "$dir/pulled" 2>/dev/null &&
    git_diff -U0 -- "$dir/before" "$dir/pulled" > "$dir/wrote" &&
    git_diff -U0 -- "$dir/pulled" "$3" > "$dir/kept" &&
    LC_ALL=C awk '
      function range(field, r,   f) {
        split(substr(field, 2), f, ",")
        r["at"] = f[1] + 0
        r["n"] = (2 in f) ? f[2] + 0 : 1
      }
      /^@@ / {
        range($2, old)
        range($3, new)
        hunk = 1
        gaps = 0
        removal = (!kept && new["n"] == 0)
        if (removal) gap[new["at"]] = 1
        if (!kept) for (i = 0; i < new["n"]; i++) wrote[new["at"] + i] = 1
        if (kept) {
          for (i = 0; i < old["n"]; i++) if ((old["at"] + i) in wrote) exit 1
          for (i = (old["n"] > 0 ? -1 : 0); i < old["n"] || i == 0; i++)
            if ((old["at"] + i) in gap) beside[++gaps] = old["at"] + i
        }
        next
      }
      !hunk { next }
      removal && /^-/ { gone[new["at"], substr($0, 2)] = 1 }
      kept && /^\+/ { for (i = 1; i <= gaps; i++) if ((beside[i], substr($0, 2)) in gone) exit 1 }
      ' "$dir/wrote" kept=1 "$dir/kept"; then
    held=0
  fi
  rm -rf "$dir"
  return "$held"
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
clone_locks=()
lock_clone() {
  local clone_lock="$1/claude-clone.lock" held tries=0
  for held in ${clone_locks[@]+"${clone_locks[@]}"}; do
    [ "$held" != "$clone_lock" ] || return 0
  done
  until mkdir "$clone_lock" 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -le 660 ] || return 1
    find "$clone_lock" -maxdepth 0 -mmin +10 -exec rmdir {} \; 2>/dev/null || true
    sleep 1
  done
  clone_locks+=("$clone_lock")
}
release_clones() {
  local held
  for held in ${clone_locks[@]+"${clone_locks[@]}"}; do
    rmdir "$held" 2>/dev/null || true
  done
  clone_locks=()
}
stage_dir=""
trap 'rm -f "$lock"; release_clones; [ -z "$stage_dir" ] || rm -rf "$stage_dir"' EXIT

cd "$checkout"
before="$(git rev-parse HEAD)"
failed=0
if git fetch --quiet 2>/dev/null; then
  git restore -- PROMPTS.md 2>/dev/null || true
  refused=0
  merge_error="$(git merge --ff-only --quiet '@{upstream}' 2>&1)" || refused=1
  if [ "$refused" -eq 1 ] && blockers="$(pull_blockers)"; then
    while IFS= read -r path; do
      git restore --source=HEAD --staged --worktree -- ":(literal)$path"
      echo "sync: $path put back to HEAD for the pull, the local copy holds the same bytes"
    done <<< "$blockers"
    refused=0
    merge_error="$(git merge --ff-only --quiet '@{upstream}' 2>&1)" || refused=1
  fi
  if [ "$refused" -eq 1 ]; then
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
    if holds_pulled "$before" "$path" "$local_file"; then
      install_file "$local_file" "$repo_file"
    else
      echo "sync: $path changed both locally and in the pulled commits, merge by hand" >&2
      failed=1
    fi
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

stage_git() {
  GIT_INDEX_FILE="$stage_dir/index" git "$@"
}

names() {
  local path
  for path in ${public_paths[@]+"${public_paths[@]}"}; do
    path="${path#./}"
    path="${path%/}"
    case "$1" in "$path" | "$path"/*) return 0 ;; esac
    [ "$path" != . ] || return 0
  done
  return 1
}

check_copy() {
  if [ -z "$message_file" ]; then
    printf '%s\n' "$1"
  elif [ "${#public_paths[@]}" -gt 0 ] && names "$1" && [ -f "$stage_dir/tree/$1" ]; then
    printf '%s\n' "$stage_dir/tree/$1"
  fi
}

# Prints file $1 with the change from file $2 to file $3 made in it. Fails when
# the change touches lines of $2 that $1 lacks; an insertion beside them goes
# next to the line of both it follows or precedes, and where $1 has lines
# there that $2 lacks, among them where work tree file $4 has it.
merge_edit() {
  local nl
  git_diff -U0 -- "$2" "$1" > "$stage_dir/pc" && git_diff -U0 -- "$2" "$3" > "$stage_dir/pq" &&
    git_diff -U0 -- "$3" "$1" > "$stage_dir/qc" && git_diff -U0 -- "$1" "$4" > "$stage_dir/cw" || return 1
  nl=$(($(tail -c 1 "$1" | wc -l)))
  [ $(($(tail -c 1 "$2" | wc -l))) -eq $(($(tail -c 1 "$3" | wc -l))) ] || nl=$(($(tail -c 1 "$3" | wc -l)))
  LC_ALL=C awk -v c="$1" -v p="$2" -v q="$3" -v d="$stage_dir" -v nl="$nl" '
    function lines(file, L,   line, n) {
      while ((getline line < file) > 0) L[++n] = line
      close(file)
      return n
    }
    function hunks(file, H, A,   line, f, r, n) {
      while ((getline line < file) > 0) {
        if (line ~ /^@@ /) {
          split(line, f, " ")
          split(substr(f[2], 2), r, ","); H[++n, "a"] = r[1] + 0; H[n, "n"] = (2 in r) ? r[2] + 0 : 1
          split(substr(f[3], 2), r, ","); H[n, "b"] = r[1] + 0; H[n, "m"] = (2 in r) ? r[2] + 0 : 1
        } else if (n && line ~ /^\+/) A[n, ++H[n, "k"]] = substr(line, 2)
      }
      close(file)
      return n
    }
    function align(H, n, np, common, pos,   h, i, j, from) {
      i = j = 1
      for (h = 1; h <= n; h++) {
        from = H[h, "n"] > 0 ? H[h, "a"] : H[h, "a"] + 1
        while (i < from) { common[i] = 1; pos[i++] = j++ }
        i = from + H[h, "n"]
        j = (H[h, "m"] > 0 ? H[h, "b"] : H[h, "b"] + 1) + H[h, "m"]
      }
      while (i <= np) { common[i] = 1; pos[i++] = j++ }
      return j - 1
    }
    function held(lo, hi,   x, at, last) {
      for (x = lo; x <= hi; x++) {
        if (x < 1) at = 0
        else if (x > nq) at = nc + 1
        else if (x in inq) at = posq[x]
        else return 0
        if (x > lo && at != last + 1) return 0
        last = at
      }
      return 1
    }
    function place(lo, hi, h, m, x,   g, s, i, same) {
      for (g = 1; g <= ncw; g++) {
        if (CW[g, "n"] != 0 || CW[g, "a"] < lo || CW[g, "a"] > hi) continue
        for (s = 0; s + m <= CW[g, "m"]; s++) {
          same = 1
          for (i = 1; i <= m && same; i++) if (CWA[g, s + i] != A[h, i]) same = 0
          if (same) return CW[g, "a"]
        }
      }
      return x
    }
    BEGIN {
      nc = lines(c, C); np = lines(p, P); nq = lines(q, Q)
      n = hunks(d "/pc", PC, PCA)
      if (align(PC, n, np, inp, posp) != nc) exit 2
      n = hunks(d "/qc", QC, QCA)
      if (align(QC, n, nq, inq, posq) != nc) exit 2
      ncw = hunks(d "/cw", CW, CWA)
      n = hunks(d "/pq", H, A)
      for (h = 1; h <= n; h++) {
        a = H[h, "a"]; k = H[h, "n"]; b = H[h, "b"]; m = H[h, "m"]
        text = ""
        for (i = 1; i <= m; i++) text = text A[h, i] "\n"
        mine = 1
        for (i = a; i < a + k; i++) if (!(i in inp)) mine = 0
        if (m > 0 && (k == 0 || !mine) && held(b - 1, b + m)) continue
        if (!mine) exit 1
        if (k > 0) {
          if (posp[a + k - 1] - posp[a] != k - 1) exit 1
          end[posp[a]] = posp[a + k - 1]; put[posp[a]] = text
          continue
        }
        if (a >= 1 && !(a in inp) && a < np && !((a + 1) in inp)) exit 1
        lo = 0
        for (i = a; i >= 1; i--) if (i in inp) { lo = posp[i]; break }
        hi = nc
        for (i = a + 1; i <= np; i++) if (i in inp) { hi = posp[i] - 1; break }
        x = (a == 0 || (a in inp)) ? lo : hi
        if (lo < hi) x = place(lo, hi, h, m, x)
        add[x] = add[x] text
      }
      out = ""
      i = 0
      while (i <= nc) {
        out = out add[i]
        if (++i > nc) break
        if (i in end) { out = out put[i]; i = end[i] }
        else out = out C[i] "\n"
      }
      if (!nl) sub(/\n$/, "", out)
      printf "%s", out
    }'
}

replay() {
  local before after path
  git cat-file blob "HEAD:$1" > "$stage_dir/own"
  while read -r before after path; do
    [ "$path" = "$1" ] || continue
    if ! git cat-file blob "$before" > "$stage_dir/before" 2>/dev/null ||
      ! git cat-file blob "$after" > "$stage_dir/after" 2>/dev/null; then
      echo "sync: an edit of $1 in $records is gone from the object store, left out" >&2
      continue
    fi
    if ! merge_edit "$stage_dir/own" "$stage_dir/before" "$stage_dir/after" "$1" > "$stage_dir/next"; then
      echo "sync: this edit of $1 changes lines only the work tree holds, so it waits for the commit of the session that wrote them:" >&2
      git_diff -U2 -- "$stage_dir/before" "$stage_dir/after" | sed 1,4d >&2
      echo "sync: when no session will commit them, deleting the lines for $1 in $records commits it whole" >&2
      return 1
    fi
    mv "$stage_dir/next" "$stage_dir/own"
  done < "$records"
  cat "$stage_dir/own"
}

# Succeeds when file $1 holds the change from blob $2 to blob $3: taking that
# change back out of it leaves it different.
holds() {
  git cat-file blob "$2" > "$stage_dir/from" 2>/dev/null && git cat-file blob "$3" > "$stage_dir/to" 2>/dev/null &&
    merge_edit "$1" "$stage_dir/to" "$stage_dir/from" "$1" > "$stage_dir/undone" 2>/dev/null &&
    ! cmp -s "$1" "$stage_dir/undone"
}

records=""
case "${CLAUDE_CODE_SESSION_ID:-}" in
  "" | *[^A-Za-z0-9_-]*) ;;
  *) records="$checkout/.git/own-hunks/$CLAUDE_CODE_SESSION_ID" ;;
esac
if [ -n "$message_file" ] && [ "${#public_paths[@]}" -gt 0 ]; then
  stage_dir="$(mktemp -d)"
  stage_git read-tree HEAD
  stage_git add -A -- "${public_paths[@]}"
  replayed=$'\n'
  case " ${public_paths[*]} " in
    *" . "*) ;;
    *)
      while IFS= read -r path; do
        names "$path" && git cat-file -e "HEAD:$path" 2>/dev/null &&
          [ -n "$(stage_git ls-files -- "$path")" ] || continue
        replay "$path" > "$stage_dir/staged" || exit 1
        mode="$(stage_git ls-files -s -- "$path" | cut -d ' ' -f 1)"
        blob="$(git hash-object -w --no-filters "$stage_dir/staged")"
        stage_git update-index --cacheinfo "$mode,$blob,$path"
        replayed="$replayed$path"$'\n'
      done < <([ ! -f "$records" ] || cut -d ' ' -f 3- "$records" | sort -u)
      ;;
  esac
  if stage_git diff --cached --quiet HEAD; then
    if [ "${#private_paths[@]}" -eq 0 ]; then
      echo "sync: none of the named paths holds a change of this session's, nothing committed" >&2
      exit 1
    fi
    public_paths=()
  fi
fi

if [ -n "$message_file" ] && [ "${#public_paths[@]}" -gt 0 ]; then
  others=0
  while IFS= read -r -d '' path; do
    git cat-file blob "HEAD:$path" > "$stage_dir/at-head" 2>/dev/null &&
      stage_git cat-file blob ":$path" > "$stage_dir/to-commit" 2>/dev/null || continue
    for other in "$checkout/.git/own-hunks"/*; do
      [ -f "$other" ] && [ "$other" != "$records" ] && lines="$(grep -F " $path" "$other" 2>/dev/null)" || continue
      while read -r from to edited; do
        [ "$edited" = "$path" ] && holds "$stage_dir/to-commit" "$from" "$to" &&
          ! holds "$stage_dir/at-head" "$from" "$to" || continue
        echo "sync: $path would take this edit, which session ${other##*/} recorded and has not committed:" >&2
        git_diff -U2 -- "$stage_dir/from" "$stage_dir/to" | sed 1,4d >&2
        others=1
      done <<< "$lines"
    done
    case "$replayed" in *$'\n'"$path"$'\n'*) continue ;; esac
    while IFS= read -r call; do
      watch="$(awk -F '\t' -v p="$path" 'NR > 2 && $2 == p { print $1 "\t" $3; exit }' "$call" 2>/dev/null)" &&
        [ -n "$watch" ] && [ "${watch%%$'\t'*}" != "$(git hash-object --no-filters "${watch#*$'\t'}" 2>/dev/null)" ] || continue
      echo "sync: $path goes in whole and changed since a tool call began that has not ended, unless a hook refused it: ${call#"$checkout/"}" >&2
      others=1
    done < <(find "$checkout/.git/own-hunks/pending" -type f ! -name '*.seen' ! -name "${CLAUDE_CODE_SESSION_ID:-none}.*" -mmin -15 2>/dev/null)
  done < <(stage_git diff --cached --name-only -z HEAD)
  if [ "$others" -ne 0 ]; then
    echo "sync: nothing committed; run again once that session has committed the edit or the call has ended, or once the edit's line, when the edit is this session's own, or the refused call's file is gone" >&2
    exit 1
  fi
fi

if [ -f "$checkout/PROMPTS.md" ]; then
  if [ -n "$message_file" ] && [ "${#public_paths[@]}" -gt 0 ]; then
    "$checkout/hooks/prompts-md.sh" --message "$message_file"
    case " ${public_paths[*]} " in *" . "* | *" PROMPTS.md "*) ;; *) public_paths+=(PROMPTS.md) ;; esac
    stage_git add -- PROMPTS.md
  else
    "$checkout/hooks/prompts-md.sh"
  fi
fi
if [ -n "$message_file" ] && [ "${#public_paths[@]}" -gt 0 ]; then
  stage_git ls-files -z -- "${public_paths[@]}" |
    stage_git checkout-index -z --stdin --prefix="$stage_dir/tree/"
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
if [ -n "$message_file" ] && [ "${#public_paths[@]}" -gt 0 ]; then
  while IFS= read -r -d '' path; do
    case "$path" in LICENSE*|sync-allow.txt) continue ;; esac
    [ ! -f "$stage_dir/tree/$path" ] || scan_files+=("$stage_dir/tree/$path")
  done < <(stage_git ls-files -z -- "${public_paths[@]}")
fi
held=$'\n'
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
  if [ -n "$hits" ] && [ -n "$message_file" ]; then
    while IFS= read -r hit; do
      printf 'sync: %s in %s, kept out of the mirror copy\n' "$label" "$hit" >&2
      held="$held${hit%%:*}"$'\n'
    done < <(printf '%s\n' "$hits" | grep -v '^/' | cut -d: -f1,2)
    hits="$(printf '%s\n' "$hits" | grep '^/' || true)"
    [ -z "$stage_dir" ] || hits="${hits//"$stage_dir/tree/"/}"
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
    -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
    -e 'npm_[A-Za-z0-9]{36}' \
    -e 'glpat-[A-Za-z0-9_-]{20,}' \
    -e 'sbp_[a-f0-9]{40}' \
    -e '[sr]k_live_[A-Za-z0-9]{20,}'
  scan "credential-like assignment$1" -i -E \
    -e '(api[_-]?key|secret|token|passw(or)?d)[^A-Za-z0-9]{0,3}[:=][^A-Za-z0-9]{0,3}[A-Za-z0-9/+_.-]{16,}'
  local quote="[\`'\"]?" lit="[^\$\`'\"[:space:]<{][^\`'\"[:space:]]{7,}"
  scan "password in a command$1" -i -E \
    -e "(pgpassword|mysql_pwd|sshpass)=$quote$lit" \
    -e "sshpass +-p *$quote$lit" \
    -e "(mysql|mariadb|mysqldump)[^|;&]* -p$quote$lit" \
    -e "--password[= ]$quote$lit" \
    -e "authorization: *(bearer|basic|token) +$lit" \
    -e "(x-api-key|private-token): *$lit" \
    -e "://[^/[:space:]:@]+:[^\$/[:space:]@<{][^/[:space:]@]{5,}@[a-z0-9-]+\.[a-z]"
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
  copy="$(check_copy "$path")"
  case "$copy" in *.sh) bash -n "$copy" || failed=1 ;; esac
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
long_files=()
for path in CLAUDE.md README.md docs/*.md skills/pull-requests/SKILL.md; do
  copy="$(check_copy "$path")"
  [ -z "$copy" ] || long_files+=("$copy")
done
long=""
[ "${#long_files[@]}" -eq 0 ] || long="$(LC_ALL=C awk '
  FNR == 1 { front = ($0 == "---"); code = 0; evals = 0 }
  front { if (FNR > 1 && $0 == "---") front = 0; next }
  /^[ \t]*```/ { code = !code; next }
  /^<!-- evals:start -->/ { evals = 1 }
  /^<!-- evals:end -->/ { evals = 0; next }
  code || evals || /^[ \t]*\|/ { next }
  { s = $0; gsub(/[\200-\277]/, "", s) }
  length(s) > 100 { print "  " FILENAME ":" FNR }
' "${long_files[@]}")"
[ -z "$stage_dir" ] || long="${long//"$stage_dir/tree/"/}"
if [ -n "$long" ]; then
  printf 'sync: line over 100 columns in\n%s\n' "$long" >&2
  printf 'sync: %s rewraps them, run it on its own\n' "$checkout/reflow.sh" >&2
  failed=1
fi

if [ -f claude-md-budget.txt ]; then
  claude_md="$(check_copy CLAUDE.md)"
  claude_md_size="$(wc -c < "${claude_md:-CLAUDE.md}" | tr -d ' ')"
  claude_md_budget="$(tr -d ' \n' < claude-md-budget.txt)"
  if [ "$claude_md_size" -gt "$claude_md_budget" ]; then
    printf 'sync: CLAUDE.md is %s bytes, %s over claude-md-budget.txt, by section:\n' \
      "$claude_md_size" "$((claude_md_size - claude_md_budget))" >&2
    LC_ALL=C awk '/^## / { name = $0 } name != "" { size[name] += length($0) + 1 }
      END { for (s in size) printf "  %6d %s\n", size[s], s }' "${claude_md:-CLAUDE.md}" | sort -rn >&2
    echo "sync: --commit refuses CLAUDE.md until it fits, the mirror skill says how to make room" >&2
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
    clone="$(git -C "$dir" rev-parse --absolute-git-dir 2>/dev/null)" || clone=""
    if [ -n "$clone" ]; then
      if ! lock_clone "$clone"; then
        echo "sync: could not take $clone/claude-clone.lock" >&2
        failed=1
        continue
      fi
      if [ -d "$clone/rebase-merge" ] || [ -d "$clone/rebase-apply" ]; then
        echo "sync: a rebase stopped halfway in $dir, finish it with git rebase --continue there or undo it with git rebase --abort" >&2
        failed=1
        continue
      fi
    fi
    for path in "${files[@]}"; do
      case "$held" in *$'\n'"$path"$'\n'*) continue ;; esac
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
    if stage_git diff --cached --quiet HEAD; then
      echo "sync: nothing to commit here" >&2
    else
      stage_git commit -q -F "$message_file"
      git reset -q -- "${public_paths[@]}"
      committed=1
      if [ -f "$records" ]; then
        while IFS= read -r line; do
          names "${line#* * }" || printf '%s\n' "$line"
        done < "$records" > "$records.left"
        if [ -s "$records.left" ]; then
          mv "$records.left" "$records"
        else
          rm -f "$records" "$records.left"
        fi
      fi
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
    if ! git -C "$dir" rebase -q --autostash --committer-date-is-author-date; then
      git -C "$dir" rebase --abort 2>/dev/null || true
      echo "sync: the rebase onto the fetched commits stopped in $dir and is undone, nothing committed there" >&2
      failed=1
      continue
    fi
    if [ "${#public_paths[@]}" -gt 0 ]; then
      while IFS=$'\t' read -r -d '' object path; do
        mkdir -p "$(dirname "$dir/$path")"
        git cat-file blob "${object##* }" > "$dir/$path"
        case "$object" in 100755*) chmod +x "$dir/$path" ;; esac
      done < <(git ls-tree -r -z HEAD -- "${public_paths[@]}")
    fi
    git -C "$dir" add -A -- "${mirror_paths[@]}"
    git -C "$dir" diff --cached --quiet -- "${mirror_paths[@]}" ||
      git -C "$dir" commit -q -F "$mirror_message" -- "${mirror_paths[@]}"
    git -C "$dir" push -q
    echo "sync: $(git -C "$dir" rev-parse --short HEAD) pushed in $dir"
  done
  release_clones
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
