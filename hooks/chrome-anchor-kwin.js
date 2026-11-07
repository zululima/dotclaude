// KWin script that chrome-background.sh loads on KDE Plasma just before it
// opens chrome-anchor.html. It hides the first Chromium or Chrome window KWin
// maps after that, the anchor's, so Claude in Chrome gets its window without
// one showing on screen, in the taskbar or in the window switcher. The shell
// script unloads it again once that window exists.

let hidden = false;

workspace.windowAdded.connect(window => {
  if (hidden || !/chrom/i.test(window.resourceClass)) return;
  hidden = true;
  window.minimized = true;
  window.skipTaskbar = true;
  window.skipPager = true;
  window.skipSwitcher = true;
});
