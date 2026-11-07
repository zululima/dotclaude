#!/usr/bin/env bash

# Gives Claude in Chrome a window to connect through without putting Chrome on
# the screen. The extension stays unconnected while Chrome runs with no window,
# and a window Chrome opens for a URL lands on top of the app in front even
# with open -g, so this opens chrome-anchor.html and keeps Chrome hidden
# meanwhile, unless Chrome was the app in front. A Chrome that already has a
# window gets no tab, since the new tab would become the one in view. The
# anchor tab closes itself when the user comes back to it a minute later. A
# hidden Chrome still loads, reads and screenshots pages for the extension.
# Hiding goes through NSRunningApplication and counting windows through
# CGWindowListCopyWindowInfo, neither of which needs a permission. open -a
# without a URL would send a reopen, and Chrome brings itself to the front for
# that.
#
# On Linux with KDE Plasma, Chromium (or Chrome) gets the anchor as its only
# window and chrome-anchor-kwin.js hides that window as KWin maps it: minimized
# and left out of the taskbar, pager and switcher. KWin's window runner counts
# the browser's windows, hidden ones included. --new-window would also open a
# New Tab window when the browser was not running yet, so the URL goes alone.

set -u

hooks="$(cd "$(dirname "$0")" && pwd)"
anchor="$hooks/chrome-anchor.html"

if [ "$(uname -s)" = Linux ]; then
  browser=$(command -v chromium google-chrome-stable | head -n 1)
  [ -n "$browser" ] || { echo "Neither Chromium nor Chrome is installed"; exit 1; }
  kwin() { busctl --user call org.kde.KWin "$@" 2>/dev/null; }
  windows() {
    busctl --user --json=short call org.kde.KWin /WindowsRunner org.kde.krunner1 Match s chrom \
      2>/dev/null | jq '[.data[0][] | select(.[1] | test(" - (Chromium|Google Chrome)$"))] | length'
  }
  if [ "$(windows)" -gt 0 ] 2>/dev/null; then
    echo "Chromium already has a window for Claude in Chrome"
    exit 0
  fi
  kwin /Scripting org.kde.kwin.Scripting unloadScript s claude-chrome-anchor >/dev/null
  id=$(kwin /Scripting org.kde.kwin.Scripting loadScript ss "$hooks/chrome-anchor-kwin.js" \
    claude-chrome-anchor | awk '{print $2}')
  [ -n "$id" ] && kwin "/Scripting/Script$id" org.kde.kwin.Script run
  setsid -f "$browser" "file://$anchor" >/dev/null 2>&1 </dev/null
  if [ -z "$id" ]; then
    echo "Chromium has a window for Claude in Chrome, left in view since KWin did not answer"
    exit 0
  fi
  for _ in $(seq 60); do
    [ "$(windows)" -gt 0 ] 2>/dev/null && break
    sleep 0.5
  done
  kwin /Scripting org.kde.kwin.Scripting unloadScript s claude-chrome-anchor >/dev/null
  echo "Chromium has a hidden window for Claude in Chrome"
  exit 0
fi

jxa() {
  osascript -l JavaScript -e 'ObjC.import("AppKit"); ObjC.import("CoreGraphics");
    function chrome() {
      const a = $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.google.Chrome");
      return a.count ? a.objectAtIndex(0) : null;
    }
    function windows(c) {
      const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0));
      let n = 0;
      for (let i = 0; i < list.count; i++) {
        const w = list.objectAtIndex(i), b = w.objectForKey("kCGWindowBounds");
        if (w.objectForKey("kCGWindowOwnerPID").js === c.processIdentifier
          && w.objectForKey("kCGWindowLayer").js === 0
          && b.objectForKey("Width").js >= 200 && b.objectForKey("Height").js >= 200) n++;
      }
      return n;
    }'"$1"
}

state=$(jxa 'const c = chrome(); !c ? "none" : windows(c) ? "window" : c.active ? "front" : "back"')

case "$state" in
  window) echo "Chrome already has a window for Claude in Chrome"; exit 0 ;;
  front) open -g -a "Google Chrome" "$anchor"; exit 0 ;;
  none) open -g -j -a "Google Chrome" "$anchor" ;;
  *) jxa 'chrome().hide; ""' >/dev/null; open -g -a "Google Chrome" "$anchor" ;;
esac

jxa 'for (let i = 0; i < 100; i++) { const c = chrome(); if (c && !c.hidden) c.hide; delay(0.05); } ""' >/dev/null
echo "Chrome has a hidden window for Claude in Chrome"
