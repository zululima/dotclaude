#!/usr/bin/env bash

# Writes PROMPTS.md at the root of the current git checkout from the prompts
# section of every commit message, newest first, each entry with its commit and
# pull request, so the file is generated and never kept by hand.
#
#   prompts-md.sh                   rebuild PROMPTS.md from the history
#   prompts-md.sh --message <file>  also list, first, the commit about to be
#                                   made with that message
#
# A commit cannot name its own hash, so the commit that last changed the file
# links to the file's history instead, and the next rebuild gives it its hash.
# The pull request comes from a squash subject ending in (#n), from GitHub's
# merge commit subject, or, for commits not yet on the default branch, from gh
# for the current branch. A prompt quoted under an older commit is only named.
#
# Quoted prompts pass through prompt-log.sh mask, so a message written before
# the printout masked addresses, home paths and secrets is masked here too, and
# an effort that is not a level, such as default, is left out.

set -euo pipefail

message=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --message) message="${2:-}"; shift ;;
    *) echo "prompts-md: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
if [ -n "$message" ] && [ ! -f "$message" ]; then
  echo "prompts-md: no message file '$message'" >&2
  exit 2
fi

top="$(git rev-parse --show-toplevel)"
prompt_log="$(cd "$(dirname "$0")" && pwd)/prompt-log.sh"
cd "$top"

remote=origin
git remote get-url upstream >/dev/null 2>&1 && remote=upstream
url="$(git remote get-url "$remote" 2>/dev/null || true)"
base=""
case "$url" in
  *github.com[:/]*) base="https://github.com/${url#*github.com[:/]}" ;;
esac
base="${base%.git}"

default="$(git symbolic-ref --quiet --short "refs/remotes/$remote/HEAD" 2>/dev/null || true)"
default="${default#"$remote"/}"
[ -n "$default" ] || default="$(git branch --show-current)"

has_head=0
git rev-parse --verify --quiet HEAD >/dev/null && has_head=1

# During a merge the merge commit does not exist yet, so every walk starts from
# the heads being merged in as well, as it would from that commit.
heads=(HEAD)
merge_heads="$(git rev-parse --git-path MERGE_HEAD)"
if [ "$has_head" -eq 1 ] && [ -f "$merge_heads" ]; then
  while read -r hash _; do
    if [ -n "$hash" ]; then heads+=("$hash"); fi
  done <"$merge_heads"
fi

last=""
if [ -n "$message" ]; then
  last=pending
elif [ "$has_head" -eq 1 ]; then
  last="$(git log -1 --format=%H "${heads[@]}" -- PROMPTS.md)"
fi

prs="$(mktemp)"
out="$(mktemp)"
trap 'rm -f "$prs" "$out"' EXIT

if [ "$has_head" -eq 1 ]; then
  git log --merges --format='%H %P%x09%s' "${heads[@]}" | while IFS=$'\t' read -r hashes subject; do
    case "$subject" in "Merge pull request #"[0-9]*) ;; *) continue ;; esac
    number="${subject#Merge pull request #}"
    number="${number%% *}"
    read -r _ first second _ <<<"$hashes"
    [ -n "${second:-}" ] || continue
    git rev-list "$first..$second" | sed "s/\$/ $number/"
  done >"$prs"
fi

branch_pr=""
current="$(git branch --show-current)"
if [ -n "$current" ] && [ "$current" != "$default" ] && command -v gh >/dev/null 2>&1; then
  branch_pr="$(GH_PROMPT_DISABLED=1 gh pr view --json number -q .number 2>/dev/null || true)"
  case "$branch_pr" in "" | *[!0-9]*) branch_pr="" ;; esac
  if [ -n "$branch_pr" ] && git rev-parse --verify --quiet "$remote/$default" >/dev/null; then
    git rev-list "${heads[@]}" "^$remote/$default" | sed "s/\$/ $branch_pr/" >>"$prs"
  fi
fi

{
  if [ "$has_head" -eq 1 ]; then
    git log --reverse --date=short --format='%x1e%H%x1f%h%x1f%ad%x1f%s%n%B' "${heads[@]}"
  fi
  if [ -n "$message" ]; then
    printf '\036pending\037pending\037%s\037%s\n' "$(date +%F)" "$(head -n 1 "$message")"
    cat "$message"
  fi
} | "$prompt_log" mask --quoted | awk -v base="$base" -v branch="$default" -v prs="$prs" -v last="$last" -v branch_pr="$branch_pr" '
function link(text, path) {
  return base == "" ? text : "[" text "](" base "/" path ")"
}

function escape(s) {
  gsub(/</, "\\<", s)
  return s
}

# Some older messages carry the whole modelSettings object from settings.json
# as the effort, so the level is read from the entry of the model, and left
# out when that entry has none.
function effort_from_settings(model,    id, rest, p, level) {
  id = model
  sub(/^model /, "", id)
  sub(/,.*/, "", id)
  rest = model
  sub(/^model [^ ,]+, effort /, "", rest)
  sub(/\[1m\]$/, "", id)
  p = index(rest, id "\047")
  if (p == 0) p = index(rest, id "\"")
  if (p == 0) p = index(rest, id "[1m]")
  level = ""
  if (p > 0) {
    rest = substr(rest, p + length(id))
    sub(/}.*/, "", rest)
    p = index(rest, "effortLevel")
    if (p > 0) {
      level = substr(rest, p + length("effortLevel"))
      sub(/^[^A-Za-z0-9]+/, "", level)
      sub(/[^A-Za-z0-9_-].*/, "", level)
    }
  }
  sub(/, effort .*/, "", model)
  return level == "" ? model : model ", effort " level
}

function flush(    i, h, n, line, state, model, k, head, quote, abbr, key, number, rest, text, pr) {
  if (count == 0) return
  h = 0
  for (i = 1; i <= count; i++)
    if (lines[i] ~ /^(LLM p|P)rompts behind this commit(, as given to Claude Code| \(Claude Code, model .*\):)$/) h = i
  if (h == 0) { count = 0; return }

  i = h + 1
  model = ""
  if (lines[h] ~ /\(Claude Code, model .*\):$/) {
    model = lines[h]
    sub(/^.*\(Claude Code, /, "", model)
    sub(/\):$/, "", model)
  } else if (lines[i] ~ /^\(?[Mm]odel[ :]/) {
    model = lines[i]
    while (model !~ /:$/ && i < count && i < h + 3 && lines[i + 1] != "" && lines[i + 1] !~ /^([0-9]+\.|>)/)
      model = model " " lines[++i]
    sub(/^\(/, "", model)
    sub(/\)?:$/, "", model)
    i++
  }
  if (model ~ /^model [^ ,]+, effort [A-Za-z0-9_-]+$/) model = ", " model
  else if (model ~ /^model [^ ,]+, effort /) model = ", " effort_from_settings(model)
  else if (model != "") model = ", " model
  if (model ~ /^, model [^ ,]+, effort [A-Za-z0-9_-]+$/ && model !~ /, effort (low|medium|high|xhigh|max)$/)
    sub(/, effort [A-Za-z0-9_-]+$/, "", model)

  n = 0
  state = "between"
  for (; i <= count; i++) {
    line = lines[i]
    if (state == "abbr") {
      if (line == "" || line ~ /^[A-Za-z-]+-by: / || line ~ /: .*<[^ >]+@[^ >]+>$/ || line ~ /^Mirrors /) { state = "done"; continue }
      if (line ~ /^(- )?[^ :>][^:]*: /) { sub(/^- /, "", line); abbreviations["- " line] = 1; abbr = "- " line }
      else if (abbr != "") {
        delete abbreviations[abbr]
        sub(/^ +/, "", line)
        abbr = abbr " " line
        abbreviations[abbr] = 1
      }
      continue
    }
    if (state == "done") break
    if (line == "Abbreviations:") { state = "abbr"; abbr = ""; continue }
    if (state == "paren" && line != "" && line !~ /^>/) { quote[n] = quote[n] escape(line) "\n"; continue }
    if (line ~ /^[0-9]+\./ && state != "head") { n++; head[n] = line; quote[n] = ""; state = "head"; continue }
    if (line ~ /^>/) { quote[n] = quote[n] escape(line) "\n"; state = "quote"; continue }
    if (line == "") { state = "between"; continue }
    if (state == "between" && n > 0 && line ~ /^\(/) { quote[n] = quote[n] "\n" escape(line) "\n"; state = "paren"; continue }
    if (state == "head") { head[n] = head[n] " " line; continue }
    if (line ~ /^[A-Z][A-Za-z-]*: / || line ~ /^Mirrors /) state = "done"
  }

  if (n == 0) { count = 0; return }

  entries++
  pr = ""
  if (subject ~ / \(#[0-9]+\)$/) { pr = subject; sub(/.* \(#/, "", pr); sub(/\)$/, "", pr) }
  else if (full in pr_of) pr = pr_of[full]
  else if (full == "pending") pr = branch_pr

  if (full == last || full == "pending")
    text = date ", " link("the commit that last changed this file", "commits/" branch "/PROMPTS.md")
  else
    text = date ", commit " link(short, "commit/" full)
  if (pr != "") text = text ", pull request " link("#" pr, "pull/" pr)
  text = "## " escape(subject) "\n\n" text model ".\n"

  for (k = 1; k <= n; k++) {
    number = head[k]
    sub(/\..*/, "", number)
    rest = head[k]
    sub(/^[0-9]+\. */, "", rest)
    if (rest != "") rest = " " escape(rest)
    key = head[k] "\n" quote[k]
    if (key in quoted_under)
      text = text "\n**" number ".**" rest " Quoted under " quoted_under[key] ".\n"
    else {
      text = text "\n**" number ".**" rest "\n" quote[k]
      quoted_under[key] = full == "pending" ? "the commit that last changed this file" : link(short, "commit/" full)
    }
  }
  entry[entries] = text
  count = 0
}

BEGIN { while ((getline row < prs) > 0) { split(row, pair, " "); if (!(pair[1] in pr_of)) pr_of[pair[1]] = pair[2] } }

/^\036/ {
  flush()
  split(substr($0, 2), field, "\037")
  full = field[1]; short = field[2]; date = field[3]; subject = field[4]
  next
}

{ lines[++count] = $0 }

END {
  flush()
  print "# Prompts"
  print ""
  print "The prompts behind the commits of this repository, as given to Claude Code, newest first, each"
  print "with its commit and pull request. Square brackets mark what was left out or redacted, and a"
  print "commit without a prompts section is left out. This file is generated from the commit messages,"
  print "so a change by hand is lost at the next commit."
  for (i = entries; i >= 1; i--) printf "\n%s", entry[i]
  for (a in abbreviations) { any = 1; break }
  if (any) {
    print ""
    print "## Abbreviations"
    print ""
    # for-in order differs between gawk and the BSD awk, so the case variant
    # kept is the one first in byte order, not the one awk hands over first.
    sorter = "LC_ALL=C sort -u | LC_ALL=C sort -f -s -u"
    for (a in abbreviations) print a | sorter
    close(sorter)
  }
}
' >"$out"

cat "$out" >"$top/PROMPTS.md"
