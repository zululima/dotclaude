---
name: slack-draft
description: Draft a Slack message for the user to paste and send themselves. Load whenever a Slack reply, post or DM is drafted, formatted or needs links.
---

# Slack drafts

Claude never sends a Slack message, as `~/.claude/CLAUDE.md` says. It drafts, and the user pastes
and sends. The CLAUDE.md rule on reading every source before drafting still holds.

A draft that links a guide, a page or a document says only what the link does not: that it exists
or changed, and what the reader should do with it. A step, a sign-in, a person to ask or an address
that the linked page already gives stays out of the draft, and so does a list of what the page
holds.

A draft of figures or options that a step of the reply has the user show a channel is the session's
report in its own words, never written as the user speaking: the user posts it with words of their
own around it. A draft the user asks for as their own message, such as what to answer in a thread,
is that whole message in the user's voice: the greeting, the answers and every question the readers
must answer for the work to go on, such as a decision that is theirs to make.

Each item of a list in a draft, such as a line per issue, is one line: what the item is and where it
stands, in a clause, never several sentences. A list of paragraphs is hard to read, so what does not
fit in the line stays out.

## Why the clipboard

Slack's message box turns neither `[text](url)` nor `<url|text>` into a link. That syntax works only
through the API. By hand, link text gets in only by pasting a URL over selected text or by pasting
rich text, and bold, lists and code also survive only a rich paste. A draft that uses any of them
therefore goes on the clipboard as rich text, whatever the channel or DM, and the user sends it
with one paste. A draft of words, line breaks, bare addresses and emoji codes alone survives a
plain paste and skips the clipboard: the reply gives it in a `text` block, with a blank line
between paragraphs, and steps 1, 3 and 4 below do not apply to it.

## Steps

1. Write the draft as an HTML fragment in `~/.claude/drafts/<topic>.html`, with words separated
   by dashes, starting with `<meta charset="utf-8">`. Write it with a `cat` heredoc in Bash,
   never with the Write tool: the desktop app opens an HTML file the Write tool writes in the
   built-in browser pane, which a draft never does. The HTML only feeds the clipboard, so it
   stays out of `~/Downloads`, which is for files the user opens or sends. Use only what Slack
   keeps from a paste: `<p>`, `<b>`, `<i>`, `<code>`, `<a href>`, `<ul>` or `<ol>` with `<li>`,
   `<blockquote>` and `<pre>`. A bold label opens each list item, unless the message being
   answered set a format: then the draft copies it, as `~/.claude/CLAUDE.md` says under Prose. A
   blank line, an empty `<p><br></p>`, goes between paragraphs and between a list and the text
   around it.
2. Link text belongs only in a channel shared with another organisation, such as a Slack Connect
   channel. Everywhere else a draft has no link text: a link it needs is its bare address, and the
   rest of this step does not apply. In a shared channel, link the evidence a claim rests on
   inline, on the words that make the claim, never in a parenthetical after them, and pinned so
   the link still shows what the text says later. An identifier the text names, such as a table,
   a route, a class, a file or a tag, is `<code>`, and a code thing it names, a page of an app
   included, links to the lines that define or serve it:
   - a commit cited for what it changed: `https://github.com/<owner>/<repo>/commit/<full sha>`
     on its subject line, placed in the sentence ("commented out in commit <subject>"), never
     "(commit `abc1234`)". A commit named as a version keeps its short hash as code text.
   - lines of a file: `https://github.com/<owner>/<repo>/blob/<full sha>/<path>#L<a>-L<b>`, with
     the sha of the commit that was read, never a branch name
   - a release: `https://github.com/<owner>/<repo>/releases/tag/<tag>`, the tag as code text
   - a pull request or an issue: its full URL, never a bare `#123`
   - a Figma frame: `https://www.figma.com/design/<file key>/<slug>?node-id=<a>-<b>`
   - a Slack message: its permalink from the Slack connector

   Check each GitHub link with `gh api`, the `contents` endpoint with `?ref=<sha>` for a file,
   the `commits` endpoint for a commit and `releases/tags/<tag>` for a release. Never name a
   shell variable `path` in that loop: zsh ties it to `PATH`.
3. Run the copy script. It prints what it read back and exits non-zero when a type is missing.
   ```bash
   ~/.claude/skills/slack-draft/copy-rich.sh ~/.claude/drafts/<topic>.html
   ```
4. In the reply, give no copy of the draft, neither a text block nor a quote: the user reads it
   in Slack after the paste. Say it is on the clipboard, say in a line what changed since the
   last version when there was one, and name each link the recipients may not be able to open,
   such as a private repository or a permalink from another workspace. Then the steps. The first
   is to paste with Cmd+V in Slack and check it before sending. It names the channel, and for a
   thread reply whose message it answers, in words only, with no link to the channel, the thread
   or a message: the user goes there in the Slack app. The second is the command that puts the
   draft back on the clipboard once something else overwrote it, with the draft's own file name
   in place of `<topic>`:
   ```bash
   ~/.claude/skills/slack-draft/copy-rich.sh ~/.claude/drafts/<topic>.html
   ```

## What does not work

- AppleScript's `set the clipboard to` with HTML data writes HTML alone, and most paste targets
  then find nothing.
- A paste into Slack from a browser the session drives tests nothing: a synthetic Cmd+V does not
  reach the system clipboard and Slack ignores synthetic paste events. The script's read-back is
  the check, and the user's paste is the real test.
- The script needs macOS: `textutil` and `NSPasteboard`.
