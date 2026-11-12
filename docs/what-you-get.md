# What you get

## Words you will see

- **Repository** (repo): a project folder that git keeps the history of, usually also on GitHub.
- **Commit**: a saved snapshot of changes, with a message saying what changed.
- **Pull request** (PR): asking for your changes to be added to the main version, so others can
  review them first.
- **Hook**: a small script Claude Code runs by itself at a set moment, such as before every command.
  A hook can stop a command before it runs. You never start one yourself.
- **Skill**: written instructions Claude Code reads only when a task needs them.
- **Eval**: a check that runs the same way every time and gives a score, so a change that makes
  things worse shows up.
- **Terminal**: the app where you type commands. On a Mac it is called Terminal.

## Stops mistakes

- [`check-not-piped.sh`](../hooks/check-not-piped.sh): stops Claude from reporting failed tests as
  passed, which happens when the test output goes through another command.
- [`no-github-posts.sh`](../hooks/no-github-posts.sh): stops Claude from posting comments or reviews
  on GitHub, where they would appear under your name, unless you typed every word of one in a
  prompt, or it is an approval with no comment.
- [`one-draft-pr-per-repo.sh`](../hooks/one-draft-pr-per-repo.sh): stops Claude from opening a
  second draft PR in a repository where you already have one open, unless you asked to start a new
  issue, so a side change joins that PR.
- [`no-home-search.sh`](../hooks/no-home-search.sh): stops searches of your whole disk, which make
  the Mac ask you for permission folder after folder.
- [`cd-fall-through.sh`](../hooks/cd-fall-through.sh): stops a command from carrying on in the wrong
  folder when moving to the right one failed.
- [`no-foreground-wait.sh`](../hooks/no-foreground-wait.sh): stops Claude from checking over and
  over on a task it left running in the background, which keeps it from reading your messages for up
  to ten minutes.
- [`no-slow-binary-grep.sh`](../hooks/no-slow-binary-grep.sh): stops a search inside a large program
  file, such as Claude Code itself, that would run for minutes, and shows Claude a way that takes
  under a second.
- [`no-git-checkout.sh`](../hooks/no-git-checkout.sh): stops Claude from using `git checkout`, which
  can overwrite files by mistake, and names the `git switch` or `git restore` command instead.
- [`no-identity-override.sh`](../hooks/no-identity-override.sh): stops Claude from making up a git
  author, even in a throwaway test repository, and asks you before it changes the name or address
  your commits carry.
- [`no-own-email-in-requests.sh`](../hooks/no-own-email-in-requests.sh): stops Claude from sending
  your own email address to a website, in a User-Agent, a From header, a mailto contact, a link or a
  web search, also from a script it writes. It reads your addresses from your Claude account, your
  git settings and `~/.claude/own-addresses.txt`, so they are never written in the hook.
- [`no-secrets-in-commands.sh`](../hooks/no-secrets-in-commands.sh): stops Claude from typing a
  password, token or key into a command, where "Yes, and don't ask again" would save it in the
  project's `.claude/settings.local.json` and the transcript would keep it. Claude reads the value
  from a file, the keychain or a variable instead. Local defaults such as `root`, and passwords for
  a local database or a container, still go through.
- [`calendar-free-busy-only.sh`](../hooks/calendar-free-busy-only.sh): stops Claude from reading
  other people's calendar events. It can still see when they are free.
- [`slack-user-search-own-workspace.sh`](../hooks/slack-user-search-own-workspace.sh): tells Claude
  that the Slack user search misses members of other companies who write in a shared channel, so it
  reads that channel instead of saying it cannot see their message.
- [`stop-running-stack.sh`](../hooks/stop-running-stack.sh): makes Claude stop the Docker containers
  it started before it finishes, so nothing keeps running and eating battery.
- [`stop-unreachable-claim.sh`](../hooks/stop-unreachable-claim.sh): sends Claude back to try Claude
  in Chrome, where you are signed in, before it says a page or file is out of reach.
- [`stack-held-by-peer.sh`](../hooks/stack-held-by-peer.sh): stops one Claude window from stopping
  Docker containers that another window is using.

## Keeps git tidy

- [`git-fetch-prune.sh`](../hooks/git-fetch-prune.sh): keeps Claude's picture of GitHub up to date,
  in the background, so it does not act on old information.
- [`git-fetch-before-remote-base.sh`](../hooks/git-fetch-before-remote-base.sh): fetches first and
  waits when Claude is about to branch, rebase or reset from the copy on GitHub, so it never starts
  from an old one.
- [`git-prune-gone-branches.sh`](../hooks/git-prune-gone-branches.sh): deletes old branches when no
  work would be lost, and lists the ones it kept.
- [`git-submodule-update-after-switch.sh`](../hooks/git-submodule-update-after-switch.sh): keeps
  submodules, repos inside a repo, in step after Claude switches branch.

## Keeps a record

- [`prompt-log.sh`](../hooks/prompt-log.sh): saves every prompt you type, on your computer only, so
  commits and pull requests can quote the prompts behind them, each with a short summary of Claude's
  reply.
- [`prompts-md.sh`](../hooks/prompts-md.sh): builds a `PROMPTS.md` file that lists those prompts per
  commit, like the one in this repo. A branch for a pull request leaves the file as the main branch
  has it, so two open pull requests never conflict over it.
- [`prompts-md-current.sh`](../hooks/prompts-md-current.sh): stops a commit once when Claude did not
  rebuild that file for it, in a repository that keeps one.
- [`no-meta-prompts.sh`](../hooks/no-meta-prompts.sh): keeps prompts about Claude's own setup out of
  a project's history.
- [`abbreviations-listed.sh`](../hooks/abbreviations-listed.sh): holds back a commit whose quoted
  prompts use an abbreviation an earlier commit spelled out, such as pr for pull request, until the
  message spells it out too.
- [`usage-log.sh`](../hooks/usage-log.sh): writes down the tokens each turn used, so you can add up
  a week later.
- [`usage-waiting.sh`](../hooks/usage-waiting.sh): notes when a turn ends with a background run
  still going, so the usage mod puts a gear before that session's name. A turn that ends with no run
  left while the tasks pane Claude opened is still shown goes back once, so Claude closes it.

## Keeps Claude to the rules

- [`CLAUDE.md`](../CLAUDE.md): the rules Claude follows in every project. It names no person or
  company, so you can copy it as it is.
- [`claude-md-changed.sh`](../hooks/claude-md-changed.sh): tells a running session when the rules or
  the pull request skill were changed in another window.
- [`permission-mode-changed.sh`](../hooks/permission-mode-changed.sh): tells a running session when
  you switched its permission mode, so it never names the old one.
- [`prompt-feedback-box.sh`](../hooks/prompt-feedback-box.sh): makes sure every reply to a prompt
  you typed ends with a short note on how your prompt could have been better.
- [`archive-when-done.sh`](../hooks/archive-when-done.sh): when Claude finishes with nothing left to
  ask or do, makes it say that you can archive the session, or that the session it handed its task
  to archives it.
- [`detach-started-session.sh`](../hooks/detach-started-session.sh): when Claude starts another
  session, reminds it to move that session to the top of the sidebar instead of under its own.
- [`no-session-cards.sh`](../hooks/no-session-cards.sh): stops Claude from proposing another
  session as a card you have to click. It asks under its reply instead, with the model and effort
  the session would run on, so one shortcut says yes.
- [`memory-plain-characters.sh`](../hooks/memory-plain-characters.sh): points out long dashes in
  Claude's memory notes, so Claude swaps them for plain punctuation.
- [`claude-md-memory-index.sh`](../hooks/claude-md-memory-index.sh): when Claude changes a rule in
  `CLAUDE.md`, shows it every memory note index, so it fixes the notes that still say the old thing.
- [`share-memories.sh`](../hooks/share-memories.sh): shares Claude's notes about a project with your
  team. It does nothing until you set it up.
- [`sync-conflicts.sh`](../hooks/sync-conflicts.sh): if you keep `~/.claude` the same on two
  computers with Syncthing, tells Claude about each file both changed at once, which Syncthing keeps
  twice, so Claude merges the two back. It does nothing otherwise.
- [`plan-limits.sh`](../hooks/plan-limits.sh): a status line for Claude Code in a terminal, which
  shows how much of your plan's 5-hour and weekly limits is used, on the plans that report it, and
  keeps those figures in a file. With it `/dream` stops before your limits in a terminal session
  too, where the usage card of the desktop app is out of reach. On other plans it shows and writes
  nothing.

## Extras

- [`settings.json`](../settings.json): turns the hooks on, picks my model, blocks a few tools,
  leaves "Co-Authored-By: Claude" off commits and keeps old sessions for 90 days instead of 30.
- [`mods/session-usage`](../mods/session-usage): a line under the prompt box that shows how many
  minutes the cache stays warm (a warm cache makes the next message cheaper), how full Claude's
  memory of the chat is, and which other open session's cache goes cold next, leaving out those
  still working, whose last turn left you nothing to do or that wait on a background run or another
  session, so you can get back to it in time. In the desktop app every session's name starts with a
  fire while its cache is warm and an ice cube once it is cold, or a gear while it waits on a
  background run or on a session it started that is still working, and a session waiting on a run
  opens its tasks pane when you open it, then closes the pane the next time you open it after the
  run is done. The tokens and what they would cost show once a week instead, in the report of the
  last `/dream` run before the weekly reset.
- [`mods/archive-files`](../mods/archive-files): when you archive a session in the desktop app, the
  files it made for you, its drafts folder and its folder in `~/Downloads`, move to
  `~/.claude/archive/` within seconds, on macOS and on Linux, and memory notes and background files
  that named them point to where they went. On a Mac it also closes every Chrome tab that no open
  session uses, the archived session's and your own, such as a page you signed in on, through
  Chrome's AppleScript, so macOS asks once whether Claude may control Google Chrome. When no tab
  would stay, the last one turns into a New Tab page, so Claude in Chrome keeps the window it
  connects through. Then it deletes the tab groups Chrome saved closed for sessions no longer open,
  which a window closing or Chrome quitting leaves pinned to the bookmarks bar. Chrome has no API
  for those, so it opens each group's menu on the bar through accessibility, only while Chrome is
  visible with a New Tab page in front, and the menu shows for about a second per group. It reads
  the app's own list of archived sessions, which is not documented and may change in an update. If
  files stop moving, `~/Library/Logs/claude-archive-files.log` on a Mac, or
  `~/.local/state/claude-archive-files.log` on Linux, shows the last time it worked.
- [`presence`](../presence/install.sh): my phone gets Claude's pushes, such as a question waiting
  for an answer, only while the computer is locked or its displays are off.
  [`lock-listener.swift`](../presence/lock-listener.swift) on a Mac and
  [`lock-listener-kde.sh`](../presence/lock-listener-kde.sh) on Linux with KDE Plasma keep the file
  that `CLAUDE_CLIENT_PRESENCE_FILE` in `settings.json` names in step with the screen: it is there
  while the screen is unlocked, and on KDE also a display is on, and Claude Code skips the push
  then. The desktop app pushes a session that no window shows even while you work in another one, so
  [`push-only-when-locked.sh`](../hooks/push-only-when-locked.sh) stops Claude's own pushes while
  the file is there. This starts the listener at every login, as a LaunchAgent on a Mac and a
  systemd user service on Linux:
  ```zsh
  ~/.claude/presence/install.sh
  ```
- [`energy`](../energy/install.sh): which Claude Code sessions and prompts used the battery. macOS's
  own battery log puts every session, and every command a session runs, under the Claude app.
  [`energy-sampler.swift`](../energy/energy-sampler.swift) reads each process's energy every 10
  seconds while the Mac runs on battery and groups it by session, with the session's process named
  by [`energy-session-pid.sh`](../hooks/energy-session-pid.sh) at every prompt. It also reads the
  chip's own energy counters through IOReport, without root: CPU, GPU, Neural Engine, memory and
  display engine. [`report.py`](../energy/report.py) ranks sessions and prompts by joules, against
  what the battery's charge counter says it gave, prices commands too short to see running from the
  chip's CPU energy, shares out the GPU by each app's GPU time and gives root processes, the memory
  and the screen with the rest of the Mac rows of their own. The dream run's battery check reads it.
  Mac only. This builds the sampler and starts it at every login:
  ```zsh
  ~/.claude/energy/install.sh
  ```
- [`skills/commit-messages`](../skills/commit-messages/SKILL.md): how Claude writes a commit
  message: the order of its parts, the prompts behind the change, and what it leaves out or redacts.
- [`skills/pull-requests`](../skills/pull-requests/SKILL.md): how Claude writes a pull request: the
  description, the steps to test it, screenshots, and how it reviews one.
- [`skills/pull-requests/pane-upload.sh`](../skills/pull-requests/pane-upload.sh): puts screenshots
  into a pull request through GitHub's own comment box, from a tab Claude drives in Chrome.
- [`pane-bridge.mjs`](../hooks/pane-bridge.mjs): gets files too big for Claude in Chrome's own
  upload into a site open in Chrome, through the site's own upload button, and saves what Claude
  draws there.
- [`chrome-background.sh`](../hooks/chrome-background.sh): opens the Chrome window Claude in Chrome
  needs to connect when Chrome has none and keeps Chrome hidden meanwhile, so it never lands on top
  of your work. The window's tab, [`chrome-anchor.html`](../hooks/chrome-anchor.html), closes itself
  when you come back to it. On a Mac it hides Chrome itself. On Linux with KDE Plasma, Chromium or
  Chrome starts with that tab as its only window, and
  [`chrome-anchor-kwin.js`](../hooks/chrome-anchor-kwin.js), a KWin script, hides the window as it
  opens.
- [`skills/pull-requests/review-page`](../skills/pull-requests/review-page/build.py): turns a pull
  request's test steps and screenshots into a checklist page you tick off with the keyboard while
  you review it.
- [`skills/slack-draft`](../skills/slack-draft/SKILL.md): Claude drafts a Slack message and puts it
  on your clipboard with links and bold kept. You paste it and press send. Mac only.
- [`skills/share`](../skills/share/SKILL.md): say share, and Claude writes the conversation as
  Markdown, shows you what in it talks about people or plans, and after your go puts it on a
  `claude-sessions` branch of the private GitHub repository you work in, with its link.
- [`skills/chrome`](../skills/chrome/SKILL.md): how Claude works in your own Chrome: starting the
  extension hidden, reading the page before each click, uploading files, turning a page into a file
  and leaving sign-ins to you.
- [`skills/pages`](../skills/pages/SKILL.md): where a page Claude makes for you goes, and the check
  that a page meant for a glance fits one laptop screen.
- [`skills/emoji-and-stickers`](../skills/emoji-and-stickers/SKILL.md): when you add stickers or
  pick emoji by hand, Claude gives the few letters that find each emoji in the app's search.
- [`skills/scheduling`](../skills/scheduling/SKILL.md): Claude finds a meeting time from free and
  busy times alone, within hours you set, never reading other people's events.
- [`skills/vpn-check`](../skills/vpn-check/SKILL.md): when a request fails in a way a VPN could
  cause, Claude checks whether yours is on before blaming it, and asks before any way around it.
- [`skills/portfolio-work`](../skills/portfolio-work/SKILL.md): for work you do to learn or show a
  skill, Claude teaches the norms behind it and leaves every choice to you.
- [`skills/read-aloud`](../skills/read-aloud/SKILL.md): when Claude turns a PDF or another document
  into speech, every heading stays a heading and gets a pause around it.
- [`skills/models`](../skills/models/SKILL.md): which model and effort each kind of work runs on,
  with the benchmark scores behind each pick and what a response costs in my own sessions, so the
  picks are the strongest ones the plan's 5-hour limit carries through a working day: a subagent
  that only looks things up runs on a small model, most work on the mid-priced one, and only
  software whose cause or design is still open on the strongest. A session asked for such work on
  a cheaper model hands it to a copy of itself on the right model and effort, since it cannot
  switch its own. A session on a costlier model than its task needs, or one that starts while your
  plan's 5-hour or weekly limit is on pace to fill before it resets, asks whether the task should
  run on the cheaper model, shows the benchmark score and the cost of both, and on your yes starts
  it in a session there. It steps down by model, since a lower effort on the same model fills the
  limit almost as fast. `pace.sh` beside the skill works out that pace from how your own weeks
  have gone. `/dream` keeps
  both tables current from each new model's launch page and from the unofficial trackers that watch
  for a model quietly getting worse.
- [`skills/dotclaude`](../skills/dotclaude/SKILL.md): how Claude keeps this copy and my own
  `~/.claude` the same, and what it must never publish here. Claude reads it only before it changes
  the setup, which keeps the rules every session reads shorter.
- [`workflows/dream.js`](../workflows/dream.js): type `/dream` when you stop for the day. Many
  agents read your recent sessions, your setup and the Mac's own power log, which shows what drained
  the battery, and come back with suggested changes, each with a ready script, and scheduled tasks
  worth setting up, each asked about before it is created. It changes nothing by itself and stops
  before your usage limits, and in the chat it says only how much of them it used. Type `/dream
  review` in a new session to read its report and go through the changes. When
  `~/.claude/dream/evals-checkout.txt` names a copy of this repository, the review also reruns the
  [evals](evals.md) and publishes their numbers. When you keep a glossary at
  `~/.claude/rules/finnish-terms.md`, with a list headed "Use the Finnish word" and one headed "Keep
  the English word", `/dream` also reads the Finnish your sessions wrote and proposes entries for
  the terms from English it has none for: the Finnish Wikipedia's article title or a term bank
  decides the word, and a term with neither keeps its English one. Started with `unattended: true`,
  as a timer on a computer nobody sits at would, it stops before it reads anything when it cannot
  see your limits. When two computers share `~/.claude`, only one run goes at a time, and each run
  estimates from the earlier runs of its own computer, since their plans may differ.
- [`agents/dream-worker.md`](../agents/dream-worker.md): a lighter agent for `/dream`, so it uses
  fewer tokens.

## Only for this repo

- [`dotclaude-sync.sh`](../hooks/dotclaude-sync.sh): runs `sync.sh` in the background at the start
  of every prompt, so a change pushed from one computer reaches the other without my asking. It
  publishes nothing, and tells Claude once when something stops it.
- [`sync.sh`](../sync.sh): keeps this copy and my own `~/.claude` the same, and checks that nothing
  private gets published. It also stops on a shell script with a syntax error, a file this list
  leaves out, or a line in `CLAUDE.md`, the pull request skill, the README or these docs wider than
  100 characters, and commits no `CLAUDE.md` over the byte count in `claude-md-budget.txt` until I
  cut something or raise the count. `--install` copies everything onto a new computer.
- [`own-hunks.sh`](../hooks/own-hunks.sh): notes which changes each Claude window makes to the files
  published here, leaving out what other windows changed meanwhile, so `sync.sh --commit` publishes
  only the changes of the window that runs it. It waits for another window when its own change edits
  lines that window has not published yet, or when what it would publish holds a change that window
  noted and has not published.
- [`reflow.sh`](../reflow.sh): rewraps the paragraphs an edit changed in `CLAUDE.md`, the pull
  request skill, the README or these docs at 100 characters, in this copy and in `~/.claude`.
- [`test/dream-sim`](../test/dream-sim/): checks how `/dream` spends your usage. Not installed.
- [`test/hooks`](../test/hooks/checks.mjs): feeds every hook the input Claude Code sends it, in a
  throwaway home folder, and checks what it lets through. Not installed.
- [`test/rules`](../test/rules/adherence.mjs): counts how often Claude kept the rules in your own
  sessions of the last week. It prints counts only, never what was said.
- [`test/sync`](../test/sync/checks.mjs): runs `sync.sh` between a throwaway remote, copy and
  `~/.claude`, in the states a second computer leaves them in, and checks what it pulls and copies.
  Not installed.
- [`test/evals.mjs`](../test/evals.mjs): runs all of these and fills in [Evals](evals.md).

For the full details, open the file: every hook explains itself at the top, and so do `sync.sh` and
`dream.js`.
