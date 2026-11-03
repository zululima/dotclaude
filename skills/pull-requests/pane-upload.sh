#!/usr/bin/env bash

# Carries pictures for a pull request into GitHub's own comment box from a
# browser tab Claude drives, such as one of Claude in Chrome.
# "push" writes the files to a throwaway branch with git plumbing, which leaves
# the checkout's index and work tree alone, pushes it to origin with [skip ci]
# and prints the JavaScript to run with javascript_tool on the pull request's
# page. "clean" deletes that branch again.
#
# The JavaScript relies on the ids GitHub gives the comment box,
# fc-new_comment_field and new_comment_field. It returns an error rather than
# guess when either is missing, when the tab is signed out of GitHub, or when
# the box already holds text, and it never clicks or submits anything.

set -euo pipefail

remote=origin
prefix=tmp/pictures-

usage() {
  echo "usage: pane-upload.sh [-C <checkout>] push <file>... | clean <branch>" >&2
  exit 64
}

push() {
  [ "$#" -gt 0 ] || usage
  local url repo top file blob names tree commit branch
  url="$(git remote get-url "$remote")"
  repo="${url#*github.com[/:]}"
  repo="${repo%.git}"
  if [ "$repo" = "$url" ]; then
    echo "pane-upload: $remote is not on github.com: $url" >&2
    exit 1
  fi
  top="$(git rev-parse --show-toplevel)"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  for file in "$@"; do
    if [ ! -f "$file" ]; then
      echo "pane-upload: no such file: $file" >&2
      exit 1
    fi
    blob="$(git hash-object -w -- "$file")"
    GIT_INDEX_FILE="$tmp/index" git -C "$top" update-index --add \
      --cacheinfo "100644,$blob,$(basename "$file")"
  done
  names="$(GIT_INDEX_FILE="$tmp/index" git -C "$top" ls-files -z |
    jq -Rsc 'split("\u0000") | map(select(. != ""))')"
  if [ "$(jq length <<<"$names")" -ne "$#" ]; then
    echo "pane-upload: two of the files share a name" >&2
    exit 1
  fi
  tree="$(GIT_INDEX_FILE="$tmp/index" git -C "$top" write-tree)"
  commit="$(git commit-tree -m "Pictures for a pull request, throwaway [skip ci]" "$tree")"
  branch="$prefix$(date -u +%Y%m%dT%H%M%SZ)"
  git push --no-verify --quiet "$remote" "$commit:refs/heads/$branch"
  printf 'branch: %s\n\nRun this with javascript_tool on the pull request page:\n\n' "$branch"
  printf 'await (async (repo, branch, names) => {\n'
  cat <<'EOF'
  const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime' };
  const user = document.querySelector('meta[name="user-login"]')?.content;
  if (!user) return { error: 'the browser is signed out of GitHub', url: location.href };
  const input = document.getElementById('fc-new_comment_field');
  const box = document.getElementById('new_comment_field');
  if (!input || !box) {
    return { error: 'no comment box with the ids this expects', url: location.href };
  }
  if (box.value) return { error: 'the comment box already holds text' };
  const files = new DataTransfer();
  for (const name of names) {
    const url = `https://github.com/${repo}/raw/${branch}/${encodeURIComponent(name)}`;
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return { error: `${url} gave ${response.status}` };
    const type = types[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
    files.items.add(new File([await response.blob()], name, { type }));
  }
  input.files = files.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  let markdown = '';
  for (let second = 0; second < 30; second++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    markdown = box.value;
    const lines = markdown.split('\n').filter((line) => line.trim());
    if (lines.length >= names.length && !markdown.includes('[Uploading ')) break;
  }
  box.value = '';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(new Event('change', { bubbles: true }));
  return { user, markdown, uploading: markdown.includes('[Uploading ') };
EOF
  printf '})(%s, %s, %s);\n' "$(jq -n --arg v "$repo" '$v')" \
    "$(jq -n --arg v "$branch" '$v')" "$names"
}

clean() {
  [ "$#" -eq 1 ] || usage
  case "$1" in
    "$prefix"*) ;;
    *)
      echo "pane-upload: $1 is not a branch this script pushed" >&2
      exit 1
      ;;
  esac
  git push --no-verify --quiet "$remote" --delete "$1"
}

if [ "${1:-}" = "-C" ]; then
  [ "$#" -ge 2 ] || usage
  cd "$2"
  shift 2
fi

case "${1:-}" in
  push) shift; push "$@" ;;
  clean) shift; clean "$@" ;;
  *) usage ;;
esac
