#!/usr/bin/env bash

# Writes files onto a branch of a repository in one commit without switching
# the checkout: the commit is built in a temporary index from the branch's tip,
# so the work tree, the index and HEAD of the checkout stay as they are, and a
# branch that does not exist yet starts as an orphan. Prints the GitHub address
# of the first file on the branch.
#
#   write-to-branch.sh [-C repo] [--remote name] [--push] [-m message]
#                      <branch> <path on the branch> <file> [<path> <file>]...
#
# The branch is the local one, brought up to the remote's when that is ahead.
# --push pushes it with --no-verify, since a checkout's pre-push hook checks
# the code in the work tree, which this commit does not touch. A push the
# remote refuses because another share landed first is built again on the new
# tip, up to three times.

set -euo pipefail

repo=.
remote=origin
push=0
message=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -C) repo="${2:-}"; shift ;;
    --remote) remote="${2:-}"; shift ;;
    --push) push=1 ;;
    -m) message="${2:-}"; shift ;;
    -*) echo "write-to-branch: unknown argument $1" >&2; exit 2 ;;
    *) break ;;
  esac
  shift
done
[ "$#" -ge 3 ] && [ $((($# - 1) % 2)) -eq 0 ] ||
  { echo "write-to-branch: give the branch, then each path on it with its file" >&2; exit 2; }
branch="$1"
shift
dests=()
sources=()
while [ "$#" -gt 0 ]; do
  [ -f "$2" ] || { echo "write-to-branch: no file '$2'" >&2; exit 2; }
  dests+=("${1#/}")
  sources+=("$(cd "$(dirname "$2")" && pwd)/$(basename "$2")")
  shift 2
done
dest="${dests[0]}"
git check-ref-format --branch "$branch" >/dev/null 2>&1 || { echo "write-to-branch: '$branch' is no branch name" >&2; exit 2; }
top="$(git -C "$repo" rev-parse --show-toplevel)"
g() { git -C "$top" "$@"; }
[ -n "$message" ] || message="Add $dest"

url="$(g config --get "remote.$remote.url" || true)"
base=
case "$url" in *github.com[:/]*) base="https://github.com/${url#*github.com[:/]}" ;; esac
base="${base%.git}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export GIT_INDEX_FILE="$tmp/index"
local_ref="refs/heads/$branch"
remote_ref="refs/remotes/$remote/$branch"

# Brings the local branch up to the remote's when the remote is ahead, and
# stops when the two went apart.
catch_up() {
  if [ -n "$url" ] && g ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
    g fetch --quiet "$remote" "+$local_ref:$remote_ref"
  fi
  local mine theirs
  mine="$(g rev-parse -q --verify "$local_ref" || true)"
  theirs="$(g rev-parse -q --verify "$remote_ref" || true)"
  if [ -n "$theirs" ] && [ "$mine" != "$theirs" ]; then
    if [ -z "$mine" ] || g merge-base --is-ancestor "$mine" "$theirs"; then
      g update-ref "$local_ref" "$theirs" "$mine"
    elif ! g merge-base --is-ancestor "$theirs" "$mine"; then
      echo "write-to-branch: $branch and $remote/$branch went apart; settle them first" >&2
      exit 1
    fi
  fi
}

commit_file() {
  local tree commit blob
  parent="$(g rev-parse -q --verify "$local_ref" || true)"
  rm -f "$GIT_INDEX_FILE"
  if [ -n "$parent" ]; then g read-tree "$parent"; else g read-tree --empty; fi
  local i
  for i in "${!dests[@]}"; do
    blob="$(g hash-object -w -- "${sources[$i]}")"
    g update-index --add --cacheinfo "100644,$blob,${dests[$i]}"
  done
  tree="$(g write-tree)"
  if [ -n "$parent" ] && [ "$tree" = "$(g rev-parse "$parent^{tree}")" ]; then
    return 0
  fi
  commit="$(g commit-tree "$tree" ${parent:+-p "$parent"} -m "$message")"
  g update-ref "$local_ref" "$commit" "$parent"
}

tries=0
while :; do
  tries=$((tries + 1))
  catch_up
  commit_file
  [ "$push" -eq 1 ] || break
  if g push --quiet --no-verify "$remote" "$local_ref:$local_ref" 2>"$tmp/push.err"; then
    g update-ref "$remote_ref" "$local_ref"
    break
  fi
  if [ "$tries" -ge 3 ]; then
    cat "$tmp/push.err" >&2
    exit 1
  fi
  if [ -n "$parent" ]; then g update-ref "$local_ref" "$parent"; else g update-ref -d "$local_ref"; fi
done

if [ -n "$base" ]; then
  encoded="$(jq -rn --arg p "$dest" '$p | split("/") | map(@uri) | join("/")')"
  printf '%s/blob/%s/%s\n' "$base" "$branch" "$encoded"
else
  printf '%s:%s\n' "$branch" "$dest"
fi
