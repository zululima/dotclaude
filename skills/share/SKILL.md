---
name: share
description: Share this Claude Code conversation as Markdown on the claude-sessions branch of the repository the session works in, and give back its GitHub link. Load when the user types share or asks to share this session or conversation.
---

# Share a session

A shared session goes to `claude-sessions`, a branch with no history of its own in the GitHub
repository the session works in, as `<GitHub handle>/<date>-<title>.md`. Everyone who can read the
repository can read it, so nothing is pushed before the user's go. The scripts never switch the
checkout: the commit is built in a temporary index, and its push skips the checkout's pre-push
hook, which checks code this commit does not touch. They need git, gh signed in, jq and
`~/.claude/hooks/prompt-log.sh`, whose numbers the prompts keep.

1. Run `~/.claude/skills/share/export-session.sh`. It writes the session to
   `~/.claude/drafts/share/<session id>.md` and prints the path. Each prompt is quoted under its
   number, masked as for a commit message. Under it come the messages Claude wrote, with their
   links, and one line per tool call. Tool output, thinking, system reminders, messages from other
   sessions and subagent work are left out.
2. Read the whole file. The closing message lists, lettered, each passage that gives the user's
   view of a named person, a client or another organisation, or a plan they may not want shared,
   and anything the masks missed, such as a password, key or private address not written as
   `NAME=value`, a task another session wrote included. The recommended answer replaces each with
   a bracketed note, such as `[an aside about a colleague left out]`, by an edit of that file.
3. Run `~/.claude/skills/share/share-session.sh --dry-run <file>` in the repository and name in the
   closing message the repository, the branch and the address the file will get. A repository that
   gh does not show as private stops the share here. It goes there only when the user names that
   repository and asks for it, and then the script runs with `--public`.
4. Ask for the go in the next-step box, after the passages the user is to choose about. On it, make
   the edits the user picked, run `~/.claude/skills/share/share-session.sh --push <file>` and give
   the address it prints as a link whose text is the whole address. A later share of the same
   session replaces its file at the same address.

When the session works outside a GitHub repository, ask which checkout to share to, with the one the
session last worked in as the recommended answer, and run both steps with `-C <checkout>`.
