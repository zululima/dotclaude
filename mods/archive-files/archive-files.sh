#!/bin/bash

# Moves what an archived desktop session left behind, its drafts folder and the
# ~/Downloads folder and files named after it, to ~/.claude/archive/<task>/, and
# rewrites the memory notes and background files that name an old path. The
# archive-files mod runs it whenever the desktop app rewrites its index of
# archived sessions. That index and the session records beside it are the
# app's own undocumented files, so an app update can stop this without an
# error; the log then shows no runs after an archive.
#
# A session's tasks are the ~/.claude/drafts/<task> folders its tool calls
# name. A task moves when the session changed its folder, its ~/Downloads/<task>
# folder or one of its ~/Downloads/<task>-* files, and no session still open
# names it.
#
# It also closes every Chrome tab that no session still open names, through
# Chrome's AppleScript, whose tab ids are the extension's: the tabs the archived
# session left and the user's own, such as one they signed in on. A tab is
# named when its id stands in a transcript changed since Chrome last started,
# a subagent's too, of a session the app has not archived or has no record of,
# such as a terminal session. When no tab would stay, the front window's
# active one turns into a New Tab page instead, so the extension keeps the
# window it connects through.
#
# Then it deletes the tab groups Chrome saved closed, which a window closing or
# Chrome quitting leaves pinned to the bookmarks bar after every tab is gone: a
# group whose name, less the emoji in front, is the extension's default Claude
# or the title of a session no longer open. Chrome has no API for saved groups,
# so it drives each group's menu on the bookmarks bar through accessibility,
# only while Chrome shows a window whose bar is in view, as on a New Tab page.
#
#   archive-files.sh                          move for every session archived since the last run
#   archive-files.sh --dry-run <local_id>...  print what would move, close or delete for those sessions

set -u
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

sessions="$HOME/Library/Application Support/Claude/claude-code-sessions"
archive="$HOME/.claude/archive"
seen="$archive/.archived-sessions"
log="$HOME/Library/Logs/claude-archive-files.log"
dry=

say() {
  if [ -n "$dry" ]; then echo "$*"; else echo "$(date '+%F %T') $*" >>"$log"; fi
}

tool_inputs() {
  jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
    | .input | tostring' "$1" 2>/dev/null
}

transcript_of() {
  local cli
  cli=$(jq -r '.cliSessionId // empty' "$1")
  [ -n "$cli" ] || return 0
  find "$HOME/.claude/projects" -mindepth 2 -maxdepth 2 -name "$cli.jsonl" 2>/dev/null | head -1
}

# The transcripts of the sessions not archived, read once per run.
open_transcripts() {
  [ -n "${open_list:-}" ] && return
  open_list="$work/open"
  : >"$open_list"
  for r in "$sessions"/*/*/local_*.json; do
    [ "$(jq -r '.isArchived == true' "$r" 2>/dev/null)" = false ] || continue
    t=$(transcript_of "$r")
    [ -n "$t" ] && echo "$t" >>"$open_list"
  done
}

named_by_open_session() {
  local t
  open_transcripts
  while IFS= read -r t; do
    [ "$t" = "$current" ] && continue
    grep -qF "drafts/$1" "$t" 2>/dev/null || continue
    tool_inputs "$t" | grep -qE "\.claude/drafts/$1([^A-Za-z0-9._-]|$)" && return 0
  done <"$open_list"
  return 1
}

rewrite_notes() {
  local old=$1 new=$2 f
  for f in "$HOME"/.claude/projects/*/memory/*.md "$HOME"/.claude/rules/*.md "$HOME"/.claude/about-me/*.md; do
    [ -f "$f" ] || continue
    grep -qF -e "~/${old#"$HOME"/}" -e "$old" "$f" || continue
    cp "$f" "$work/note"
    OLD="~/${old#"$HOME"/}" NEW="~/${new#"$HOME"/}" perl -pi -e 's{\Q$ENV{OLD}\E(?![A-Za-z0-9._-])}{$ENV{NEW}}g' "$f"
    OLD="$old" NEW="$new" perl -pi -e 's{\Q$ENV{OLD}\E(?![A-Za-z0-9._-])}{$ENV{NEW}}g' "$f"
    cmp -s "$f" "$work/note" || say "  rewrote ${f/#$HOME/~}"
  done
}

move_task() {
  local task=$1 since=$2 drafts="$HOME/.claude/drafts/$1" dest="$archive/$1" shared="$HOME/Downloads/$1"
  local files=() f e changed= folder=
  shopt -s nullglob dotglob
  for f in "$HOME/Downloads/$task"-* "$HOME/Downloads/$task".*; do
    [ -f "$f" ] && [ -n "$(find "$f" -mmin "-$since")" ] && files+=("$f")
  done
  # The folder itself counts: a file moved in keeps its own older time.
  [ -d "$shared" ] && [ -n "$(find "$shared" -mmin "-$since" | head -1)" ] && folder=1
  [ -d "$drafts" ] && [ -n "$(find "$drafts" -type f -mmin "-$since" | head -1)" ] && changed=1
  if [ -z "$changed" ] && [ -z "$folder" ] && [ ${#files[@]} -eq 0 ]; then
    say "  $task: nothing this session changed"
    return
  fi
  if named_by_open_session "$task"; then
    say "  $task: kept, a session still open names it"
    return
  fi
  if [ -n "$dry" ]; then
    [ -d "$drafts" ] && say "  $task: would move ${drafts/#$HOME/~} to ${dest/#$HOME/~}"
    [ -n "$folder" ] && say "  $task: would move ${shared/#$HOME/~} to ${dest/#$HOME/~}/downloads/"
    for f in ${files[@]+"${files[@]}"}; do say "  $task: would move ${f/#$HOME/~} to ${dest/#$HOME/~}/downloads/"; done
    return
  fi
  mkdir -p "$archive"
  if [ -d "$drafts" ]; then
    if [ -e "$dest" ]; then
      for e in "$drafts"/*; do
        to=$(place "$e" "$dest")
        [ "$to" = "$dest/${e##*/}" ] || rewrite_notes "$e" "$to"
      done
      rmdir "$drafts"
    else
      mv "$drafts" "$dest"
    fi
    say "  $task: moved ${drafts/#$HOME/~} to ${dest/#$HOME/~}"
    rewrite_notes "$drafts" "$dest"
  fi
  if [ -n "$folder" ]; then
    mkdir -p "$dest/downloads"
    for e in "$shared"/*; do
      to=$(place "$e" "$dest/downloads")
      [ "$to" = "$dest/downloads/${e##*/}" ] || rewrite_notes "$e" "$to"
    done
    rmdir "$shared"
    say "  $task: moved ${shared/#$HOME/~} to ${dest/#$HOME/~}/downloads"
    rewrite_notes "$shared" "$dest/downloads"
  fi
  for f in ${files[@]+"${files[@]}"}; do
    mkdir -p "$dest/downloads"
    to=$(place "$f" "$dest/downloads")
    say "  $task: moved ${f/#$HOME/~} to ${to/#$HOME/~}"
    rewrite_notes "$f" "$to"
  done
}

# Moves $1 into the folder $2, numbering its name when the folder holds it
# already, as render-2.html, and prints where it went.
place() {
  local name=${1##*/} stem ext n=2 to
  stem=$name ext=
  if [ -f "$1" ] && [[ $name == ?*.* ]]; then
    stem=${name%.*} ext=.${name##*.}
  fi
  to="$2/$name"
  while [ -e "$to" ]; do
    to="$2/$stem-$n$ext"
    n=$((n + 1))
  done
  mv "$1" "$to"
  echo "$to"
}

# Closes every Chrome tab no session still open names. $1 lists the local ids
# of the sessions archived, a line each.
close_tabs() {
  local chrome started act url host line
  chrome=$(pgrep -x 'Google Chrome' | head -1)
  [ -n "$chrome" ] || return 0
  started=$(LC_ALL=C date -j -f '%a %b %e %T %Y' "$(LC_ALL=C ps -o lstart= -p "$chrome" | sed 's/ *$//')" +%s) || return 0
  touch -t "$(date -r "$started" +%Y%m%d%H%M.%S)" "$work/chrome-start"
  # Each tab's id, whether it is its window's active one, and its URL, front window first.
  osascript >"$work/tabs" 2>/dev/null <<'EOF' || return 0
set sep to character id 9
set out to ""
tell application "Google Chrome"
  repeat with w in windows
    set a to id of active tab of w
    repeat with t in tabs of w
      set out to out & (id of t) & sep & (a = (id of t)) & sep & (URL of t) & linefeed
    end repeat
  end repeat
end tell
return out
EOF
  cut -f1 "$work/tabs" | grep -E '^[0-9]+$' >"$work/ids"
  [ -s "$work/ids" ] || return 0
  jq -r --rawfile ids "$1" '($ids | split("\n")) as $a
    | select(.isArchived == true or ((.sessionId // "") | IN($a[]))) | .cliSessionId // empty' \
    "$sessions"/*/*/local_*.json 2>/dev/null | sed 's|^|/|' >"$work/gone"
  find "$HOME/.claude/projects" -name '*.jsonl' -newer "$work/chrome-start" | grep -vF -f "$work/gone" |
    tr '\n' '\0' | xargs -0 grep -ohwF -f "$work/ids" 2>/dev/null | sort -u >"$work/held"
  awk -F'\t' -v heldfile="$work/held" '
    BEGIN { while ((getline id < heldfile) > 0) held[id] }
    NF < 3 { next }
    $1 in held { kept = 1; next }
    { doomed[++n] = $1; url[$1] = $3 }
    front == "" && $2 == "true" { front = $1 }
    END {
      for (i = 1; i <= n; i++) {
        id = doomed[i]
        if (!kept && id == front) { if (url[id] !~ /^chrome:\/\/newtab/) print "clear", id }
        else print "close", id
      }
    }' "$work/tabs" >"$work/plan"
  [ -s "$work/plan" ] || return 0
  # shellcheck disable=SC2046
  osascript - "${dry:+list}" $(cat "$work/plan") <<'EOF' 2>/dev/null | while IFS= read -r line; do
on run argv
  set listOnly to item 1 of argv is "list"
  set out to ""
  tell application "Google Chrome"
    repeat with i from 2 to count of argv by 2
      set act to item i of argv
      set n to (item (i + 1) of argv) as integer
      repeat with w in windows
        set found to (tabs of w whose id is n)
        if found is not {} then
          set out to out & act & " " & (URL of item 1 of found) & linefeed
          if not listOnly then
            if act is "clear" then
              set URL of item 1 of found to "chrome://newtab/"
            else
              close item 1 of found
            end if
          end if
          exit repeat
        end if
      end repeat
    end repeat
  end tell
  return out
end run
EOF
    [ -n "$line" ] || continue
    act=${line%% *} url=${line#* }
    host=${url#*://} host=${host%%/*}
    [ -n "$host" ] || host=${url%%:*}
    case $act$dry in
      close) say "closed a Chrome tab on $host" ;;
      close1) say "would close a Chrome tab on $host" ;;
      clear) say "turned the last Chrome tab, on $host, into a New Tab page" ;;
      clear1) say "would turn the last Chrome tab, on $host, into a New Tab page" ;;
    esac
  done
}

delete_groups() {
  local line
  pgrep -x 'Google Chrome' >/dev/null || return 0
  jq -n '[inputs | {title: (.title // ""), open: (.isArchived != true)}]' \
    "$sessions"/*/*/local_*.json >"$work/titles" 2>/dev/null || return 0
  osascript -l JavaScript - "${dry:+list}" "$work/titles" <<'EOF' 2>&1 | while IFS= read -r line; do
ObjC.import('Foundation');
ObjC.import('CoreGraphics');
function run(argv) {
  const listOnly = argv[0] === 'list';
  const sessions = JSON.parse($.NSString.stringWithContentsOfFileEncodingError(argv[1], $.NSUTF8StringEncoding, null).js);
  const core = s => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const open = new Set(sessions.filter(s => s.open).map(s => core(s.title)));
  const ours = new Set(sessions.map(s => core(s.title)).concat('Claude'));
  const procs = Application('System Events').processes.whose({ name: 'Google Chrome' })();
  if (procs.length === 0) return '';
  const p = procs[0];
  const pid = p.unixId();
  const nm = k => { try { return k.name() || k.title() || k.description() || ''; } catch (e) { return ''; } };
  const role = k => { try { return k.role(); } catch (e) { return ''; } };
  const sub = w => { try { return w.subrole(); } catch (e) { return ''; } };
  const find = (el, pred, d) => {
    if (d > 12) return null;
    let ks; try { ks = el.uiElements(); } catch (e) { return null; }
    for (const k of ks) { if (pred(k)) return k; const f = find(k, pred, d + 1); if (f) return f; }
    return null;
  };
  // Key events go to Chrome alone, whichever app is in front.
  const key = code => {
    $.CGEventPostToPid(pid, $.CGEventCreateKeyboardEvent(null, code, true)); delay(0.05);
    $.CGEventPostToPid(pid, $.CGEventCreateKeyboardEvent(null, code, false)); delay(0.15);
  };
  const bar = () => {
    for (const w of p.windows()) {
      if (sub(w) !== 'AXStandardWindow') continue;
      try { if (w.attributes['AXMinimized'].value()) continue; } catch (e) {}
      const b = find(w, k => nm(k) === 'Saved Tab Groups', 0);
      if (b) return [w, b];
    }
    return [null, null];
  };
  const buttons = () => { const b = bar()[1]; return b ? b.uiElements() : []; };
  const popup = () => p.windows().find(w => sub(w) !== 'AXStandardWindow');
  const groupOf = n => { const m = n.match(/^(.*) group - Closed$/); return m ? core(m[1]) : null; };
  const doomed = n => { const g = groupOf(n); return g !== null && ours.has(g) && !open.has(g); };
  const count = g => buttons().filter(k => groupOf(nm(k)) === g).length;
  const out = [];
  if (!bar()[1]) return 'Chrome tab groups: skipped, no window shows the bookmarks bar';
  if (listOnly) return buttons().map(nm).filter(doomed).map(n => 'would delete the Chrome tab group ' + groupOf(n)).join('\n');
  // A hidden Chrome opens no menus.
  if (!p.visible()) return buttons().some(k => doomed(nm(k))) ? 'Chrome tab groups: skipped, Chrome is hidden' : '';
  for (let round = 0; round < 50; round++) {
    const w = bar()[0];
    const btn = buttons().find(k => doomed(nm(k)));
    if (!btn) break;
    const name = groupOf(nm(btn));
    const before = count(name);
    let menu = null;
    for (let t = 0; t < 3 && !menu; t++) {
      btn.actions['AXShowMenu'].perform();
      for (let i = 0; i < 8 && !menu; i++) { delay(0.25); menu = popup(); }
    }
    if (!menu) { out.push('Chrome tab groups: stopped, no menu opened for ' + name); break; }
    const items = [];
    (function walk(el, d) {
      if (d > 8) return;
      let ks; try { ks = el.uiElements(); } catch (e) { return; }
      ks.forEach(k => { if (role(k) === 'AXMenuItem') items.push(k); walk(k, d + 1); });
    })(menu, 0);
    if (items.slice(0, 4).map(nm).join('|') !== 'Open group|Open group in new window|Unpin group from bookmarks bar|Delete group') {
      key(53);
      out.push('Chrome tab groups: stopped, the menu of ' + name + ' has other items');
      break;
    }
    // AXPress on a Chrome menu item does nothing, so the keyboard picks it.
    for (let i = 0; i < 4; i++) key(125);
    let picked = false;
    try { picked = items[3].selected() === true; } catch (e) {}
    if (!picked) { key(53); out.push('Chrome tab groups: stopped, Delete group was not highlighted for ' + name); break; }
    key(36);
    for (let i = 0; i < 12 && count(name) === before; i++) {
      delay(0.25);
      const sheet = w.uiElements().find(k => role(k) === 'AXSheet' && nm(k) === 'Delete Tab Group?');
      const yes = sheet && find(sheet, k => role(k) === 'AXButton' && nm(k) === 'Delete Group', 0);
      if (yes) { yes.actions['AXPress'].perform(); delay(0.75); }
    }
    if (count(name) === before) { out.push('Chrome tab groups: stopped, ' + name + ' is still there'); break; }
    out.push('deleted the Chrome tab group ' + name);
  }
  return out.join('\n');
}
EOF
    [ -n "$line" ] && say "$line"
  done
}

handle() {
  local record=$1 t created since task
  t=$(transcript_of "$record")
  current=$t
  say "$(jq -r '.title // .sessionId' "$record")"
  if [ -z "$t" ]; then
    say "  no transcript on this machine"
    return
  fi
  created=$(jq -r '(.createdAt // 0) / 1000 | floor' "$record")
  since=$(( ($(date +%s) - created) / 60 + 2 ))
  # A task folder's name has no dot, a working file's in drafts has its extension.
  for task in $(tool_inputs "$t" | grep -oE '\.claude/drafts/[A-Za-z0-9_-][A-Za-z0-9._-]*' | sed 's|.*/||' | sort -u); do
    case $task in *.*) continue ;; esac
    [ -f "$HOME/.claude/drafts/$task" ] || move_task "$task" "$since"
  done
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ "${1:-}" = --dry-run ]; then
  dry=1
  shift
  for id in "$@"; do
    for record in "$sessions"/*/*/"$id".json; do
      [ -f "$record" ] && handle "$record"
    done
  done
  printf '%s\n' "$@" >"$work/given"
  close_tabs "$work/given"
  delete_groups
  exit 0
fi

lock="$archive/.archive-files.lock"
mkdir -p "$archive"
locked=
for _ in $(seq 60); do
  mkdir "$lock" 2>/dev/null && locked=1 && break
  [ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ] && rmdir "$lock"
  sleep 1
done
[ -n "$locked" ] || exit 0
trap 'rm -rf "$work"; rmdir "$lock"' EXIT

: >"$work/now"
for idx in "$sessions"/*/*/archived-sessions.idx; do
  [ -f "$idx" ] || continue
  jq -r '.archived[]' "$idx" | sort >"$work/ids"
  cat "$work/ids" >>"$work/now"
  [ -f "$seen" ] || continue
  for id in $(comm -13 "$seen" "$work/ids"); do
    [ -f "${idx%/*}/$id.json" ] || continue
    handle "${idx%/*}/$id.json"
    archived=1
  done
done
sort -u "$work/now" >"$seen"
if [ -n "${archived:-}" ]; then
  close_tabs "$work/now"
  delete_groups
fi
