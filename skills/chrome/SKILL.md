---
name: chrome
description: Browser work in Claude in Chrome: starting the extension, reading before each click, local files, rendering a page to a file, Google APIs and sign-ins. Load before the first browser step of a turn.
---

# Browser work

- Browser work runs in Claude in Chrome, the extension in the user's own Chrome, which the user also
  calls Chrome and is signed in to, never in the desktop app's built-in browser pane, whose user
  agent cannot be changed. A page, a file or an upload is tried there before a reply calls it out of
  reach, and an address that WebFetch or another fetch could not reach is tried there next and with
  plain curl from the user's machine, its public API included, before any question or other route.
  When the extension is not connected, the session runs `~/.claude/hooks/chrome-background.sh`
  without asking, which gives the extension the window it needs and keeps Chrome hidden, and never
  opens Chrome another way, since Chrome then puts its window on top. Nor does a session open a
  tab or load a page in Chrome through AppleScript, which brings Chrome to the front as well, while
  Claude in Chrome's own tools do it unseen. It then calls
  `list_connected_browsers` for up to a minute until it lists a browser, and tries before that are
  no failures. When the extension is still not connected, the reply gives its install page and the
  step to sign in to it from Chrome's side panel, and the browser step waits for that, never moving
  to the pane. A local file reaches a page through the extension's `file_upload`, up to 10 MB a
  call, and a larger one through `~/.claude/hooks/pane-bridge.mjs`, driven as its header says.
  Rendering is browser work too: no session starts a Chrome of its own, headless or with another
  profile, also not to turn a page into an image or a PDF. Playwright's own Chromium, which a
  project's tests and the `pull-requests` skill's screenshots run on, is not that app. A page that
  has to become a file draws it on a canvas in a Chrome tab, an HTML layout through an SVG
  `foreignObject` with each font named by its installed family or inlined as a data URL, never a
  keyword such as `-apple-system` or a linked web font, and posts the blob to the bridge's `/save`
  from a page the bridge serves. A job Chrome cannot do this way is asked about first. A Google API
  is read through Google's OAuth 2.0 Playground with the narrowest read-only scope the user said yes
  to, a grant the session removes under `myaccount.google.com/connections` once the read is done.
  A sign-in page in a Chrome tab for a site the user is signed in to in Firefox means the cookie
  bridge's copy fell short, so before that sign-in goes to the user the session checks that Firefox
  runs and has had the site open since it started, that the site's cookies and local storage
  reached the tab, reads the page's own code for signed-in state kept elsewhere, such as in
  IndexedDB or session storage, which the bridge does not carry, and names the cause in the reply.
  When a step needs the user in the browser, such as a sign-in, personal data to type or a click the
  session may not make, the session opens the page that step happens on in a tab of its group,
  leaves that tab open, selects it with `~/.claude/cookie-bridge/front-tab <tab id>`, puts the
  cursor in the field to fill and names the tab in the reply, and the turn ends with `wrap_up` and
  `blocked`, so the sidebar marks the session as waiting on the user. A source behind the user's
  sign-in, such as Apple's developer downloads, is such a step, never one left unread or called not
  checked. A step that hands the user input to type in the browser names the button that saves it,
  and the session reads that page as it stands before its first navigate, reload or click away from
  it, saves what is still unsaved and leaves only once the input is saved.
- Before each click in a Chrome tab, the session reads the page as it is at that moment, a fresh
  screenshot or an element's ref from `find`, never coordinates from an earlier screenshot, since
  the user may have scrolled, typed or clicked there since. A click that submits, sends or posts
  first checks that the page still holds what the user approved, and a change the user made is named
  in the reply before it asks again.
- No reply suggests storing a password in Chrome: not in Chrome's own password manager or through
  its offer to save one, not by importing passwords from Firefox, and not in a password manager's
  Chrome extension that fills logins there. A sign-in in Chrome is the user's to type or paste each
  time a site asks, from the password manager they keep outside Chrome.
- Chrome tabs stay open, so the user never waits on a close: archiving a session closes every
  Chrome tab no open session names, the user's own too, through the app and the `archive-files` mod,
  which first takes those tabs out of their tab groups so Chrome deletes the saved groups, and
  deletes groups closed earlier while Chrome is out of sight. Chrome opens its next window at the
  size of
  the last one, so before its first `resize_window` the session reads `window.outerWidth` and
  `window.outerHeight`, and before the reply sets the window back to that size.
