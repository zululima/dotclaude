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
# ~/.claude is synced between machines, so the app also holds records it
# imported from the other machine's transcripts. A record that started outside
# this machine's home, temp and removable-drive folders is such a one: it is
# skipped when archived and counts as open, since the other machine may still
# work in its tasks. The list of archives already handled is kept per machine,
# outside the synced folder.
#
# On macOS it also closes every Chrome tab that no session still open names,
# through Chrome's AppleScript, whose tab ids are the extension's: the tabs the
# archived session left and the user's own, such as one they signed in on. A
# tab is named when its id stands in a transcript changed since Chrome last
# started, a subagent's too, of a session the app has not archived or has no
# record of, such as a terminal session. When no tab would stay, the front
# window's active one stays open, so the extension keeps the window it connects
# through. Before the close, the Chrome half of ~/.claude/cookie-bridge takes
# those tabs out of their tab groups, so Chrome deletes each saved group instead
# of keeping it on the bookmarks bar. No step opens a tab, shows or hides
# Chrome, or sends it a key: AppleScript that opens a tab or loads a New Tab
# page brings Chrome to the front.
#
# Saved groups closed before that, by a window closing, Chrome quitting or a
# session closing its own tabs, stay on the bookmarks bar for now: deleting one
# takes its menu on the bar, which only a Chrome window on screen shows, so
# --dry-run lists the ones it would delete and no run deletes them: a group
# whose name, less the emoji in front, is the extension's default Claude or a
# title, current or earlier, of a session no longer open and of none still open.
#
#   archive-files.sh                          move for every session archived since the last run
#   archive-files.sh --groups                 nothing while the sweep of saved groups is off
#   archive-files.sh --dry-run <local_id>...  print what would move, close or delete for those sessions

set -u
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

sessions="$HOME/Library/Application Support/Claude/claude-code-sessions"
[ -d "$sessions" ] || sessions="${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude-code-sessions"
archive="$HOME/.claude/archive"
state="$HOME/Library/Application Support/claude-archive-files"
[ -d "${state%/*}" ] || state="${XDG_STATE_HOME:-$HOME/.local/state}/claude-archive-files"
seen="$state/archived-sessions"
log="$HOME/Library/Logs/claude-archive-files.log"
[ -d "${log%/*}" ] || log="${XDG_STATE_HOME:-$HOME/.local/state}/claude-archive-files.log"
dry= quiet=

# macOS records /tmp as /private/tmp, so the temp folders count resolved.
roots=$({
  echo "${HOME%/}"
  realpath -q "${TMPDIR:-/tmp}" /tmp
  [ -d /Volumes ] && echo /Volumes
  [ -d /run/media ] && echo "/run/media/$(id -un)"
} | jq -Rn '[inputs | select(length > 0)] | unique')
here='def foreign: (.cwd // "") as $c | any($roots[]; . as $r | $c == $r or ($c | startswith($r + "/"))) | not;'

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
    [ "$(jq -r --argjson roots "$roots" "$here"' .isArchived != true or foreign' "$r" 2>/dev/null)" = true ] || continue
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
  for f in "$HOME"/.claude/projects/*/memory/*.md "$HOME"/.claude/rules/*.md "$HOME"/.claude/about-me/*.md \
    "$HOME"/.claude/*.md; do
    [ -f "$f" ] && [ "$f" != "$HOME/.claude/CLAUDE.md" ] || continue
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

# Takes the tabs whose ids stdin lists out of their tab groups through the
# Chrome half of ~/.claude/cookie-bridge, since Chrome keeps a group saved when
# its last tab closes and deletes it when its last tab leaves the group.
ungroup() {
  local sock="$HOME/.claude/cookie-bridge/run/chrome.sock" ids
  ids=$(paste -sd, -)
  [ -S "$sock" ] && [ -n "$ids" ] || return 0
  printf '{"ungroup":[%s]}\n' "$ids" | nc -U -w 2 "$sock" >/dev/null 2>&1 && sleep 1
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
  jq -r --rawfile ids "$1" --argjson roots "$roots" "$here"'($ids | split("\n")) as $a
    | select(foreign | not) | select(.isArchived == true or ((.sessionId // "") | IN($a[]))) | .cliSessionId // empty' \
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
        print ((!kept && id == front) ? "keep" : "close") " " id
      }
    }' "$work/tabs" >"$work/plan"
  [ -s "$work/plan" ] || return 0
  [ -n "$dry" ] || cut -d' ' -f2 "$work/plan" | ungroup
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
          if act is "close" and not listOnly then close item 1 of found
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
      keep) say "left the last Chrome tab, on $host, open out of its group" ;;
      keep1) say "would leave the last Chrome tab, on $host, open out of its group" ;;
    esac
  done
}

# Prints a line for each group it deletes or keeps, "clean" once the bar holds
# no group left to delete, and "skip: why" when it could not look.
delete_groups() {
  local line
  [ -n "$dry" ] || return 0
  pgrep -x 'Google Chrome' >/dev/null || return 0
  jq -n --argjson roots "$roots" "$here"'[inputs | {open: (.isArchived != true or foreign),
    titles: ([.title] + (.previousTitles // []) | map(strings))}]' \
    "$sessions"/*/*/local_*.json >"$work/titles" 2>/dev/null || return 0
  osascript -l JavaScript - "${dry:+list}" "$work/titles" <<'EOF' 2>&1 | while IFS= read -r line; do
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
function run(argv) {
  const listOnly = argv[0] === 'list';
  const sessions = JSON.parse($.NSString.stringWithContentsOfFileEncodingError(argv[1], $.NSUTF8StringEncoding, null).js);
  const core = s => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const titles = list => list.flatMap(s => s.titles.map(core));
  const open = new Set(titles(sessions.filter(s => s.open)));
  const ours = new Set(titles(sessions).concat('Claude'));
  let locked = null;
  try { locked = ObjC.castRefToObject($.CGSessionCopyCurrentDictionary()).objectForKey('CGSSessionScreenIsLocked'); } catch (e) {}
  if (locked && !locked.isNil() && locked.js) return 'skip: the screen is locked';
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.google.Chrome');
  const procs = Application('System Events').processes.whose({ name: 'Google Chrome' })();
  if (apps.count === 0 || procs.length === 0) return '';
  const app = apps.objectAtIndex(0);
  const p = procs[0];
  const pid = p.unixId();
  // The run loop has to run, or what NSRunningApplication reports goes stale.
  const pump = () => $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
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
  // Walking the window's tree takes seconds, so the bar found is kept while it is there.
  let found = null;
  const bar = () => {
    if (found && nm(found[1]) === 'Saved Tab Groups') return found;
    found = null;
    for (const w of p.windows()) {
      if (sub(w) !== 'AXStandardWindow') continue;
      try { if (w.attributes['AXMinimized'].value()) continue; } catch (e) {}
      const b = find(w, k => nm(k) === 'Saved Tab Groups', 0);
      if (b) return (found = [w, b]);
    }
    return [null, null];
  };
  const buttons = () => { const b = bar()[1]; return b ? b.uiElements() : []; };
  const popup = () => p.windows().find(w => sub(w) !== 'AXStandardWindow');
  const groupOf = n => { const m = n.match(/^(.*) group - Closed$/); return m ? core(m[1]) : null; };
  const label = n => n.replace(/ group - Closed$/, '').replace(/^[^\p{L}\p{N}#]+/u, '').trim();
  const doomed = n => { const g = groupOf(n); return g !== null && ours.has(g) && !open.has(g); };
  const count = g => buttons().filter(k => groupOf(nm(k)) === g).length;
  if (listOnly) {
    if (!bar()[1]) return 'skip: no window shows the bookmarks bar';
    return buttons().map(nm).filter(doomed).map(n => 'would delete the Chrome tab group ' + label(n)).join('\n');
  }

  pump();
  if (app.active) return 'skip: Chrome is in front';
  const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const hidden = app.hidden;
  const chrome = Application('Google Chrome');
  const win = chrome.windows().find(w => { try { return w.mode() === 'normal' && !w.minimized(); } catch (e) { return false; } });
  if (!win) return 'skip: Chrome has no window to show the bookmarks bar in';
  let made = null, was = 0;
  if (!/^chrome:\/\/newtab/.test(win.activeTab.url())) {
    was = win.activeTabIndex();
    win.tabs.push(chrome.Tab({ url: 'chrome://newtab/' }));
    win.activeTabIndex = win.tabs.length;
    made = win.activeTab.id();
  }
  if (hidden) app.unhide;
  const restore = () => {
    if (hidden) {
      app.hide;
      for (let i = 0; i < 40; i++) { pump(); if (app.hidden) break; }
    }
    if (made !== null) {
      try { win.tabs.byId(made).close(); } catch (e) {}
      try { win.activeTabIndex = was; } catch (e) {}
    }
    pump();
    if (!hidden && app.active && !front.isNil()) front.activateWithOptions(0);
  };

  const sweep = () => {
    for (let i = 0; i < 12 && !bar()[1]; i++) delay(0.25);
    if (!bar()[1]) return ['skip: no window shows the bookmarks bar'];
    const out = [];
    // A group passed over this run: kept for good, or left to the next run.
    const passed = new Set();
    let unsure = false;
    for (let round = 0; round < 50; round++) {
      const w = bar()[0];
      const btn = buttons().find(k => doomed(nm(k)) && !passed.has(groupOf(nm(k))));
      if (!btn) break;
      const name = groupOf(nm(btn));
      const shown = label(nm(btn));
      const before = count(name);
      let menu = null;
      for (let t = 0; t < 3 && !menu; t++) {
        btn.actions['AXShowMenu'].perform();
        for (let i = 0; i < 8 && !menu; i++) { delay(0.25); menu = popup(); }
      }
      if (!menu) { out.push('Chrome tab groups: stopped, no menu opened for ' + shown); return out; }
      // A menu just opened can list its items before it names them.
      let items = [], names = [];
      for (let i = 0; i < 8; i++) {
        items = [];
        (function walk(el, d) {
          if (d > 8) return;
          let ks; try { ks = el.uiElements(); } catch (e) { return; }
          ks.forEach(k => { if (role(k) === 'AXMenuItem') items.push(k); walk(k, d + 1); });
        })(menu, 0);
        names = items.map(nm);
        if (names.length > 0 && names.every(Boolean)) break;
        delay(0.25);
      }
      if (!names.some(Boolean)) {
        key(53);
        passed.add(name);
        unsure = true;
        out.push('left the Chrome tab group ' + shown + ' for the next run, its menu named no items');
        continue;
      }
      const del = names.indexOf('Delete group');
      if (names[0] !== 'Open group' || del < 0) {
        key(53);
        passed.add(name);
        out.push('kept the Chrome tab group ' + shown + ', whose menu has ' + names.filter(Boolean).join(', '));
        continue;
      }
      // AXPress on a Chrome menu item does nothing, so the keyboard picks it.
      let picked = false;
      for (let i = 0; i < items.length + 1 && !picked; i++) {
        key(125);
        try { picked = items[del].selected() === true; } catch (e) {}
      }
      if (!picked) {
        key(53);
        passed.add(name);
        unsure = true;
        out.push('left the Chrome tab group ' + shown + ' for the next run, Delete group was not highlighted');
        continue;
      }
      key(36);
      for (let i = 0; i < 12 && count(name) === before; i++) {
        delay(0.25);
        const sheet = w.uiElements().find(k => role(k) === 'AXSheet' && nm(k) === 'Delete Tab Group?');
        const yes = sheet && find(sheet, k => role(k) === 'AXButton' && nm(k) === 'Delete Group', 0);
        if (yes) { yes.actions['AXPress'].perform(); delay(0.75); }
      }
      if (count(name) === before) {
        passed.add(name);
        unsure = true;
        out.push('left the Chrome tab group ' + shown + ' for the next run, it was still there after Delete group');
        continue;
      }
      out.push('deleted the Chrome tab group ' + shown);
    }
    if (!unsure && !buttons().some(k => doomed(nm(k)) && !passed.has(groupOf(nm(k))))) out.push('clean');
    return out;
  };

  try { return sweep().join('\n'); } finally { restore(); }
}
EOF
    case $line in
      '') ;;
      clean) [ -n "$dry" ] || { rm -f "$state/groups-pending"; touch "$state/groups-swept"; } ;;
      skip:*) [ -n "$quiet" ] || say "Chrome tab groups: skipped, ${line#skip: }" ;;
      *) say "$line" ;;
    esac
  done
}

handle() {
  local record=$1 t created since task
  t=$(transcript_of "$record")
  current=$t
  say "$(jq -r '.title // .sessionId' "$record")"
  if [ "$(jq -r --argjson roots "$roots" "$here"' foreign' "$record")" = true ]; then
    say "  skipped, started in $(jq -r '.cwd // "an unknown folder"' "$record"), outside this machine's home, temp and removable-drive folders"
    return
  fi
  if [ -z "$dry" ] && [ -n "$(jq -r '.chromeTabGroupId // empty' "$record")" ]; then
    touch "$state/groups-pending"
  fi
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

lock="$state/lock"
mkdir -p "$state"
groups_left() { [ -e "$state/groups-pending" ] || [ ! -e "$state/groups-swept" ]; }

if [ "${1:-}" = --groups ]; then
  touch "$state/groups-checked"
  [ "$(uname -s)" = Darwin ] && groups_left || exit 0
  [ -z "$(find "$state/groups-tried" -mmin -10 2>/dev/null)" ] || exit 0
  idle=$(/usr/sbin/ioreg -c IOHIDSystem | awk '/HIDIdleTime/ { print int($NF / 1000000000); exit }')
  [ "${idle:-0}" -ge 120 ] || exit 0
  mkdir "$lock" 2>/dev/null || exit 0
  trap 'rm -rf "$work"; rmdir "$lock"' EXIT
  touch "$state/groups-tried"
  quiet=1
  delete_groups
  exit 0
fi

locked=
for _ in $(seq 60); do
  mkdir "$lock" 2>/dev/null && locked=1 && break
  [ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ] && rmdir "$lock"
  sleep 1
done
[ -n "$locked" ] || exit 0
trap 'rm -rf "$work"; rmdir "$lock"' EXIT

# The list used to sit in the synced folder, where it may hold the other
# machine's ids by now; this machine's own archives stand in for it then.
old="$archive/.archived-sessions"
if [ ! -f "$seen" ] && [ -f "$old" ]; then
  jq -r '.archived[]' "$sessions"/*/*/archived-sessions.idx 2>/dev/null | sort -u >"$work/all"
  if comm -23 "$old" "$work/all" | grep -q .; then cp "$work/all" "$seen"; else cp "$old" "$seen"; fi
  rm -f "$old"
fi

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
  groups_left && delete_groups
fi
