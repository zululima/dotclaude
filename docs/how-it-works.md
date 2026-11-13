# How it works

Claude Code reads `~/.claude` when a session starts and at set moments while it runs. This
repository is a copy of the parts other people can use.

| Part | When Claude Code reads it | What it does |
| --- | --- | --- |
| [`CLAUDE.md`](../CLAUDE.md) | every session, from the start | the rules Claude follows in every project |
| [`settings.json`](../settings.json) | every session, from the start | turns the hooks and mods on, picks the model, allows and blocks tools |
| [`hooks/`](../hooks) | at set moments: a prompt, before and after each tool call, the end of a turn | stops a mistake before it happens, or hands Claude a fact it would miss |
| [`skills/`](../skills) | only when a task needs one | the steps for one kind of work, such as a pull request |
| memory | each project's index every session, a note when it applies | what one project taught Claude, kept per project folder |
| [`mods/`](../mods) | always, in the desktop app | a gauge under the prompt, and archived sessions' files moved away |
| [`workflows/dream.js`](../workflows/dream.js) | when I type `/dream` | reads a week of sessions and proposes changes |

## One prompt

What happens between typing a prompt and reading the reply:

```mermaid
flowchart TD
  start(["I type a prompt"])
  hooksIn["Prompt hooks log the prompt, fetch git,<br/>pull this copy and flag rules<br/>another window changed"]
  ctx["Claude reads CLAUDE.md and<br/>the project's memory index"]
  skl["A skill, such as pull-requests"]
  tool["Claude calls a tool"]
  before{"Hooks before the call"}
  runs["The command or edit runs"]
  after["Hooks after the call note this window's edits,<br/>share memory notes and update submodules"]
  turnEnd{"Hooks at the end of the turn"}
  answer(["The reply, ending with feedback on my prompt"])

  start --> hooksIn --> ctx --> tool --> before
  ctx -.->|when the task needs one| skl -.-> tool
  before -->|allowed| runs --> after
  before -->|refused, with a way that works| tool
  after -->|more to do| tool
  after -->|done| turnEnd
  turnEnd -->|feedback missing or a stack still up| tool
  turnEnd -->|all clear| answer
```

A hook that refuses a call tells Claude why and what to run instead, so Claude tries again the right
way rather than stopping. [What you get](what-you-get.md) lists every hook and what it stops.

## How a rule gets in

Many rules here started as a mistake Claude made:

```mermaid
flowchart TD
  slip(["Claude makes a mistake"])
  sayMirror["I say mirror and what should<br/>happen next time"]
  dreamRun["My /dream run reads a week of sessions<br/>and proposes changes"]
  dreamReview["In the dream review I answer<br/>Add it or Not now"]
  rule["Claude writes a rule into CLAUDE.md,<br/>a skill or a hook in ~/.claude"]
  syncSh["sync.sh copies it into this copy and stops<br/>on a name, a home path or a secret"]
  commitPush["sync.sh --commit commits it with my prompt<br/>quoted and pushes it"]
  repo[("This repository")]
  desktop["~/.claude on my Linux desktop"]
  yourCopy["Your ~/.claude"]

  slip --> sayMirror --> rule
  dreamRun --> dreamReview --> rule
  rule --> syncSh --> commitPush --> repo
  rule -.->|Syncthing| desktop
  repo -->|clone, then pick pieces or install all| yourCopy
```

[`sync.sh`](../sync.sh) also runs in the background at every prompt, so a change pushed from one
computer reaches the other. Every commit quotes the prompts behind it, and
[`PROMPTS.md`](../PROMPTS.md) collects them. [Install](install.md) shows how to take pieces or all
of it.
