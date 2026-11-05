#!/usr/bin/env bash

# Gives Claude in Chrome a window to connect through without putting Chrome on
# the screen. The extension stays unconnected while Chrome runs with no window,
# and a window Chrome opens for a URL lands on top of the app in front even
# with open -g, so this opens about:blank and keeps Chrome hidden meanwhile,
# unless Chrome was the app in front. A hidden Chrome still loads, reads and
# screenshots pages for the extension. Hiding goes through NSRunningApplication,
# which needs no Automation permission. open -a without a URL would send a
# reopen, and Chrome brings itself to the front for that.

set -u

jxa() {
  osascript -l JavaScript -e 'ObjC.import("AppKit");
    function chrome() {
      const a = $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.google.Chrome");
      return a.count ? a.objectAtIndex(0) : null;
    }'"$1"
}

state=$(jxa 'const c = chrome(); c ? (c.active ? "front" : "back") : "none"')

case "$state" in
  front) open -g -a "Google Chrome" about:blank; exit 0 ;;
  none) open -g -j -a "Google Chrome" about:blank ;;
  *) jxa 'chrome().hide; ""' >/dev/null; open -g -a "Google Chrome" about:blank ;;
esac

jxa 'for (let i = 0; i < 100; i++) { const c = chrome(); if (c && !c.hidden) c.hide; delay(0.05); } ""' >/dev/null
echo "Chrome has a hidden window for Claude in Chrome"
