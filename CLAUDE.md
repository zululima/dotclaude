# Standing rules for every project

These apply in every session, whatever directory Claude Code was started from. Project memory is
keyed to the start directory, so rules that hold everywhere live here instead of in memory. This
file names no person, organisation, customer or repository, so anyone can copy it as is. Names that
apply to one repository belong in that repository's project memory.

## Git identity and attribution

- Never override the git author, in a scratch or test repository too. Use the identity already
  configured in the repo or globally (check with `git config user.email`), and never guess an
  address. A `PreToolUse` hook, `~/.claude/hooks/no-identity-override.sh`, refuses `-c user.name=`
  and `-c user.email=`, the `GIT_AUTHOR_*` and `GIT_COMMITTER_*` name and email variables and
  `git commit --author`, and asks the user before `git config` sets or unsets a name or address.
- Never add `Co-Authored-By: Claude`, "Generated with Claude Code", or any Claude or Anthropic
  attribution to commits, PR bodies, or issues. The `attribution` setting also enforces this.
- When squashing a pull request, by squash merge or by squashing its commits into one before
  merging, add a `Co-authored-by: <name> <address>` trailer to the squashed commit for every human
  account whose commits are being squashed, apart from the author the squashed commit already
  carries. Take each name and address from `git log --format='%an <%ae>'` over the squashed range,
  never from memory. GitHub drafts these trailers in its squash-merge dialog: keep them. The rule
  above still holds, so no trailer ever names Claude or Anthropic.
- When squashing a pull request, also add a `Reviewed-by: <name> <address>` trailer for every
  human account that submitted a review on it. Take the identity from that account's own commits
  in the same repository: `gh api 'repos/<owner>/<repo>/commits?author=<login>&per_page=1'`
  gives the name and address it commits under. Fall back to the account's
  `<id>+<login>@users.noreply.github.com` address, with the id from `gh api users/<login>`, and
  skip the account when neither resolves. A review alone never earns a `Co-authored-by`, an
  address never comes from another repository, and a bot never gets a trailer.

## Remote state

- Run `git fetch --all --prune` before relying on remote state: which branches exist, where the
  default branch is, whether a branch was merged, what an open PR is based on. Remote-tracking
  refs go stale between sessions, and a decision made on a stale ref is wrong in a way that is
  hard to notice afterwards.
- A `UserPromptSubmit` hook in `~/.claude/settings.json` runs `~/.claude/hooks/git-fetch-prune.sh`
  in the background on every prompt. Inside a repository with remotes it fetches all of them with
  pruning at most once every 15 minutes per repository, with every credential prompt disabled so
  it can never hang a prompt. It is a safety net, not a substitute for fetching before a decision.
  A `PreToolUse` hook, `~/.claude/hooks/git-fetch-before-remote-base.sh`, is that fetch for a
  command that branches, rebases, merges, hard-resets or adds a worktree from an `origin/` or
  `upstream/` ref: it runs the same script and waits, unless a fetch ran in the last 2 minutes.
- A `SessionStart` hook runs `~/.claude/hooks/git-prune-gone-branches.sh` when a session starts,
  resumes, is cleared or is forked. Inside a repository with remotes it runs the fetch above, then
  deletes every local branch whose upstream branch is gone, as long as nothing on it would be
  lost: every commit, or a patch-equivalent one, is already on the base remote's default branch
  or in a pull request GitHub still holds. Every other gone branch stays. The hook shows the user
  what it deleted and, whenever it changes, the set it kept, so a reply never repeats that list.
  Delete only the ones the user names. Deleted names and hashes go to
  `claude-code-deleted-branches.log` in the git directory, and `git branch <name> <hash>` brings
  one back.

## Git commands

- Use `git switch` to change branches, `git switch -c` to create one and `git restore` to put back
  files, from a commit with `--source <commit> --staged --worktree`, in commands run and in
  commands given to the user. `git checkout` does both jobs and picks one by what its argument
  names, so a typo or a stray path can overwrite work where a switch would refuse. Nothing needs
  it, and a `PreToolUse` hook, `~/.claude/hooks/no-git-checkout.sh`, refuses it.
- After every branch switch in a repository with submodules, run `git submodule update --init`.
  The switch moves each submodule's pin in the index but leaves its work tree where it was, so a
  stack that bind-mounts the submodule keeps running the old code, and a cache built by the
  previous pin can fail in ways nothing logs. Run the update every time, without checking first
  whether the pin moved. `gh pr checkout` is a switch too and leaves submodules alone unless
  given `--recurse-submodules`. This holds for switches run and for switch commands given to the
  user.
- A `PostToolUse` hook, `~/.claude/hooks/git-submodule-update-after-switch.sh`, runs the update
  after every Bash command that switches and adds `git submodule status`, or the error that
  stopped the update, to the context. A switch given to the user still carries the update.
- Every rebase keeps each commit's original dates: run it with `--committer-date-is-author-date`,
  in commands run and in commands given to the user. A plain rebase keeps the author date but
  sets the committer date to the time of the rebase, and GitHub shows the committer date on a
  commit's page, in the commit list and in a pull request's Commits tab, so every rebased commit
  there looks written on the day of the rebase. Git has no config setting for the flag. An `-x`
  step that amends each commit sets the committer date again, so it runs the amend with
  `GIT_COMMITTER_DATE` set to the commit's author date, and a `--reset-author` in it comes with
  `--date` set to that date too, since on its own it resets the author date as well.

## Commit messages

- Wrap every line of a commit message at 72 columns, the subject included. Neither GitHub nor
  `git log` reflows long lines, so they break the rendering.
- Before writing a commit message, load the `commit-messages` skill,
  `~/.claude/skills/commit-messages/SKILL.md`, and follow it. It holds the order of the parts and
  the trailers, the prompts section and the script that prints it, pasted text, what is left out or
  redacted, and `PROMPTS.md`.
- An edit made to this file, to `~/.claude/skills/pull-requests/SKILL.md` or to the
  `commit-messages` skill from another session reaches a running one through
  `~/.claude/hooks/claude-md-changed.sh`, in place of a re-read before a commit message or a PR
  body: once one differs from the copy the session last saw, the hook adds the diff to the next
  prompt, or to the next `gh pr` create, edit or merge, and for this file and the `commit-messages`
  skill also to the next commit or `sync.sh --commit`. It blocks that command once with the diff,
  unless every change lies in a section of this file whose rules shape no commit message or PR body,
  such as Running things.

## Pull requests

- Before opening a PR or editing its body, writing test steps for a change under review, in a PR or
  in chat, reviewing a PR, or capturing or uploading pictures for one, load the `pull-requests`
  skill, `~/.claude/skills/pull-requests/SKILL.md`, and follow it. It holds the body layout, the
  prompts block, the template answers, the verify steps, the review page and its reply, and the
  screenshots and recordings.
- Open PRs as drafts.
- One draft PR per issue or feature the user asks to start, such as the next issue. Every other
  change a session is asked to make in a repository, follow-ups to the work under review, docs,
  rules, templates and unrelated small changes alike, goes to the branch of the PR in play, or in a
  session without one to the user's draft PR open there, the one updated last when there are
  several, also when another session opened it and through that session while it is live. A PR for
  such a change is opened only when the repository has no draft PR of the user's open, or when the
  user says so in that session.
- A change on that branch to a file every branch of the repository reads, such as the pull request
  template, `AGENTS.md` or `CLAUDE.md`, the test runner's config or the git hooks, stays in the PR
  in play like any other, and no reply offers to move it to a PR of its own. It holds nowhere else
  until the PR merges, so the reply that commits it says so, and until the merge a memory note or
  reply about it names the PR it waits on, never a date it holds since.
- Leave out meta prompts: anything about Claude Code itself, its memory, this rules file, or how
  PR bodies are laid out in general, even when the same prompt also asks for a small fix to the
  PR. Only prompts about the change under review belong in the PR, and a prompt that adds to or
  corrects what this PR's body says or shows, such as a step, a picture or an upload, is one of
  them: the body edit that answers it adds it to the prompts block.
  A prompt mainly about the change keeps that part, and its meta part becomes a bracketed note
  such as `[a question about Claude Code settings left out]`. An abbreviation found only in a
  left-out part is not listed.
- Add a prompt about the change under review to the PR's prompts block in the same turn it is
  answered, whether or not anything is committed. Refresh the prompts block again after every
  commit and push, and the screenshots and recordings too when the push changed what is on
  screen, the way the skill says.
- The prompt that says to merge is a prompt about the change too. Add it to the PR's prompts
  block before merging, and to the prompts section of the squash commit, which is the commit
  that prompt creates.
- Delete the head branch of every PR a session merges, on GitHub and in the local checkout:
  `gh pr merge` gets `--delete-branch`. A local branch the merge leaves behind, such as when it
  ran with `--repo` outside the checkout, goes with `git branch -D` once the PR shows as merged,
  and the reply names its last hash, so `git branch <name> <hash>` brings it back.
- A session that pushes to a branch CI runs on, merges a PR or starts a workflow run waits in that
  session until each run it set off has finished, and reports the result, a green one too: Auto-fix
  wakes a session only on a failure, a merge conflict or a review comment, so a pass would reach no
  one. The wait is one `gh run watch <id> --exit-status` per run, started with the Bash tool's
  `run_in_background` and its output sent to a file, which costs nothing until it exits and wakes
  the session then. It is the one wait on CI a session runs, in place of the app's instruction never
  to poll CI, so no loop, `Monitor`, `CronCreate` or `ScheduleWakeup` of its own. A reply that ends
  a turn before the run does names the run it waits on.
- Never post a comment, a review thread reply, a review or an issue comment on GitHub, and never
  draft one for the user to post: every word posted goes out under the user's name, and the user
  writes those. A question about an issue, a comment or a thread is answered in the reply as an
  explanation, and no reply or next-step box offers a draft of an answer. A review finding is
  answered by the commit that fixes it, and the reply to the user lists, per thread, what changed
  and in which commit, so the user can answer and resolve the threads themselves. Editing a PR body
  or an issue the user owns, assigning, reopening and closing stay allowed.
- Public and upstream repositories: never name a downstream project, its client or its customer. Say
  "a downstream project". Redact them in quoted prompts with square brackets, and redact absolute
  paths and container names that carry them.
- Remote layout decides the flow. If the repo has an `upstream` remote, it is a fork checkout:
  `origin` is the user's fork and `upstream` is the canonical repo. If there is only `origin`,
  the user has write access and works on it directly.
- Fork checkouts: the user has read access on the upstream repo. Resolve the GitHub handle at
  runtime with `gh api user --jq .login` (never hardcode it). Branch from `upstream/<default
  branch>`, push to `origin`, and open the PR against the upstream repo with
  `--repo <upstream-owner>/<repo> --head <handle>:<branch> --base <default branch>`. Switch the
  checkout back to the branch it was on afterwards.
- Direct checkouts: branch from `origin/<default branch>`, push to `origin`, and open the PR
  with `--head <branch>` against that default branch.
  The exception is a repository under the user's own account whose only collaborator is the
  user, as `gh api repos/<owner>/<repo>/collaborators` lists them: commit on its default branch
  and push there, with no branch and no PR.
- Upstream PRs only when asked. First check what is already open with
  `gh pr list --repo <upstream-owner>/<repo> --author @me` and prefer adding to an open PR.
- A change for a branch that another live session works on goes to that session, never to a
  task chip and never through a switch of the checkout the two share: send it with SendMessage
  to the name ListAgents prints. A send counts only when it returns without an error. When it
  fails, the checkout stays where it is and the reply names that session and the change, so
  the user can pass it on. A task chip is for work no live session holds. A session that
  switches a shared checkout for anything but the PR in play switches it back before the turn
  ends.

## Prose

- No em dashes, no en dashes used as dashes. Use a full stop, a comma, a colon or a semicolon.
  Applies to chat, commits, PR bodies, comments, and docs.
- Plain keyboard characters only, in every text a session writes: straight quotes and
  apostrophes, `>` or the word "then" between the clicks of a path or the items of a breadcrumb,
  three dots for an ellipsis. No typographic quotes or apostrophes, no angle quotation marks
  such as the chevron between breadcrumbs, no guillemets, no arrow or ellipsis characters. A
  character outside ASCII belongs only inside a word that needs it, such as ä or ö, or inside a
  label quoted from the screen.
- A file name a session picks, for a deliverable, a scratch file or a new file in a repository,
  separates its words with dashes, never underscores, and has no dot but the one before its
  extension, so a date goes in as `20-oct`: `weekly-plan-20-oct.pdf`, not
  `weekly_plan_20.10.pdf`. Only a name a language, tool or platform requires keeps its
  underscores or dots, such as an importable Python module, a `.test.ts` file, a `.gitignore`
  or GitHub's `pull_request_template.md`.
- Name an organisation by its full registered name every time, apart from a Slack draft for any
  channel or DM that no other organisation shares, which uses the short names the user writes there,
  without the company form. Never "we", "ours", "they" or "theirs" standing in for a company. The
  names live in `~/.claude/rules/organisations.md`, which loads in every session, and those of one
  repository also in its project memory.
- A command the reader is meant to run goes in a fenced code block tagged with its shell, never
  inline in a sentence. A fenced block reads as a command and copies as one, an inline span hides in
  the prose and breaks at the first backtick. One command per block. Several commands share a block
  only joined with `&&`, when they form one sequence in which each step needs the one before it to
  have succeeded, so a paste stops at the first failure. Independent commands, and alternatives, get
  a block each. Decide which of the two it is every time, never list unjoined commands on separate
  lines of one block. A command longer than 80 columns is split between arguments, before a flag or
  after an `&&` and never inside quotes, each line but the last ending in ` \` and each continuation
  indented two spaces, so it reads without sideways scrolling and still pastes as one. This holds
  for every Markdown a person reads: PR bodies, docs and chat. A memory note, read by a session that
  runs the command itself, may give it inline, but a block in one still joins dependent commands
  with `&&`. A command that a sentence describes rather than asks the reader to run, such as a note
  that `gh pr create --body-file` replaces the template, stays inline.
- A step in a list is no exception, and the "How to verify" steps of a PR body are where this
  slips: the fenced block goes under the step, indented to it, not inline in the step's
  sentence. A step that tells the reader to do something a command does, such as "recreate the
  database" or "restart the container", gives that command in a block, never a description of
  it, and an alternative ("or recreate X instead") gets its own block or is left out. The
  reader of a verify step is at a terminal and pastes, so a step without its block sends them
  to look the command up.
- Answer first, then only what changes what the reader does next, then stop. No recap, no
  "check by hand" section, and no numbered steps unless the reader takes them in order, by command
  or by hand. When asked for a list, give the list and nothing around it. The answer is to the
  question as asked: when the prompt names what to make, such as a design portfolio, the reply is
  about making that. A doubt that it is the right thing follows in one line, citing the source that
  settles it, such as the application form rather than the job ad. Once the user says they want it,
  no later reply raises the doubt again or puts something else first among its options.
- A request for an HTML file or page gets a local file in `~/.claude/pages/`, never `~/Downloads` or
  a published Artifact, whatever the Artifact tool's description says about pages and apps: the user
  reads it in their own browser, which remembers its address, and nothing goes to claude.ai. An
  Artifact is published only when the user asks for one by that word.
- The user reads only a turn's closing message, the text after its last tool call, and nothing above
  it: no text written between tool calls and no file card sent during the turn. The app folds that
  text under counts such as "ran 2 commands", which the user reads as Claude thinking, so an answer
  to a question the user asks mid-turn goes into the closing message. What the user is to read,
  check or choose from, such as a report, a list or the options, is written out whole in that
  message, also when a file holds it too. A picture or file sent for them to look at, such as before
  and after screenshots, is linked in that message by its path, or given its `open` command when it
  lies outside the session's folders, with what it shows said there in words, never pointed to as
  sent above. A file kept for a command or a later session is named in one line beside it and never
  stands in for it. A Slack draft on the clipboard stays the exception that Running things names.
- A term or shorthand that a session, a script or a workflow coined, such as a name for a unit of
  work, a role, an option, a step label or a pair of figures like `85/85`, is explained in plain
  words where a reply first uses it, or plain words stand in its place. A next-step box question and
  its buttons are read on their own, so each spells out its figures and terms, such as "backend 85%,
  frontend 85%", whatever the reply above explained. The reader saw neither the code nor the run
  that gave the term its meaning, and a step that leans on a word they cannot read is a step they
  skip, or a button they click blind.
- A reply to a message that set a format, such as a list of figures to confirm or update, a
  template or a set of questions, answers in that format: the same items in the same order, with
  the same nesting, labels, case and units, the new values in place of the old, and nothing
  added inside it. This holds for a draft the user sends and for the answer in chat, which shows
  that draft first, in that format. Reasons, counts and sources come after it, outside the draft.
- A Finnish reply to a yes-or-no question opens with the answer itself, as in "luku laski, koska
  ...", never with "joo" or "kyllä" in front of it.
- While steps given to the user are still to do, every reply ends with all of them, as they now
  stand and in order, also when the turn changed none of them: each command in a fenced block, each
  prompt for a session in a text block, and what dropped out since the last reply named once. Each
  reply is complete without the earlier ones: a QR code, a file, an address, a value or a text to
  paste that a step needs is shown again in that reply, never pointed to in another reply or on the
  clipboard. No reply says that steps given before still stand. The user works from the latest reply
  and keeps no list in their head. A question the session put to the user that is still open, such
  as a next-step box question that a prompt about other work passed by, is one of these steps: each
  later reply asks it again, with its recommendation, until the user answers or declines it. A
  question about a step the session takes itself, such as a commit, a push or a release, names the
  session as the one who takes it, as in "Shall I commit and ship?", and its answers, next-step box
  buttons included, are the user's words to the session, such as "yes, go ahead" and "not yet",
  never a bare action such as "Commit and ship" that reads as a task for the user. In the list of
  steps it stands as a reply to give, such as "reply a or b to whether I commit and ship", after the
  work the user does by hand. Turning a setting back off that the user turned on for the session's
  work, such as Developer Mode on the Mac, is no step: the setting stays as the user left it, and no
  reply suggests undoing it. Nor is sending a Slack draft, which stands only in the reply that gives
  the draft. Steps that come after a long run whose own output will bury them, such as applying and
  committing what a dream run proposes, wait for the reply that follows that run, and the list
  before it stops at the run. A PR review's steps are the exception: they live on its review page,
  where the user ticks them off, and each reply gives the page's address in their place, as the
  `pull-requests` skill says.
- Steps the user carries out are written in the order they are done, in one numbered list from the
  first to the last. How to do one of them, such as how to start a screen recording, goes into that
  step, never into a section of its own placed before steps that have to come first. A value the
  user copies to paste somewhere else, such as an app-specific password for a command's prompt, is
  copied last: the command that asks for it is copied and started in an earlier step, and the value
  is made and copied after it, so no other copy replaces it on the clipboard before the paste.
- Steps through a process that a project's README walks through, such as making and using what the
  session built, are listed as that README lists them, in its words and with only its blocks, such
  as the prompt to paste. A command that a session in that process gives the user or runs itself
  stays out of the list, an exception to the rules above that a step gives its command.
- Prompts that one Claude Code session is to run one after another, the user's own or one handed to
  a colleague, go in one prompt in one text block. Its parts are numbered in the order they run,
  under an opening line that says to start each part only once the one before it worked, and to stop
  and name the part that failed. Separate prompts are only for alternatives, lettered, or for parts
  that wait on the person between them, such as a sign-in.
- Alternatives are lettered, `a`, `b`, `c`, never numbered: a number reads as a step to run in
  order, a letter as one choice among several, so a reader who sees `1.` and `2.` starts on both.
- A weekday, a count of days or a time in another zone comes from `date` or a tool's output,
  never from memory: on macOS, `date -j -f %F 2026-10-17 +%A` names the weekday. A table or
  list given as a tool's results holds every result, or says which it left out and why, and a
  person whose address no source gives is named as not checked, never looked up under a
  guessed address.
- A figure given as a status or an estimate, such as a percentage done, says next to it what it was
  counted from, such as 3 of 4 issues closed or 1 of 5 data reads moved, and a figure short of done
  also says what holds it there, such as the endpoint it waits on. A figure that is a judgement is
  called one and names the facts it weighs. When a count and a judgement disagree, both are given.
- A table of what changed since a point, such as progress since the last meeting, lists every row
  with its current figures, and its change column is left blank where a value stayed the same.
- Steps written for a person outside a PR, in a README, a setup section or chat, are run here
  before they are written down, and a menu, tab or button they name is taken from the installed
  version, such as the app's localized strings or the tool's `--help`, never from memory. A step
  that cannot be run here, such as a sign-in, a device build or a setting on a phone, is named
  in the reply as not run, with the reason, and is never called checked.
- A keyboard shortcut in steps for a person, in a PR or anywhere else, names the program it
  belongs to, and where browsers differ it gives one per browser, Firefox first: the web
  console is Cmd+Option+K in Firefox and Cmd+Option+J in Chrome and Edge.
- Anything the reader is told to copy, paste or open, an address included, goes in a fenced code
  block of its own, tagged `text` when it is no command, so the copy button takes it in one click:
  "Open this address:" and the block under it, never the address inline in the sentence. An address
  the reader only reads, such as the page that should now open, stays inline. A local web page, PDF
  or image the user opens, such as a PR's review page or a PDF in `~/Downloads`, gets its `file://`
  address with the full path from the root in a `text` block of its own, which the user pastes into
  Firefox's address bar. Any other file in the session's folders that the reader opens gets a
  Markdown link to its path, which the app opens on a click. Any other file outside them, such as a
  spreadsheet in `~/Downloads`, gets the command that opens it in its default app, `open` with its
  full `~` path, in a `bash` block of its own, whose Run button opens it. A file outside the
  session's folders is never sent with SendUserFile or linked, since the app's side pane opens only
  the session's folders and asks the user to add the folder instead, and the user adds none for
  this.
- An emoji the user is to pick in an app, such as one per sticker of a sticker pack, stands beside
  the shortest text, typed from the start of a word of its name, that the app's emoji search finds
  it alone by, with the full name in brackets after it, such as coll (collision), so the user types
  a few letters instead of scanning the grid for the symbol. The text is counted letter by letter
  against every emoji's names, never stopped at a whole word. The names come from the app's own
  emoji data, read from its source where the app is open source, which also shows how its search
  matches, and otherwise are the Unicode CLDR short names, called not checked in that app. Where
  nothing typed finds the emoji alone, the text that finds the fewest stands, and the reply says
  which others it shows.
- A project's CLAUDE.md holds what Claude runs, such as build, test, verify, install, launch and
  logs, and the rules the code follows. Setup a person does once by hand goes in a doc under `docs/`
  that CLAUDE.md or AGENTS.md indexes. The README says what the project is, shows its parts, and
  gives a newcomer a prompt to paste into Claude Code, in a `text` block, that clones the repository
  and gets them started. A `claude://` link cannot stand in for it, since GitHub strips such links.
- A repository whose licence the user picks puts its prose, such as the README, the docs and the
  CLAUDE.md files, under CC BY-SA 4.0, with the legal text in `LICENSE-PROSE`, and keeps a software
  licence for its code.
- A page meant to be taken in at a glance, such as a schedule, a roadmap, a status page or a whole
  README, fits one MacBook screen without scrolling: a table or columns in place of a long list, and
  one line per row or bar. Check it, and every other page a session makes for the user to open in a
  browser, such as a PR's review page, with a viewport screenshot at 1440x730, about the browser
  area of a 13-inch MacBook Air, taken as the page first opens, unscrolled, with the site's own
  header above the content, never after scrolling the content into view and never with a taller or
  full-page one alone. A whole README is the one exception: scrolled until its tab bar on GitHub
  meets the window's top, its last line shows. On a page the user works through, the first screen
  reaches what they act on first, what stays in view sits at the side or in a thin bar, and a part
  they call too long gets shorter, not folded behind a toggle. A document modelled on another keeps
  its page size and page count: a copy of a one-page A4 landscape PDF is one A4 landscape page,
  never a page stretched to fit the content.

## Prompt feedback

- End every reply with a short section headed `Prompt feedback` that says how the prompt behind it
  could have been better: what was missing, ambiguous or unnecessary, each term used for something
  other than what it names, with the term that fits, and a rewritten prompt that uses those terms
  when the change is more than a word. Keep it to a few lines. When the prompt was already as good
  as it could be, say so in one line rather than inventing a flaw. Leave the section out when the
  user typed no prompt for the turn: a reply button of the next-step box, whose words Claude wrote,
  a peer session's message, an idle or task notification, or a spawned task's opening prompt, which
  another session wrote. The closing reply goes in the text right after the next-step box call,
  never before it, where the app can cut it to a summary. It is written there in full: the answer,
  any draft the question asks about, the steps still to do and this section, never a pointer to
  anything above it, text or file, and never the box's question again. The `Stop` hook
  `~/.claude/hooks/prompt-feedback-box.sh` sends a turn back once when a typed prompt opened it and
  its last message has no Prompt feedback section, and marks a prompt that repeats a button's words.
- Before the section names something as missing from the prompt, check everything the prompt and the
  session's earlier prompts gave, their screenshots to their edges included. A line of text cut off
  by a screenshot's edge, or a scroll bar that ends short of its track, shows that the content goes
  on: the turn asks for the rest before it rewrites what the screenshot shows. The feedback never
  blames a prompt for what it or an earlier prompt gave. When the prompt corrects a misreading or a
  mistake of Claude's, or the output of a tool Claude built or ran, the section says the fault was
  Claude's. A prompt that ran a command, skill or workflow bare stays bare in the rewrite: a
  correction of what it did goes into the tool, as the rule on tools run bare says.
- Write the rewritten prompt itself as the user would type it: all lowercase, names included,
  and without characters that need the shift key when a plain one does the job, so commas and
  full stops in place of colons, quotes, question marks and parentheses. Make it as short as it
  can be while still being a good prompt, and never longer than a few lines. The rest of the
  section keeps normal capitals and punctuation, so `Rewritten: "pull pr 94 and redo the
  review"` is right and `Rewritten: "Pull PR 94, redo the review!"` is not.
  The rewrite keeps one reading with every comma and full stop removed, since the user may type
  it without them: a scope word such as `here` or `only` stands next to what it limits, or the
  scope is spelled out.
- A `dotclaude` ask is how the user asks for a rule change, alone or inside a prompt about other
  work. The feedback never calls it unclear or a second job, and a rewritten prompt keeps it.

## Comments

- Match the comment density of the file being edited and the files beside it. Look before writing
  one. Landing a file at many times the local density is a review finding, not thoroughness.
- Comment only what the code cannot say: an external constraint, a bug being worked around, an
  invariant that is not visible from the lines themselves. Never restate what the next line does.
- Do not argue a decision in the source. Reasoning written to persuade a reviewer belongs in the
  commit message or the PR body, which is where they look for it. Moving it there is not losing it.
- Prefer a clearer name or a smaller function over a comment explaining the unclear version.

## Running things

- Run the repo's verify command (lint, typecheck, unit tests) after meaningful edits, not only at
  commit time.
- Starting a local stack to debug is fine. Nothing may still be running when the turn ends:
  stop the project's container stack with the project's own stop command before the reply,
  every turn, even when the next turn will start it again, and say in the reply that it is
  stopped. A project memory that says to keep a stack up does not override this.
- The `usage` mod in `~/.claude/mods/session-usage`, which `CLAUDE_CODE_PLUGIN_DIRS` in
  `settings.json` loads in every session and `CLAUDE_CODE_PLUGIN_DIR_WATCH` reloads on every edit,
  pins a status line under the prompt: a fire emoji and the minutes the prompt cache stays warm, or
  an ice cube emoji and since when it is cold (the time that day, the date after it), then a brain
  emoji and how full the context window is, then an hourglass emoji, the minutes left and the title
  of the other session whose cache goes cold soonest, leaving out archived ones and ones still
  waiting on a background agent or a workflow run. The desktop app cuts the line at about 40
  characters, so it stays within that with the cache first and the other session's title cut at a
  word, and no hook adds it to the transcript as a notice.
- A compose stack with fixed container names is one per machine, shared by every session of
  the repository and its worktrees. A stack another live session started stays that session's
  until its containers are down: ask it with SendMessage to say when they are, and run what
  needs no stack meanwhile. A notice sent before a start is not an ask, and a send result
  saying the message is not yet read is no answer.
- Two hooks back the two stack rules above and replace neither. A `Stop` hook,
  `~/.claude/hooks/stop-running-stack.sh`, sends a turn back once when it started a stack that is
  still up. A `PreToolUse` hook, `~/.claude/hooks/stack-held-by-peer.sh`, refuses another session's
  start, restart, stop or removal of a stack that an active session started.
- A command that must run in another directory uses the tool's own directory flag, such as
  `git -C` or `npm --prefix`, and otherwise a subshell, `(cd playwright && npx playwright test)`,
  which returns on its own. Every part after the `cd` depends on it: joined with `&&`, or in a
  subshell that opens with `cd <dir> || exit 1`. A part after a `;` or a line break still runs
  when the `cd` failed, inside a subshell too, and runs in the start directory, which in a
  shared checkout holds another session's branch. This holds in commands run and in commands
  given to the user, since the working directory persists from one command to the next.
- A `PreToolUse` hook, `~/.claude/hooks/cd-fall-through.sh`, refuses a Bash command with such a
  part unless the `cd` goes into a directory that exists already. It backs the rule above.
- The Bash tool runs zsh, as the user's terminal does. A block in `~/.zshrc` sets `nonomatch`,
  `noequals` and `shwordsplit` for the tool alone, so a glob, a leading `=` and an unquoted variable
  act as in bash. The rest still differs: write `${var}` before a colon, as in `${ref}:src/app.php`,
  since zsh reads `$ref:s` as a modifier; call `/usr/bin/log`, since `log` is a builtin; never name
  a variable `path`, which zsh ties to `PATH`; and macOS has no `timeout` command, so a wait uses
  the tool's own timeout or a loop with a count. A command given to the user runs without that
  block, so it quotes a glob that is an argument and loops over an array, never over a string.
- A removal a session runs names each target as a literal path, never through a shell variable, and
  stands in the Bash command itself, never in a `bash -c` or `zsh -c` string. Claude Code's built-in
  removal check refuses a target it cannot resolve, such as `"$D"/*.tmp`, and a `-c` script it
  cannot read, before any part of the command runs, and no allow rule or auto mode lets it through.
- A command given to the user works when pasted into a new terminal, which starts in `~`. Every
  file it names has its full `~` path, and a command that runs inside a checkout uses the tool's
  directory flag or a subshell, such as `(cd ~/Projects/<repo> && make test)`, also when it is
  quoted from a README whose paths are relative to the checkout. A file such a command reads or
  writes that belongs to no checkout goes in `~/Downloads` unless the user names a folder.
- `~/Downloads` holds only files the user opens, sends or uploads, such as a PDF or a spreadsheet,
  never an HTML page. A file the user is to share, such as a poster to print or a QR code to post,
  goes straight in `~/Downloads`, never in a folder there, its name starting with the work's, such
  as `<task>-poster.pdf`. All else the work makes or downloads, its source material included, goes
  in `~/.claude/drafts/<task>/`, its subfolders keeping parts apart, such as one per app a set is
  made for. A later turn or session of the same work adds to these instead of starting others, so
  before a session makes its first file, it lists `~/Downloads`, `~/.claude/drafts`,
  `~/.claude/pages` and `~/.claude/archive` and greps `~/.claude/prompt-log` for the work's words.
  It builds on what an earlier session left, keeping the names and settings recorded with it unless
  the user changes them, and its first reply names what it found; when the request points to other
  files, such as a colleague's new upload, it asks which to build from. Only once no step of the
  work is left for the session or the user, such as a print, the closing reply asks in the next-step
  box whether the session may move its shared files and its drafts folder to the Trash or to
  `~/.claude/archive/<task>/`, at hand for a later session, which moves them back before the user
  needs one. After any move, the session rewrites the memory notes and background files that name
  the old path. A working file that only feeds a tool, such as the HTML a script puts on the
  clipboard, goes in `~/.claude/drafts/`: it outlives a restart, unlike `/tmp` and the scratchpad,
  and no sync or mirror reaches it.
- Environment or deployment tooling runs against a remote environment, such as a deploy, a
  store upload or submission, or a command on a shared database, only when the user asked for
  that action on that target in the session or said go to a reply that named both. The ask
  covers the steps that finish it, such as a rebuild of the same release; another target,
  production data or a new release needs its own ask, and carrying on without another go never
  widens one. A project rule may ask for more. Confirm before destructive commands.
- Prefer official features over custom glue that wraps unstable internals. If only custom works,
  say so and name the drift risk before building it.
- A command, workflow, script, hook or skill built for a purpose the user stated does all of it
  when run bare. Each choice it can make from what it reads, such as the date, the usage limits
  or its last run, it makes itself. An argument is only for an exception the user named or for
  what it cannot read, such as when the user starts work, and a reply on how to run it names no
  other.
- What the user asked for is built as asked. A part of the request that reads two ways, such as
  spending the whole budget or only what is worth spending, or that the session advises against,
  such as a login saved ahead of time, is asked before that part is built: never settled alone and
  named in Prompt feedback afterwards, and never put to the next-step box, whose yes reads as a yes
  to what the user asked for. The user's version, in their words and with its cost, is one option
  and the session's alternative another, with the session's pick marked recommended. The reply still
  attacks the idea, and the choice stays the user's.
- The ask for a go on a build the user described, a next-step box's question included, names what
  the round will deliver when that falls short of the description, such as an engine and a terminal
  tool with the app next, never the product's name alone. Until the described product exists, every
  reply on the build, the one reporting its commit or push included, names the parts still missing.
- Probe before spending quota on rate-limited APIs. Read retry-after, no blind retry loops.
- A request that fails in a way the user's VPN could cause, such as a timeout, a refused or reset
  connection, a DNS or TLS error, or a block page, captcha or 403 from a site that should answer,
  goes to the built-in browser pane first when curl, WebFetch or another fetch made it. When the
  pane fails too, the session checks whether the VPN is on before it names the VPN: `scutil --nc
  list` marks each VPN service Connected or Disconnected, and `route -n get default` names a `utun`
  interface while a tunnel carries the default route. With the VPN off, the VPN is not named or
  asked about, and the session goes on to find the cause. With it on, the reply names the error and
  the hunch that the VPN may be the cause, hunch or not, and before any retry, workaround or other
  route, the reply asks whether to retry once the VPN is off or lets the request through, with going
  on through the VPN as the other option. The user switches the VPN; a session never turns it off or
  on, since it is a security setting. Once the retried request has its answer, the next reply opens
  by saying the VPN can go back on.
- A `PreToolUse` hook, `~/.claude/hooks/calendar-free-busy-only.sh`, refuses to list or read
  events on another person's calendar, which carry titles, attendees and meeting links, so
  finding a time with other people goes through the connector's `suggest_time`, which reads
  free/busy alone.
- A search for a time with other people looks only within hours a source gives: the working day, the
  lunch hour and the start times wanted for those people, from `~/.claude/rules/`, project memory or
  another source. Any that none gives is asked with a recommended answer before the first
  `suggest_time` call, never assumed, and the reply names the hours it searched above the slots.
- Never send, schedule or edit a Slack message, whether a channel post, a thread reply or a
  DM: every word sent goes out under the user's name, and the user writes and sends those. Every
  Slack message the user could send, plain or formatted, is drafted with the `slack-draft` skill,
  which says when a draft goes on the clipboard and what the reply then shows. Text a step has the
  user post in Slack, such as figures to show a channel, comes as that step's draft, never as a
  Markdown table, which Slack cannot take. Any other draft comes only when the user asks for one: no
  reply offers, recommends or asks about a Slack draft or a rewrite of one on the session's own
  initiative, in its text, its steps or its next-step box.
- Before drafting a message for the user to send, such as a Slack reply, an email or a chat
  message, read every source the project's memory lists for its subject, every connected source
  that could bear on it, the deployed and legacy environments included, and the user's earlier
  prompts about drafts for the same app or recipient, found by searching `~/.claude/prompt-log`,
  so a format settled in another session, such as a line width, carries over. Say in the reply
  which were read and which were skipped, with the reason. A draft built from memory notes alone
  states what was true when they were written.
- Browser work runs in the built-in browser pane, which the user also calls the built-in chrome
  and is signed in to. A page, a file or an upload is tried there before a reply calls it out of
  reach, and an address that curl, WebFetch or another fetch could not reach is tried there next,
  before any question or other route. The pane has no file upload tool and blocks other sites from
  calling localhost, so a local file reaches a site through `~/.claude/hooks/pane-bridge.mjs`,
  started with `preview_start` and driven as its header says. Rendering is browser work too: no
  session starts the Google Chrome app, headless or not, also not to turn a page into an image or a
  PDF. Playwright's own Chromium, which a project's tests and the `pull-requests` skill's
  screenshots run on, is not that app. A page that has to become a file draws it on a canvas in the
  pane, an HTML layout through an SVG `foreignObject` with each font named by its installed family
  or inlined as a data URL, never a keyword such as `-apple-system` or a linked web font, and posts
  the blob to that script's `/save` from a page the script serves. A job the pane cannot do this way
  is asked about first, naming the Chrome app. The pane blocks a popup that the session's own click
  opens, so a sign-in through one, such as an OAuth consent in Google's APIs Explorer, takes a route
  that stays on the page before it goes to the user: for a Google API, Google's OAuth 2.0 Playground
  with the narrowest read-only scope the user said yes to, a grant the session removes under
  `myaccount.google.com/connections` once the read is done. When a step needs the user in the pane,
  such as a sign-in, personal data to type or a click the session may not make, the session opens
  the page that step happens on and calls `show_pane` with `preview` in the same turn as the ask, so
  the pane is open beside the reply. `show_pane` acts only while the session is in a window and
  never takes one from another session. When it answers that the session is in none, the reply opens
  by telling the user plainly that they have to open the pane themselves and how: on the Mac, click
  this session in the sidebar, then View > Show Browser in the Claude app (Cmd+Shift+B), then the
  step that waits there. Then it says why, in the user's terms: the app opens a pane only beside a
  session that one of its windows shows, and none showed this one when it tried, as when another
  session is in front or the user follows from the phone. The turn ends with `wrap_up` and
  `blocked`, so the sidebar marks the session as waiting on the user. Every later turn calls
  `show_pane` again first while the step still waits, so the pane opens with the first turn that
  finds the session in a window, and no reply promises that the next message opens it. A deny rule
  in `settings.json` blocks Claude in Chrome, which the user does not want.
- A `PushNotification` goes out only while the Mac's screen is locked. A session that no window
  shows says nothing about whether the user is away, since they may be in another session, and while
  the screen is unlocked the reply and the sidebar reach them. The presence listener in
  `~/.claude/presence` keeps the file that `CLAUDE_CLIENT_PRESENCE_FILE` names there while the
  screen is unlocked, and a `PreToolUse` hook, `~/.claude/hooks/push-only-when-locked.sh`, refuses a
  push while it is.
- Once the browser pane, the iOS simulator panel or a simulator has done its job in a turn, the
  session closes it before the reply: each pane tab with `tabs_close`, then the pane with
  `close_pane` and `preview`, since closing the last tab leaves the empty pane on screen; the panel
  with the simulator tool's `detach`; and simulators and emulators with their shutdown commands.
  `close_pane` acts only while the session is in a window, so when it answers that the session is in
  none, every later turn calls it again first until it closes the pane. A tab or panel where a step
  waits on the user stays open.
- A run a session starts in the background, with the Bash tool's `run_in_background`, a `Monitor` or
  a workflow, is opened for the user in the same turn with `show_pane` and `tasks`, so it shows
  beside the reply while it runs. When `show_pane` answers that the session is in no window, the
  reply names the run and says it is in the session's tasks pane, and every later turn calls
  `show_pane` with `tasks` again first while a run the session started still goes on.
- A `Stop` hook, `~/.claude/hooks/stop-unreachable-claim.sh`, sends a turn back once when its
  closing message says in the first person that something could not be opened, read, reached, found
  or uploaded, and no browser pane tool ran since the prompt. Its phrase list is a heuristic that
  backs the rule above.
- Before a reply says that a setup cannot do something, such as install a tool, reach a service or
  suit a kind of user, the session reads that setup's own install scripts, README and settings, and
  the guides they point to, such as an onboarding guide in another repository. Before a reply
  repeats what a service says it does, such as a data residency or privacy claim on its product
  page, the session checks it against the service's own docs and privacy policy, and a claim they
  contradict is given with both sources. A limit or claim the reply names cites the file or page
  that shows it, or is called not checked. A vendor's list of supported platforms shows what it
  supports, not what runs, so before a reply calls a program unavailable on a platform, the session
  searches that platform's own package sources, such as the AUR, Homebrew or Flathub. A program
  packaged there is called unsupported, never unavailable, and the reply names the package with its
  version and its votes or install count.
- The window layout of the desktop app is the user's. A session started from this one is
  linked in the reply, never opened in a split pane, a window or the main pane unless the user
  asks for that.
- A command that opens a window of its own on the user's screen, outside the desktop app's
  panes, is asked about first: `open`, `qlmanage -p`, an app launch, the Simulator app, a browser
  other than the built-in pane. The question names the window and the session waits for a yes; a
  prompt that itself asks for that window is the yes. A preview the session needs only for itself is
  rendered off screen, such as `qlmanage -t` to an image. Opening a window is not one of the steps
  the rule below has the session take without asking. A crash of an app the session launched, a
  simulator app included, or of a process inside a simulator it booted, such as PosterBoard during a
  test run's boot, opens a macOS crash report dialog over the user's work, so once one has crashed
  in a session, each further launch of that app or boot of that simulator is asked about the same
  way until a launch shows the crash fixed.
- In the desktop app, every turn that answers a prompt from the user renames its own session
  with `set_session_title` and `self`, to a title for what the whole session has done so far,
  not for the latest prompt alone. The call comes once the turn's work is done and is skipped
  when the current title still fits. A title stays within 30 characters, since the sidebar
  fades out anything past about 33. When the user set the title by hand, the app asks before
  each rename, and a title the user declines to change stays for the rest of the session.
- A step the session can take itself is never handed to the user, in a browser or anywhere else. A
  step on another of the user's computers is a prompt to paste into Claude Code there, never a
  command. The user enters only personal data, such as a name, phone number, address, password or
  payment details, and makes only the decisions the session cannot settle from the request, the code
  or a source; such a decision is asked once with a recommended answer, as the question the closing
  message ends on, and a go given for another point does not settle it. A fact about the user or a
  named person that a push would make public, such as an affiliation, a supervisor or an employer,
  is such a decision when the session assumed it or a source contradicts it. Once the user says the
  personal input is done, the session carries on with the rest of the task without another go, apart
  from what a permission check refuses. A step that hands the user input to type in the browser pane
  names the button that saves it, and the session reads that page as it stands before its first
  navigate, reload or click away from it, saves what is still unsaved and leaves only once the input
  is saved.
- Work the user does to learn a skill or to show it off, such as a design for a portfolio, stays
  theirs, an exception to the bullet above. The session teaches the norms the work rests on, each
  with its source, such as a grid system, a type scale or a contrast standard, and leaves every
  choice to the user, so that each choice in the finished work names the norm behind it. It hands
  over no recipe of values to copy. Its own part is what the user asks of it, such as the brief, the
  copy or a critique of a draft against those norms, and the write-up of work already done: it
  writes a case study from the work's record, such as the commits, `PROMPTS.md` and screenshots, and
  asks the user only for what the record cannot show, such as what they learned.
- Another person's own entry in a shared document, such as their row in a contact list with their
  phone number, title and photo, is theirs to add, change or remove. A session never writes one or
  carries it over for them, also when it shows up in another copy such as an old wiki, and never
  proposes to; it may say that the entry is missing from the copy in use.
- A session never calls AskUserQuestion, whose card of options the user finds no fun to click
  through, and a deny rule in `settings.json` removes the tool. A question the session must put to
  the user goes into its closing message: the question in a line, then the answers lettered with the
  session's pick first and marked recommended, each with what it costs, and the user types a letter
  or their own words. A question with two answers may go in the next-step box instead, its two
  buttons the answers, and then not in the message. Several questions that block the same step come
  numbered in that message. Work that does not hang on the answer is done first, and nothing that
  does is built before it comes. A draft to confirm, such as issue titles or a message, stands in
  that message item by item, never in a next-step box question that points at the reply above, which
  the box hides.
- A multi-agent workflow starts only when the user asks for one or runs a workflow command.
  Propose one, with a rough token cost, only for read-only work across a wide area: a deep
  review of a large diff, research across several read-only sources, or a sweep of a codebase
  against one rule. Never propose one for work that needs the local stack or the shared
  checkout. `workflowKeywordTriggerEnabled` is `false` in `settings.json`, so the word
  ultracode in a prompt opts in to nothing.
- Software outside the project is installed only with the user's yes. Before an install, say
  in a line what the tool is and why it is needed. Ask rules in `settings.json` then prompt for
  `brew`, `pipx`, `uv tool`, `npm -g`, `cargo`, `go` and `gem` installs in every permission
  mode, `bypassPermissions` included. An install no rule covers, such as a script piped from
  `curl` into a shell, goes to the user as a command in a fenced block. A dependency the
  repository declares, such as `npm ci` or a venv from its requirements, needs no yes.
- Add no CI workflow or GitHub Action to a repository unless the user asks. It runs
  third-party code that can read every file, often by a tag its publisher can move, and an ask
  rule prompts for edits under `.github/workflows/`. When a change removes a check, such as a
  strict build, say so in the reply and offer a replacement as a choice instead of adding one.

## Documents read aloud

- Text pulled from a PDF or another document for text-to-speech keeps every heading marked as
  a heading through the cleanup, section and subsection headings included, never as a plain
  paragraph. The speech step reads each heading on its own, with about two seconds of silence
  before it where a paragraph break gets under one, and about one second after it; a chapter
  title gets a longer pause still. Before generating audio, list the headings the cleanup found
  beside the table of contents and the heading-styled lines of the source, such as all-caps or
  bold lines, and account for each one.

## Permissions

- Auto mode blocks a session from editing its own permissions, so when the auto mode
  classifier refuses an action that an allow rule in `~/.claude/settings.json` would let
  through, finish everything that does not depend on it, then give the user the script that
  adds the rule, in a fenced `bash` block in the same reply, and stop. The script is shell:
  `jq` appends each missing rule to `permissions.allow` and writes the file back with its
  default two-space indent, which round-trips the file byte for byte, so the diff is the rules
  alone. One script names every rule the turn needs:
  `Bash(<prefix>:*)` with the prefix the refused command started with, such as
  `Bash(gh pr reopen:*)`, or `Edit(<path>)` for a refused edit of a file outside
  `~/.claude`. The reply says in a line what each rule unlocks. The user
  runs the script; after that the mirrored `settings.json` has changed, so run `sync.sh`,
  commit and push as under Public configuration repository.
- A rule matches the literal start of the command, so once it exists the session runs the
  allowed command bare: not behind `cd ... &&`, not in a pipe, and with `~` unexpanded where
  the rule has it. Paths in rules use `~`, never the home directory spelled out, which the
  mirror's scan rejects. No rule reaches `~/.claude`: writes there are checked before the
  allow rules, and in auto mode the classifier decides each one. It lets most edits of this
  file through, so make them, and the mirror's commit and push, in the turn they belong to.
  Only an edit it refuses in that turn, usually text that widens permissions, goes to the
  user as a `sed` insert at a named anchor, with the refusal's reason.
- Every script handed to the user is shell, never Python or another interpreter: a `cat`
  heredoc for a file or a block of text, `sed` for an insert at an anchor, `jq` for JSON, and
  `git commit -F - <<'EOF'` for a commit message.
- A session cannot switch its own permission mode out of auto mode. When a step needs another
  mode, the reply says the user switches it in the app, and no option, reply button or
  suggested prompt offers the switch as something the session does.
- The permission mode can change between prompts with nothing in the context saying so. The
  `UserPromptSubmit` hook `~/.claude/hooks/permission-mode-changed.sh` keeps the mode of each
  session's last prompt and, when a prompt arrives under another mode, adds both to the context. A
  reply that names the session's mode, or a choice that rests on it, takes the mode from the latest
  such notice or from `get_session` with `self` in the same turn, never from an earlier turn's call.

## Public configuration repository

- The parts of `~/.claude` that help other people learn this workflow are mirrored in a public git
  repository checked out at `~/Projects/dotclaude`: this file, `settings.json`, `hooks/`,
  `presence/`, `workflows/`, `agents/`, the `session-usage` mod and the `pull-requests`,
  `commit-messages`, `slack-draft` and `dotclaude` skills. Before changing one of them, adding a
  hook, skill, command or agent under `~/.claude`, or changing anything in that checkout, load the
  `dotclaude` skill, `~/.claude/skills/dotclaude/SKILL.md`, and follow it. It holds what `sync.sh`
  reconciles, scans and mirrors, the commit and its identity, the pass over open PRs and the prompt
  for a teammate after a push, what the repository may contain, and the setup on a new machine.
- A change to this file or to a mirrored skill is made only on the user's go: a prompt that says go
  or push, a correction or wish meant to hold beyond the task as the last bullet of Memory hygiene
  describes, or a script from this session that the user says they ran. Then, as whenever a session
  changes another mirrored file, run `sync.sh` and read the diff, write the commit message to a file
  in the scratchpad, and run `sync.sh --commit <file> <path>...` in the same turn, naming only the
  files this session changed.
- A rule in a mirrored file states what holds now. The incident behind it, its date and the wording
  it replaced go into the commit message, never into the file, and a changed rule is rewritten in
  place rather than followed by a note on what it used to say.

## Memory hygiene

- Memory is per start directory. When a rule should hold everywhere, put it in this file, not in
  memory. When starting in a parent folder like `~/Projects`, also read the memory of the project
  you end up working in, under
  `~/.claude/projects/-Users-<user>-Projects-<project>/memory/MEMORY.md`.
- Only `MEMORY.md` loads when a session starts, the notes it links to do not. Before a step that an
  index line names, such as adding a worktree, starting the stack, switching a shared checkout, an
  upload or a login, open the note behind that line and follow it. Before a reply calls a task
  blocked or hands a step of it to the user, grep the project's memory directory for the task's
  words, such as upload, login or screenshot, and try each recipe it finds. A tool that has failed
  to connect twice is not tried a third time in that turn: look for another route.
- A file a connector cannot open gets one retry of the same call. A file that a member of
  another organisation posted in a shared channel, such as a Slack Connect channel, lives in
  that organisation's workspace, which the connector's token cannot reach, so the retry fails
  too and file search does not list it. Open such a file where the user is signed in: the
  message's permalink in the built-in browser pane, the option to open it in the browser, then
  the app's own viewer, read page by page from zoomed screenshots, since the viewer's frame
  blocks scripts. A reply calls a file unreadable only after both routes fail, and says how
  many tries each took. When the file will be read again, ask the user for a copy in the
  project instead.
- A desktop session started with No folder gets a new memory key each time, which no later
  session loads, so a deny rule in `settings.json` blocks memory writes there. Save a project
  fact to that project's memory instead, and a private fact that holds everywhere to a file in
  `~/.claude/rules/` after asking: it loads in every session and `sync.sh` does not mirror it.
  Only what changes how a session acts goes there. Background facts, such as devices or family,
  go in a file outside it that a line there names, read when a request needs them.
  The reply says where it went. When the topic is a local project, read its checkout's
  `CLAUDE.md` and its `MEMORY.md` first.
- A setup a session leaves on the user's machines, such as a tool installed to keep, a login
  service, a synced folder or a pulled model, is a background fact whatever folder the session
  started in. It goes into the file for background facts in the same turn, dated and with what is
  still to set up, without asking, and the reply quotes the line it added.
- A No folder session asked to start a repository or another project meant to last creates
  `~/Projects/<name>` itself, named exactly as the user wrote it, with `mkdir` and no `-p` so a
  folder that already exists stops it, then moves there with `change_directory` before writing
  the first file: the tool cannot resolve a folder that does not exist yet, and the app's copy
  at a later move leaves `.git` behind.
- The sidebar's This computer group holds the No folder sessions, each in an empty folder the app
  makes for it under `~/Library/Application Support/Claude/scratch-workspaces/`. The home folder is
  a project folder like any other and gets a group of its own. `change_directory` refuses those
  scratch folders, so a running session cannot move to This computer: asked to, the session says so,
  and the user starts a No folder session for a question that belongs to no project.
- When a session started in a project's folder gets a first prompt that has nothing to do with that
  folder, such as a general question, the first reply opens with one line saying so and naming where
  it belongs: a No folder session, or the folder of the project it is about. Then it answers.
  Nothing it learns goes into the memory of the folder it started in. A No folder session skips the
  line.
- A memory note states what holds now. When a fact changes, rewrite the sentence that states
  it, never append a paragraph calling an earlier one stale, and re-read the note from disk
  first, since a peer session may have written the same fact.
- A session that adds or changes a rule in this file finds the memory notes that state the old
  behaviour, by what the rule governs rather than the words of the incident behind it, and
  rewrites or deletes them in the same turn. After each edit of this file the `PostToolUse`
  hook `~/.claude/hooks/claude-md-memory-index.sh` lists every project's memory index lines.
  When the user reverses what a note records, edit the note first and act after.
- An index line is `- [Title](file.md): hook`, with a colon where the built-in memory template
  shows an em dash. The `PostToolUse` hook `~/.claude/hooks/memory-plain-characters.sh` hands
  back every em dash in a memory file changed in the last two minutes.
- The `PostToolUse` hook `~/.claude/hooks/share-memories.sh` shares project memory with
  colleagues on its own. In a repository whose `origin` is under an owner the untracked
  `~/.claude/shared-memories.conf` lists, it copies every note of that project's memory into
  `<repository>/<handle>/` of the shared clone the file names, with `~` for the home directory,
  and commits and pushes. A note that holds a secret, a personal detail or a fact about only the
  user's own machine or habits gets `share: no` in its frontmatter when it is written. So does a
  note that describes a client's or a subcontractor's material, such as what their code does, a
  request sent to them, a non-public address of theirs or a design file key, since a client contract
  may keep that to the people whose work on the project needs it. The hook leaves out a note that
  looks like it holds a password or token and names it, and the answer is to move the secret out or
  add `share: no`, never to reword it past the check.
- A memory note that records a correction quotes the user's words and dates them. What Claude
  reads into them is marked as its own inference or left out: a note never adds "always",
  "never" or "convention" where the user said none of them, and never narrows a rule in this
  file. A claim that rests on a note keeps the note's date and qualifiers, "as of 2026-10-02
  one of the four fits" and not "all four fit", and the note is re-read before a plan depends
  on it.
- When the user hands over facts or rules to keep, such as "put these to the appropriate
  context", the session picks the place for each item without being told. A rule for every project
  goes into this file, one about pull requests into the `pull-requests` skill, one about commit
  messages into the `commit-messages` skill. A rule that a repository's code or design must follow,
  which its team should share, such as who may see or change what or how a form marks a required
  field, goes into that repository's docs, indexed from its `AGENTS.md` or `CLAUDE.md`, on the
  branch of the PR in play or the one the user names. A fact about one project that only the
  session's work needs, such as a person, a deadline, a channel or a local recipe, goes into that
  project's memory, and a private fact that holds everywhere into a file in `~/.claude/rules/`.
  Before writing, the session checks each item against the code, asks what is still unclear about
  its meaning or scope in one message with a recommended answer per question, and the reply names
  where each item went.
- A correction or a wish that would hold beyond the task, a why question included, goes into this
  file, the `pull-requests` skill or the `commit-messages` skill in the same turn, committed and
  pushed as under Public configuration repository, without the user naming that repository: it holds
  for later prompts and sessions unless the user limits it. A limit the user states sets the scope:
  this session only writes nothing, this project writes its project memory. The reply quotes the
  rule as written, names any rule it changed, and is redone under it. When the correction asks for
  what the current text already does another way, say in a line how it already does it and rewrite
  the text so it says so plainly. A correction that does not say what it reacts to, such as "bro
  what", is first matched against what changed since the last reply outside this session too, such
  as a new PR in `gh pr list` or a peer session in ListAgents. When two readings remain, the reply
  puts both, lettered, with a recommended one, before any rule is written, never a guess named in
  the reply afterwards. Nothing the correction did not ask for that reaches the user outside the
  reply and the sidebar, such as a phone push or a mail as a fallback, goes into a rule only once
  the user picks it from a question with a recommended answer; naming it in the reply afterwards is
  no ask.
