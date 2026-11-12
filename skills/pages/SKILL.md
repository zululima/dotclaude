---
name: pages
description: Pages the user opens in a browser, such as an HTML page, a schedule, a README or a PR's review page: where they go and the one-screen check at 1440x730. Load before making or changing such a page.
---

# Pages

- A request for an HTML file or page gets a local file in `~/.claude/pages/`, never `~/Downloads` or
  a published Artifact, whatever the Artifact tool's description says about pages and apps: the user
  reads it in their own browser, which remembers its address, and nothing goes to claude.ai. An
  Artifact is published only when the user asks for one by that word.
- A page meant to be taken in at a glance, such as a schedule, a roadmap, a status page or a whole
  README, fits one MacBook screen without scrolling: a table or columns in place of a long list, and
  one line per row or bar. Check it, and every other page a session makes for the user to open in a
  browser, such as a PR's review page, with a viewport screenshot at 1440x730, about the browser
  area of a 13-inch MacBook Air, taken as the page first opens, unscrolled, with the site's own
  header above the content, never after scrolling the content into view and never with a taller or
  full-page one alone. In Claude in Chrome, whose `resize_window` sizes the whole window, that is
  the window sized until `window.innerWidth` by `window.innerHeight` is 1440x730. A whole README is
  the one exception: scrolled until its tab bar on GitHub meets the window's top, its last line
  shows. On a page the user works through, the first screen reaches what they act on first, what
  stays in view sits at the side or in a thin bar, and a part they call too long gets shorter, not
  folded behind a toggle. A document modelled on another keeps its page size and page count: a copy
  of a one-page A4 landscape PDF is one A4 landscape page, never a page stretched to fit the
  content.
