---
name: commit-messages
description: Rules for a commit message, its 72-column wrap included. Load it before writing a commit message in any repository. It covers the order of the parts and the trailers, the prompts section and the script that prints it, pasted text, what is left out or redacted, and PROMPTS.md.
---

# Commit messages

These rules sit beside the Commit messages section of `~/.claude/CLAUDE.md`, which still holds the
hook that brings an edit of this skill made from another session into a running one.

- Wrap every line of a commit message at 72 columns, the subject included. Neither GitHub nor
  `git log` reflows long lines, so they break the rendering.
- The message proper comes first: the subject, a blank line, then a body that says what changed
  and why. The prompts follow after another blank line, never before the body. PR bodies are the
  other way round, as the `pull-requests` skill describes. Trailers, such as `Co-authored-by` and
  `Reviewed-by`, come last, as a paragraph of their own after a blank line, and are written into the
  message file. A `Signed-off-by` trailer goes only into a repository whose contributing guide or CI
  asks for one, such as a Developer Certificate of Origin check, and no other commit carries one.
  Where one is asked for, it goes into the message file with the name and address `git config`
  gives. Git reads the `Abbreviations:` lines as trailers, so `git commit -s` alone appends the
  sign-off to them, and once the file holds it, `-s` adds no second one.
- When squashing a pull request, by squash merge or by squashing its commits into one before
  merging, add a `Co-authored-by: <name> <address>` trailer to the squashed commit for every human
  account whose commits are being squashed, apart from the author the squashed commit already
  carries. Take each name and address from `git log --format='%an <%ae>'` over the squashed range,
  never from memory. GitHub drafts these trailers in its squash-merge dialog: keep them. The
  attribution rule in `~/.claude/CLAUDE.md` still holds, so no trailer ever names Claude or
  Anthropic.
- When squashing a pull request, also add a `Reviewed-by: <name> <address>` trailer for every
  human account that submitted a review on it. Take the identity from that account's own commits
  in the same repository: `gh api 'repos/<owner>/<repo>/commits?author=<login>&per_page=1'`
  gives the name and address it commits under. Fall back to the account's
  `<id>+<login>@users.noreply.github.com` address, with the id from `gh api users/<login>`, and
  skip the account when neither resolves. A review alone never earns a `Co-authored-by`, an
  address never comes from another repository, and a bot never gets a trailer.
- The prompt that says to merge is a prompt about the change too. Add it to the PR's prompts
  block before merging, and to the prompts section of the squash commit, which is the commit
  that prompt creates.
- The prompt section opens with two lines. The first is
  `Prompts behind this commit, as given to Claude Code` and the second is
  `(model <id>, effort <level>):`, with the model id and effort level of the running session,
  taken as the bullet on printing the prompts below says,
  never from memory. Then come the prompts behind the change: those given since the session's
  previous commit, every prompt of the session for its first commit, and for a follow-up to a
  commit made under the same prompt that prompt again. They keep their session numbers, each on
  its own line followed by the prompt as `>` quoted lines, verbatim, typos and lowercase
  included, wrapped onto further `>` lines at 72 columns. Mark answers to questions with a short
  parenthetical on the number's line, such as `2. (answer to: shall I build it?)`. When those
  prompts use abbreviations, an `Abbreviations:` section follows with one line per abbreviation
  and its expansion. When they use none, there is no such section.
- Text the user pasted into a prompt (a pasted block: a log, code, a file, an address, a message
  from someone else) is never quoted, in a commit message or in a PR body. Replace it where it
  stood with a bracketed description of what it was, such as `[pasted: an email address]` or
  `[pasted: 40 lines of test output]`.
- A quoted prompt, in a commit message, a PR body or a file of prompts such as one a Slack post
  links, that gives the user's view of a named person, case or organisation, or a plan they may not
  want shared, is asked about in the closing message before the push or the `gh pr` call that lets
  anyone but the user read it, such as the members of an organisation in its private repository. The
  recommended answer puts a bracketed note in its place, such as
  `[an aside about colleagues left out]`, and publishing waits for the answer, since a later commit
  leaves the text in the history already pushed.
- Print the prompts and their heading, never retype them. The `UserPromptSubmit` hook
  `prompt-log.sh` in `~/.claude/hooks` appends every prompt to `~/.claude/prompt-log/<session
  id>.jsonl`, and `~/.claude/hooks/prompt-log.sh print` prints the session's prompts numbered and
  quoted for a PR body under its `Model:` line, with `--commit` in the commit form above under both
  heading lines, and with `--from <n>` from prompt n on. It takes the model and effort of each
  prompt from the session's transcript and names each value with the prompts it ran under when
  `/model` or `/effort` changed one. For a forked session it also prints the prompts from before the
  fork, from the log of the session it was forked from, and only when that log is missing counts
  them without printing them. It leaves out reminders, peer session messages and subagent
  hand-backs, and prints an address as `[pasted: an address]`, a pasted block as `[pasted: <n>
  lines]`, a home path with `~` and a password or token value as `[redacted]`. With `--commit` it
  also names on stderr the `Abbreviations:` lines that earlier commits gave for words the prompts
  use, in the repository `-C <repo>` names, by default the working directory's, and in
  `~/Projects/dotclaude`. Then do only what the printout cannot: leave out and redact as the bullets
  around this one say, replace a spawned task's opening prompt, which another session wrote, with
  `[a task another Claude session wrote, left out]`, say what each pasted address or block was, and
  add the answer marks and the abbreviations, each named line among them whose word stays in the
  message and means the same there. When print leaves the heading out, it exits 1 and says why: run
  it again with `--model <id>` and the model id of the session, or with `--effort <level>` and the
  level `get_session` with `self` gives, as the message asks.
- The PR rules on exclusion and redaction apply to commit messages too: leave out meta prompts,
  and in public and upstream repositories redact downstream project, client and customer names
  with square brackets. The one exception is the public configuration repository, where prompts
  about `~/.claude/CLAUDE.md` or about Claude Code settings are the prompts behind the change and
  stay in. There, and in every directory `sync.sh` mirrors into, internal or not, a quoted prompt
  keeps only the part about the rules or the settings; the rest becomes a bracketed note such as
  `[an ask about a downstream project left out]`, and what stays is redacted as for upstream
  PRs, a content type's name in the project's language included, since it names the project
  as surely as the project's name does.
- A repository with a `PROMPTS.md` at its root keeps it current in every commit: write the commit
  message to a file, run `~/.claude/hooks/prompts-md.sh --message <file>` in the checkout, and
  commit the rebuilt file with the change, with `git commit -F <file>`. The script writes the
  file from the prompts sections of the commit messages, newest first, each with its commit and
  PR, so it is never edited by hand. Each rebuild rewrites the whole file and fills in a hash or
  PR that an earlier commit could not name yet, so no commit is amended, force-pushed or added
  only to update the file, and a conflict in it is settled by taking either side. A repository
  without the file gets one only when the user asks, and before adding it to one that merges
  through PRs, tell the user that every open PR rebuilding it will conflict with the others once
  one of them merges. In the public configuration repository `sync.sh` runs the script itself.
