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

set -u

anchor="$(cd "$(dirname "$0")" && pwd)/chrome-anchor.html"

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
