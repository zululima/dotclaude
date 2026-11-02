---
name: pull-requests
description: Procedures for a pull request. Load it before opening a PR or editing its body, before writing test steps for a change under review in a PR body or in chat, before reviewing a PR, and before capturing or uploading screenshots or recordings for one. It covers the body layout, the prompts block, the template answers, How to verify, manual steps, the review page and its reply, and the pictures.
---

# Pull requests

These procedures sit beside the Pull requests rules in `~/.claude/CLAUDE.md`, which still hold:
drafts only, one draft PR per issue and every other change on one already open, never post on
GitHub, meta prompts left out, and downstream names redacted in public and upstream repositories.

## The body

- Claude's part of the body is, in this order: the one sentence on what has changed, a list of the
  changes, the line that closes issues (`Closes #n`, with any related documents), the two blocks
  below, then the rest of the repository's pull request template filled in as described further
  down. Nothing else: no free-form summary or test plan outside that. The sentence, the list and the
  closing line stand on their own, without a heading, even where the template gives them sections of
  their own. Without a template the body ends after the blocks and the user writes the description.
- The list of changes under the sentence is built from the PR's final diff against its base, from
  the merge base to the head; the commits only help to understand intent. One short bullet per
  meaningful change, or per group of related ones, saying what it does and, when that helps the
  reviewer, why. No file names, paths or line numbers, and no detail the diff already shows unless
  it explains a behaviour or a decision. Tests, translations and documentation stay out unless they
  are a purpose of the PR. Uncommitted changes are left out. The list is rebuilt with the sentence
  whenever a push changes what the PR does.
- The closing line names the parent of a closed issue too when this PR closes the last of its
  sub-issues still open, since GitHub leaves a parent open after its last sub-issue closes. The
  issue's `parent` and that parent's `subIssues` with their states come from `gh api graphql`, and
  the check runs again whenever the closing line is written or the body refreshed, as a sub-issue
  may close elsewhere in the meantime. A parent whose body names work that none of its sub-issues
  covers stays off the line, and the reply says why.
- When a PR, draft or not, closes an issue, assign the user to that issue, with `gh issue edit <n>
  --add-assignee <handle>` and the handle from `gh api user --jq .login`. Do it when the PR is
  opened and again whenever its `Closes` list changes, and skip the issue silently when the edit is
  refused for lack of permission. The board then shows who holds the work without a separate step.
- The two blocks come straight after the closing line and above the rest of the template. They
  are a TL;DR for the reviewer.
- First block: a fenced code block holding the URL of the public configuration repository
  described under Public configuration repository in `~/.claude/CLAUDE.md`, pinned to a commit
  as `<repository URL>/tree/<full hash>`, so teammates can read and copy the rules the body was
  last checked against, not ones changed since. Take the repository URL at runtime from the
  checkout's `origin` remote, with `git -C ~/Projects/dotclaude remote get-url origin`,
  rewritten from the SSH form to https and without the `.git` suffix, and the hash from
  `git -C ~/Projects/dotclaude ls-remote origin HEAD`, the commit GitHub serves as the default
  branch, never from memory or from a local commit not pushed yet. Every edit of the body takes
  the hash again, and every push to that repository edits each open PR that carries the block,
  as Public configuration repository in `~/.claude/CLAUDE.md` says, so the block names the
  commit current at the body's last edit. A code block and not a Markdown link: a link's
  visible text can differ from where it goes, while a URL the reader pastes is one they see in
  the address bar before they go.
- Second block: `<details><summary>Prompts behind this PR</summary>`. Its first line names the
  model and effort level the session ran with, for example `Model: claude-fable-5-1, effort:
  medium`. Take them, and the prompts under it, as the bullet on printing the prompts in the
  `commit-messages` skill says, never from memory. Then number every prompt from the session in
  order and quote each verbatim, typos and lowercase included, as a `>` blockquote (`**1.**` on its
  own line, then the `>` quote). Include prompts that produced no commit. Mark answers to questions
  with a short parenthetical after the number, such as `**2.** (answer to: shall I build it?)`.
- Directly under the model line, before the first prompt, a nested
  `<details><summary>Abbreviations</summary>` block lists every abbreviation used anywhere in the
  quoted prompts with its expansion, one per line, so a reader who does not know one can open
  the list and check. When the prompts use none, leave the block out.
- Pasted text inside a quoted prompt is replaced by a bracketed description, as the commit
  message rules say. The prompts may come before the rest of the body here, unlike in a commit.
- Below the blocks, fill in the rest of the repository's pull request template when it has one.
  Look in `.github/` for `pull_request_template.md` or `PULL_REQUEST_TEMPLATE.md`, a
  `PULL_REQUEST_TEMPLATE/` directory, and the same names at the repository root and under
  `docs/`. Keep the template's headings, comments and order, apart from the summary and the
  issue links, which go to the top as above, and answer each section briefly, such as the
  manual steps a reviewer follows to verify the change in the running app. A section
  that asks a yes/no question with a checkbox for each answer, such as "Added tests?" or "Is
  documentation up-to-date?", keeps only the box that applies, ticked, and the other box's
  line is deleted rather than left empty: nothing more when the answer is yes, one sentence
  saying why when it is no.
  `gh pr create` applies the template only when it composes the body interactively. `--body`
  and `--body-file` replace it silently, so the body file has to contain the template text.
- To change the body, read the live one into a file with `printf '%s' "$(gh pr view <n> --json body
  --jq .body)" > <file>`, edit it there, write it back with `gh pr edit <n> --body-file <file>`, and
  re-read to confirm. The command substitution drops the newline `--jq` prints after the body, which
  `--body-file` would keep as one more blank line on every edit, and any that earlier edits left.
  Outside the blocks, change only a template answer that a later commit made wrong or left
  incomplete, and keep every edit the user has made there.
- After a commit that answers review threads, read How to verify against each thread. A fix that
  changes what a reviewer sees or does gets a manual step, or a sentence in the step that already
  shows that screen, and the summary sentence and the list are rewritten when they no longer cover
  the PR. A fix nothing on screen shows needs no step.

## How to verify

- Test steps for a change under review, in a PR body's "How to verify" or given in chat, end
  with the last check. No step switches the checkout back to the branch it was on before: the
  next review's checkout replaces the branch anyway, and where to go next is the reader's call.
  Automated checks come first, the verify command and then end to end, and the manual pass comes
  last, unless the user says otherwise: a failing spec shows before the slow part, and end to end
  never follows the manual steps.
- The automated part is two command steps, each one fenced block joined with `&&`, since each
  is a sequence that should stop at its first failure. The first, run in a tab of its own,
  fetches, switches to the branch, updates the submodules and starts the stack. The second, in
  another tab, runs whatever the stack needs after a switch (a cache clear, a build), the verify
  command and the end to end run. Both run in a subshell that opens with `cd` into the checkout, as
  in `(cd ~/Projects/<repo> && git fetch --all --prune && ...)`, since the reader pastes them into a
  new terminal, which starts in `~`. The manual steps follow them.
- Manual steps follow the screen. Before writing one, open the component or the running page and
  take the order of fields and clicks from it, so a dialog that shows type, then name, then
  company is filled in that order and never in the order the step's purpose brings them to mind.
  Every control is named by the label the reader sees, in bold, in the locale the app renders
  (the catalog's `msgstr`, or the `msgid` when that is empty), never by what it does for the
  flow: click **Add item**, search for C and click its card, not "pick an item"; the row's
  **Delete**, not "remove it". A verb alone never stands for a control. When a label is on more
  than one control, say which: the row's, the dialog's, the bottom bar's. One action per
  sentence, followed by what the reader should now see, and two actions that each trigger the
  same thing get a sentence each, never "both ask too". Test data the reader creates gets the
  shortest name that works, a, b, c or 1, 2, 3, never a prefix such as the PR's number, unless
  a screenshot or recording of that step shows other data: then the step has the reader type
  and pick exactly what the picture shows, so the screen matches the picture. A step
  that searches by name says what to type and uses the shortest string the seed data does not
  contain, checked with a search in the grid first. Every action the reader takes is written
  down, also the ones that feel obvious: copy the address before pasting it, open the new tab
  before pasting into it, log in again after logging out. A step never relies on something the
  reader has not been told to do. A step that opens a page gives its full local address, such
  as `http://localhost:3000/items`, in a `text` block of its own under the step, never the
  page's name alone and never inline, so the reader copies it in one click instead of hunting
  through the navigation. Steps run in the order their data needs, deletions last. A
  step that uses a seeded record says it comes from the seed and what to type to find it. Where
  the screen shows a stand-in, such as placeholder data, a mock or an unwired part, or a part
  that ignores the step's input, the step says so. A limitation found while building goes into
  its step, not only into the reply.
- The user works through the steps on the review page that Reviewing a PR describes, for every PR
  and not only in a review. The session that opens a PR, or pushes a commit that changes its steps
  or what they show, builds the page in the same turn, after the pictures are in the body, with the
  checks it ran as the overlay's results, and its reply ends with the page's address as a review's
  reply does.

## Reviewing a PR

- A check or review the user asks for on a PR whose author is the user, such as of its links or its
  pages, ends with the fixes the session would recommend committed and pushed to that PR's branch in
  the same turn, and the reply lists each fix with its commit, so a no costs one revert. A prompt
  that asks a question, for thoughts, a yes or no or a why, or says to change nothing yet, gets an
  answer only. A fix the request, the code or a source cannot settle, such as a choice between two
  layouts, is asked as under Running things in `~/.claude/CLAUDE.md`, and a step beyond the branch,
  such as a merge or a change outside the repository, stays a proposal. A review of a PR another
  author opened stays findings for that author, as this section says.
- A PR review switches the checkout to the PR's branch and leaves it there, runs the two command
  steps above itself, and checks the PR's manual steps against the screen. "Here" or "only" in a
  review prompt limits where the reply goes, never what runs.
- The steps the reader follows go on a review page, never into the reply, so they cannot drift from
  what the PR holds. Build it with `review-page/build.py` beside this skill, run in the checkout as
  `python3 -I ~/.claude/skills/pull-requests/review-page/build.py <owner/repo#n> --review
  <overlay.json>`. It writes the page to `.reviews/<repo>-<n>.html` in the checkout, a folder it
  adds to the checkout's `.git/info/exclude` so git never sees it, and it is a local file, never an
  Artifact. The script takes the steps of the PR body's How to verify? as GitHub holds them, embeds
  the PR's screenshots, downloaded with the `gh` token, and adds from the overlay the review's
  results, its findings and the steps it adds. The findings come first, as steps, so the reader can
  request changes before the manual pass, and each miss shows inside the step it concerns. A finding
  or a miss fixed during the review carries `fixed` with its commit and stays off the page, since
  the reader has nothing left to do about it; the reply names the fix. A result's name says in plain
  words what ran, such as manual steps replayed by a script, and its detail is a few words, what ran
  on which head with what count, such as 119 of 119 on abc1234, and the script refuses a longer one.
  The browser tab reads Review PR and the number, with a tick for an icon. Checks that failed or did
  not run and the count of open findings go in a box above the steps, and a review where all is well
  shows none. The page numbers its steps from 1 across all sections and opens on the first step not
  done, so its keys work at once. `j` and `k` move to the next or the previous step and scroll it to
  the top of the window, alone on the screen with nothing of the steps before or after it in view,
  and a section's first step brings the section's heading and note along. `x` ticks it and moves on
  to the next one, or clears a tick and stays, `c` copies its first command or address and `o` opens
  its screenshot. The current step lists these keys under its title and its first block says that
  `c` copies it, so the page has no key list of its own. On a wide window the steps sit centred,
  with the PR and the progress in a rail on the left that stays in view while the steps scroll; a
  narrow one keeps only a thin progress bar at the top. An address in a `text` block is a link on
  the page. The ticks live in the browser's storage for that file, so a later review of the same PR
  rebuilds the page at the same path and they stay; the session cannot read them, so the reader says
  how far they got.
- The reply gives the results of the verify command and the end to end run, then the findings and
  the fixes made, and no step list of its own. It ends with the page's `file://` address, with the
  full path from the root, in a `text` block of its own, which the user pastes into Firefox's
  address bar, as `~/.claude/CLAUDE.md` says for every local HTML page. The block is the last thing
  before Prompt feedback, where the reader's eye is when they go to copy it.
- Where the PR's steps fall short, the overlay's `added_steps` put the fix on the page, marked as
  added by the review: the two command steps when the PR lacks them (an empty `after` puts a step
  before the PR's first), a step for a change the PR's steps skip, and the bug steps below. They
  take the standing form above, from the screen, and a step that runs a command carries it in a
  block under it. Open every picture of the PR at full size before checking its step against the
  screen.
- Before a PR is opened and in every review, check it against what people asked to change on the
  repository's PRs of the last 30 days, leaving out bots and Copilot's reviews. `gh pr list
  --state all --search 'updated:>=<date>' --json number,url,reviews` gives the review bodies, and
  `gh api --paginate 'repos/<owner>/<repo>/pulls/comments?since=<date>'` and the same with
  `issues/comments` give the inline and conversation comments. A correction counts wherever it
  applies to what the PR changes, also one made about another page, such as where a back link
  lands or how a field looks. Before opening, fix each miss on the branch. In a review each miss
  is a finding that quotes the comment and links it, and the overlay's `results` carry the check,
  with how many corrections applied and how many of those the PR follows.
- Each finding carries its severity, high, medium or low. Every finding that is not low gets the
  shortest reproduction that shows it, so the reviewer can send the author back to fix it before
  reviewing anything by hand: from the stack running the PR's branch on its seed data, the fewest
  numbered steps that bring the bug out, then what happens, what should happen instead and, when the
  review found it, the code that causes it, as GitHub markdown in a fenced block under the finding,
  in the reply and in the overlay. The reproduction is run here as written before it goes in.
- Every bug the review finds has a step on the page where the reader sees it: an added step right
  after the step that reaches the state, opening with "Bug (finding n):", that gives the clicks that
  bring the bug out, then what the screen shows and what it should show instead. The finding's
  `step` names it, so the reader can go from either to the other. The bug's step undoes any change
  the later steps do not expect. A bug nothing on screen can show, such as a race or a path no click
  reaches, says so in its finding.
- Each entry of the overlay's `missed` names a step and says what the PR's instructions missed
  there, and an empty list says nothing was: a label that is not on screen; a click left out; a step
  the seed data cannot do, or state the reviewer builds by hand through a workflow the specs already
  cover, which the PR should have seeded; a change without a step, named on the added step that
  covers it; a command that fails pasted into a new terminal; a check that failed or a claim the run
  disproved; a picture placed after the step it shows. When the PR's command steps are missing or
  wrong, the reply ends with the two command steps as GitHub markdown inside a four-backtick fence,
  so the PR's "How to verify" can take them over unchanged. That block is the one thing in the reply
  written for the PR's body, as the reproductions are the ones written for its author.

## Screenshots and recordings

- Every manual step of How to verify gets a screenshot of the state it describes, in the PR body and
  so on the review page, whether or not the change alters what a page renders: the reader sees what
  should happen before acting. A recording comes on top where motion is the point, or where the
  change is visual and the repository asks for one, in its pull request template or in the agent
  instructions it keeps in context (`AGENTS.md`, `CLAUDE.md`). A repository may keep such asks out
  of the template so the body carries only what a reviewer reads, and they bind as much there.
- Capture them from the local stack on fixture data with a scratch Playwright script in the
  scratchpad, on the repository's Playwright install, never a config change in the repository:
  one PNG per manual step of "How to verify", in the state that step describes, named after the
  step, and a WebM only where motion is the point. A recording is made with `slowMo` of about
  400 ms on the browser launch and a pause of two or three seconds at every state a step
  describes, since a Playwright run at full speed is too fast to follow. Fixture data is what
  the project's own start command leaves, so capture on a stack that no end to end run has
  touched since its last clean start: specs add records the reader's stack lacks.
- Open every picture with Read before it is uploaded, and check that it shows the state its step
  describes and nothing a freshly started stack would not show.
- Whenever screenshots or recordings exist for a PR and show what it changes, upload them to it
  in the same turn they are made, without asking first: a reply never ends with a set waiting
  for a go. Upload them through GitHub's own editor, where the user is signed in: drop the files
  into the PR's comment box, copy the markdown GitHub puts there, and clear the box without
  posting. The app's built-in browser pane has no file upload tool, so run
  `~/.claude/skills/pull-requests/pane-upload.sh -C <checkout> push <file>...`. It pushes the
  files on a throwaway branch and prints the JavaScript to run with `javascript_tool` on the
  PR's page, which returns the markdown and clears the box, then `pane-upload.sh clean <branch>`
  deletes the branch. An error from the JavaScript is never worked around: a pane signed out of
  GitHub waits for the user to sign in, and text already in the box is the user's and stays.
- Each picture goes at the start of the step it shows, never on the line with the number: that
  line holds the number and one short clause naming what the picture shows, the picture follows
  on its own line under it, indented to the step, and the step's text comes after the picture,
  so the reader sees what to look for before acting. A recording goes the same way under the
  first step it covers, as a bare attachment URL on its own line, which GitHub renders as a
  player where a `[name](url)` link does not. Write the body back with `gh pr edit`.
- Redo the set after every push that changes what is on screen, the way the prompts block is
  refreshed, so no reviewer judges a stale picture, and rebuild the review page with it.
