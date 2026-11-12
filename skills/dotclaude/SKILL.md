---
name: dotclaude
description: How the public mirror of ~/.claude works: sync.sh, commits and mirrors. Load before changing CLAUDE.md, settings.json, a hook, skill, mod, workflow, command or agent under ~/.claude or anything in ~/Projects/dotclaude, and on a new machine.
---

# Public configuration repository

These procedures sit beside the Public configuration repository rules in `~/.claude/CLAUDE.md`,
which still hold: the user's go before a change to that file or a mirrored skill, and the `sync.sh`
run and its commit in the same turn.

## Writing a rule

- A `dotclaude` ask is how the user asks for a rule change, alone or inside a prompt about other
  work. The Prompt feedback section never calls it unclear or a second job, and a rewritten prompt
  keeps it.
- A rule in a mirrored file states what holds now. The incident behind it, its date and the wording
  it replaced go into the commit message, never into the file, and a changed rule is rewritten in
  place rather than followed by a note on what it used to say.
- A rule written from a correction reaches as far as the reason in the user's words, never only as
  far as the form of their example, and adds no condition they did not give: a wish to paste a page
  into Firefox covers every file Firefox shows, not HTML alone, and a wish to type less covers the
  fewest letters that work, not a whole word. What the session already knows about that reach, such
  as a search that matches any part of a name, goes into the rule and into the work redone under it.
  A question on the rule's scope offers that full reach as one option, never only narrower ones.
- A session that adds or changes a rule in `~/.claude/CLAUDE.md` finds the memory notes that state
  the old behaviour, by what the rule governs rather than the words of the incident behind it, and
  rewrites or deletes them in the same turn. After each edit of that file the `PostToolUse` hook
  `~/.claude/hooks/claude-md-memory-index.sh` lists every project's memory index lines.
- An edit made to `~/.claude/CLAUDE.md`, to `~/.claude/skills/pull-requests/SKILL.md` or to the
  `commit-messages` skill from another session reaches a running one through
  `~/.claude/hooks/claude-md-changed.sh`, in place of a re-read before a commit message or a PR
  body: once one differs from the copy the session last saw, the hook adds the diff to the next
  prompt, or to the next `gh pr` create, edit or merge, and for `~/.claude/CLAUDE.md` and the
  `commit-messages` skill also to the next commit or `sync.sh --commit`. It blocks that command once
  with the diff, unless every change lies in a section of `~/.claude/CLAUDE.md` whose rules shape no
  commit message or PR body, such as Running things.

## The checkout

- The checkout at `~/Projects/dotclaude` holds the mirrored files, each named in the `mirrored` list
  of `sync.sh`, and its own `README.md`, `docs/`, licence texts and `sync.sh`.
- The mirrored copy keeps the name `CLAUDE.md`. A session started inside the checkout would load it
  as project memory on top of the global file, so `settings.json` lists `**/dotclaude/CLAUDE.md` in
  `claudeMdExcludes`. Claude Code reads no other mirrored file from a repository root, so nothing
  else needs a different name.
- When a new file under `~/.claude` would help other people (a hook, a skill, a command, an agent),
  add it to the list in `sync.sh` first and give it an entry in the checkout's
  `docs/what-you-get.md`. The `README.md` stays one screen long: it says what the repository is,
  shows its parts and links the docs.

## sync.sh

- `sync.sh` pulls the checkout fast-forward, then reconciles each mirrored file: one the pull
  changed is installed into `~/.claude`, one changed locally is copied into the checkout, and one
  changed on both sides stops the run for a manual merge. It then scans everything that would be
  published for the local user name, home paths, the git identity, email addresses and
  credential-shaped strings, exits non-zero on a hit, and prints `git status`. Literals listed one
  per line in `sync-allow.txt`, when that file exists, are exempt. Literals listed one per line in
  the git-ignored `sync-deny.txt` fail the scan in any case, and `sync.sh --check-message`, run from
  the untracked commit-msg hook of the checkout and of each mirror, holds commit messages to the
  same list, less the literals that `sync-deny-skip.txt` in that repository's git directory lists,
  such as an employer's name in a repository the employer owns.
- A file sync that shares `~/.claude` between two computers brings a mirrored file over from the
  one that committed it before the pull here, a run copies it into the checkout, and git then
  refuses the pull over that copy. `sync.sh` gets past that by itself: when every file in the
  pull's way is a mirrored file whose checkout copy holds the same bytes as its `~/.claude` copy,
  it puts those copies back to HEAD, fast-forwards and reconciles. A file whose `~/.claude` copy is
  the pulled version ends clean, and one that holds more, such as another session's uncommitted
  hunk, gets that back as a local change: a copy that removes no line the pull wrote and adds back
  none it removed holds the pulled change, and is never called changed on both sides. A copy that
  lacks the pulled change still stops the run, as does a pull refused for any other reason, such as
  a change to a file that is not mirrored or a commit made here that the remote lacks. No
  `~/.claude` copy is overwritten on the way.
- `hooks/dotclaude-sync.sh` runs a plain `sync.sh` in the background at the start of every prompt of
  every session, so the pull and the reconcile need no run of their own. It commits and pushes
  nothing: local changes wait in the checkout for the session that made them. What stops a run, such
  as a pull that would overwrite a change to a file that is not mirrored, reaches each session once
  as context at its next prompt, and the reply names it. Runs take `.git/sync.lock`, and one waits
  for another.
- `CLAUDE.md`, `README.md`, the files under `docs/` and the pull-requests skill wrap prose at 100
  columns, a list item's later lines indented under its text, and a plain `sync.sh` run stops on a
  longer line. After an edit of one of them, run `~/Projects/dotclaude/reflow.sh` bare in place of a
  reflow written for the edit, as a command of its own rather than chained with `sync.sh`, so the
  hook that watches `CLAUDE.md` counts the change as the session's own edit. It fills greedily each
  paragraph that differs from the checkout's last commit, in `~/.claude` and in the checkout, from
  the line before the first change, and leaves the other paragraphs as they are.
- `sync.sh` holds `CLAUDE.md` to the byte count in the checkout's `claude-md-budget.txt`: over it, a
  run lists the file's sections by size and `--commit` refuses `CLAUDE.md`. The session then makes
  room itself, in the same turn and without asking: it moves a block at least as large as the
  overage, unchanged, into the skill whose description loads it wherever the block applies, or cuts
  sentences such a skill already states, and the reply names each block moved or cut and where it
  went. Raising the budget is the user's call alone, so a session that finds nothing to move or cut
  takes its own edit back out of `CLAUDE.md` before it asks, and no uncommitted hunk waits on the
  answer. After a move, a cut or any other change that shrinks the file, write its new size rounded
  up to the next 1,000 into `claude-md-budget.txt` and commit that file with the rest, so the budget
  falls with every cut and rises only on the user's yes.
- `sync.sh --commit <file> <path>...` commits the named paths and pushes them to the default branch,
  then every mirror below. It refuses a run that names no path, or no path with a change. No PR: the
  repository has one owner, though several sessions work in the checkout at once, and every
  `sync.sh` run copies their edits into it too. So name only the files this session's own edits
  touched, never what a `git status` taken around them shows. `~/.claude/hooks/own-hunks.sh` records
  each edit a session makes to a published file, less the edits other sessions recorded while the
  call ran, such as a peer's edit during a test run, and `--commit` takes only this session's edits
  of a named file and leaves another session's in the work tree, so a file both changed needs no
  wait. It stops when an edit changes lines another session wrote and has not committed, and when
  the version it would commit holds an edit another session recorded and has not committed, and
  either waits for that commit. A named file with no recorded edit, such as one changed by a script
  the user ran, goes in whole, unless it changed since a call of another session began, in the last
  15 minutes and not yet ended, which waits for that call: read `git -C ~/Projects/dotclaude diff --
  <path>` first, and leave out a file with a hunk this session did not write and tell that session
  with SendMessage. When the edit a stop shows is this session's own after all, deleting that
  session's line for it in `.git/own-hunks/<session>` lets it through, and a call a hook refused
  leaves a file in `.git/own-hunks/pending` that can go the same way. A scan hit in a file the run
  does not name only keeps that file out of the mirror copy. A mirrored JSON file changed locally
  goes back into the checkout's key order first, so `claude plugin` and the `/plugin` dialog may
  change `settings.json`.
- `sync.sh` also copies every published file into each directory listed in `sync-mirrors.txt`, an
  optional file beside it that git ignores, removes there what the checkout has deleted, and prints
  each directory it copied into. With `--commit` it then commits and pushes in each of them with the
  same message and a line naming the checkout commit, so one message is trimmed and redacted for
  every copy. Which directories those are and what each is for lives in the dotclaude checkout's
  project memory, never in this skill, in `CLAUDE.md` or in another tracked file, so the public
  repository shows the mechanism and nothing it points at.
- A file under `~/.claude` that names a project, client or person can still reach the mirrors:
  `sync-private.txt`, beside `sync.sh` and ignored by git, lists such files one per line, and
  `sync.sh` copies each from `~/.claude` into every mirror, never into the checkout, scanning it
  for credentials alone. Named after `--commit`, they are committed in the mirrors only, and a run
  that names no other changed path commits nothing in the checkout. The mirrors' commit-msg hook
  still checks the deny list, so the message names such a file by what it does. A file that no
  copy may hold, such as one with a contract's figures, stays off the list. Which files the list
  names lives in the checkout's project memory, and each of them ends by saying it is mirrored.

## After a push

- Every push to the checkout is followed in the same turn by a pass over the user's open PRs,
  listed with `gh search prs --author @me --state open`. Each PR whose body carries a block the
  `pull-requests` skill puts there, the configuration link or the prompts block, gets the link
  pinned to the commit just pushed and the rest of the body brought into line with the rules as they
  now stand, as far as the skill lets an edit of the body change it. The link pinned is the one to
  the repository of the checkout's `origin` remote, matched by owner and name: a link to another
  owner's copy of the repository stays as it is, hash included. A PR with neither block was
  written by hand and stays as it is. Nothing is rebuilt from another session's context: what the
  new rules need beyond the body, such as prompts, a verify run or new screenshots, is named in the
  reply under its PR, next to what the edit changed. `sync.sh --commit` ends by listing the open PRs
  whose body links the repository but not the commit it just pushed. It is a safety net for the
  pass, not a substitute for it: a PR with only the prompts block is not on that list.
- When the user asked why a problem still shows in a teammate's work or setup, such as issues a
  teammate's merge left open, the reply that reports the push also gives a prompt the user can hand
  to that teammate, who runs a copy of this setup, and other pushes give none. It stands in a `text`
  block of its own, so the teammate fetches nothing. It carries the change itself: each new or
  rewritten rule as it now reads, or a new or changed script whole, with the file and the section or
  neighbouring rule it goes beside, since their copy may be older and its lines differ. It tells the
  teammate's Claude Code to put each one in place in their own copy under `~/.claude`, to keep their
  local changes, and then, if they keep a mirror of their own, to commit and push it as their
  `dotclaude` skill says, and it says go, which their copy of these rules waits for. It names no
  project, client or person, so it can be passed on as it is.

## The usage mod

- The `usage` mod in `~/.claude/mods/session-usage`, which `CLAUDE_CODE_PLUGIN_DIRS` in
  `settings.json` loads in every session and `CLAUDE_CODE_PLUGIN_DIR_WATCH` reloads on every edit,
  pins a status line under the prompt: a fire emoji and the minutes the prompt cache stays warm, an
  ice cube emoji and since when it is cold, or a cookie emoji and the minutes left of a sign-in in
  the session's Chrome tabs when that ends first, then a brain emoji and how full the context window
  is, then an hourglass emoji, or a lock emoji for a sign-in, the minutes left and the other open
  session whose cache goes cold, unless its turn is still running or was stopped, it has the gear
  below, or the sidebar marks it completed and the wrap-up call of its last turn in the transcript
  neither asks a question nor stops for an answer, since the app's record keeps a wrap-up's question
  only when it stops for the answer, or whose sign-in ends soonest, named by its first word and
  those of its other words that fit and have Cmd+K in the app list it soonest: alone, or else first
  among the sessions, each word whole. It shows the tasks pane each time a window starts to show the
  session, from Claude's `show_pane` with `tasks` to its `close_pane`, reading the app's layout
  every 5 seconds meanwhile, and closes it on the first such read that finds a window showing the
  session after a `close_pane` that none showed. It also starts the title of each open session in
  the app with that fire or ice cube, or with a gear emoji while the session's last turn ended with
  background work in flight, which the `Stop` hook's input lists, or while a session it started
  works or has the gear itself, which the started session's record in the app names unless the user
  forked it, after a rename too, unless the user set the title by hand.
- The desktop app cuts the line at about 40 characters, so it stays within that with the cache
  first, and no hook adds it to the transcript as a notice.
- The mod and its scripts run on macOS and on Linux alike. The app keeps its session records in
  `~/Library/Application Support/Claude` on macOS and in `~/.config/Claude` on Linux, and every
  path to them tries both. Every shell call works with the BSD and the GNU tools: GNU `stat -c`
  before BSD `stat -f`, `date -d @<seconds>` after `date -r`, `pgrep` without `-q`, and Chrome
  matched as `Google Chrome`, `chrome` or `chromium`. A change to the mod is run on this machine
  against the live sessions before it is committed, not only through `claude plugin test`, whose
  mocks never run the scripts.

## Hooks that back rules

- A `UserPromptSubmit` hook in `~/.claude/settings.json` runs `~/.claude/hooks/git-fetch-prune.sh`
  in the background on every prompt. Inside a repository with remotes it fetches all of them with
  pruning at most once every 15 minutes per repository, with every credential prompt disabled so
  it can never hang a prompt. It is a safety net, not a substitute for fetching before a decision.
  A `PreToolUse` hook, `~/.claude/hooks/git-fetch-before-remote-base.sh`, is that fetch for a
  command that branches, rebases, merges, hard-resets or adds a worktree from an `origin/` or
  `upstream/` ref: it runs the same script and waits, unless a fetch ran in the last 2 minutes.
- A `Stop` hook, `~/.claude/hooks/stop-unreachable-claim.sh`, sends a turn back once when its
  closing message says in the first person that something could not be opened, read, reached, found
  or uploaded, and no Claude in Chrome tool ran since the prompt. Its phrase list is a heuristic
  that backs the rule in `~/.claude/CLAUDE.md` that tries Claude in Chrome before calling a page out
  of reach.
- Two hooks back the two stack rules in Running things of `~/.claude/CLAUDE.md` and replace
  neither. A `Stop` hook, `~/.claude/hooks/stop-running-stack.sh`, sends a turn back once when it
  started a stack that is still up. A `PreToolUse` hook, `~/.claude/hooks/stack-held-by-peer.sh`,
  refuses another session's start, restart, stop or removal of a stack that an active session
  started.
- A `PreToolUse` hook, `~/.claude/hooks/cd-fall-through.sh`, refuses a Bash command with a part
  after a `cd` that runs when the `cd` failed, unless the `cd` goes into a directory that exists
  already. It backs the rule in `~/.claude/CLAUDE.md` on commands that run in another directory.
- A `PreToolUse` hook, `~/.claude/hooks/no-identity-override.sh`, refuses `-c user.name=` and `-c
  user.email=`, the `GIT_AUTHOR_*` and `GIT_COMMITTER_*` name and email variables and `git commit
  --author`, and asks the user before `git config` sets or unsets a name or address. It backs the
  rule in `~/.claude/CLAUDE.md` that never overrides the git author.
- A `PostToolUse` hook, `~/.claude/hooks/detach-started-session.sh`, hands the `detach_session`
  step back to the model after each `start_session` and `hand_off_to_session` call. It backs the
  rule in the `models` skill that no session nests under another.
- A `PreToolUse` hook, `~/.claude/hooks/no-session-cards.sh`, refuses a `start_session` card, an
  "own_initiative" proposal or an "offer", and names the next-step box question in its place. It
  backs the rule in the `models` skill on offering a session.
- A `PostToolUse` hook, `~/.claude/hooks/git-submodule-update-after-switch.sh`, runs the update
  after every Bash command that switches and adds `git submodule status`, or the error that
  stopped the update, to the context. A switch given to the user still carries the update.
- While the screen is on and unlocked, the listeners in `~/.claude/presence` keep the file that
  `CLAUDE_CLIENT_PRESENCE_FILE` names there, and a `PreToolUse` hook,
  `~/.claude/hooks/push-only-when-locked.sh`, refuses a push while it is. They back the
  `PushNotification` rule in Running things of `~/.claude/CLAUDE.md`.
- A `PreToolUse` hook, `~/.claude/hooks/no-git-checkout.sh`, refuses `git checkout`. It backs the
  rule in `~/.claude/CLAUDE.md` on `git switch` and `git restore`.
- The `PreToolUse` hook `~/.claude/hooks/no-github-posts.sh` refuses a GitHub post that no prompt
  asked for and gave every word of, apart from an approval with no comment. It backs the rule in
  `~/.claude/CLAUDE.md` that never posts on GitHub.
- The `Stop` hook `~/.claude/hooks/prompt-feedback-box.sh` sends a turn back once when a typed
  prompt opened it and its last message has no Prompt feedback section, and marks a prompt that
  repeats a button's words. It backs the Prompt feedback rules of `~/.claude/CLAUDE.md`.
- The `Stop` hook `usage-waiting.sh` sends back once a turn that ends with none in flight while the
  pane stays shown. It backs the rule in Running things of `~/.claude/CLAUDE.md` on the tasks pane.
- The `PostToolUse` hook `~/.claude/hooks/memory-plain-characters.sh` hands back every em dash in a
  memory file changed in the last two minutes. It backs the rule in Memory hygiene of
  `~/.claude/CLAUDE.md` on index lines.

## Identity and contents

- Commits there carry the identity configured in the checkout, and the rule in `~/.claude/CLAUDE.md`
  about never overriding the git author applies to it as it stands: the user's own name with a
  disposable address.
- That repository never contains another person's name, an employer, client or customer name, a
  project name, a secret, or anything else that discloses what the user works on. The user's own
  name may stand in the history, as the author or in a quoted prompt, but in no published file,
  which the scan enforces. No email address either: the disposable address lives in the checkout's
  git config and nowhere else. Redact quoted prompts with square brackets where needed, as for
  upstream PRs, and quote only the part of a prompt that is about the configuration, as the
  `commit-messages` skill says; the mirrors follow the same rule. An example in a
  published file is a generic English placeholder, never a label, address, number or tool name from
  the session's project or employer, and a term that slips through goes into `sync-deny.txt`.

## New machine

- Follow the checkout's `docs/install.md`, taking everything (option b), then its identity step
  before the first commit, with the name and address `git log -1 --format='%an <%ae>'` prints for
  the existing history.
