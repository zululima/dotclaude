# How I work

This is how I use this setup from day to day, on a MacBook Air with an M5 chip. It leaves out what I
work on.

## Start of day

Each morning, before I start anything, I run `gm` in a terminal:

```zsh
gm
```

It is an alias in `~/.zshrc`:

```zsh
alias gm="$HOME/bin/start-of-day-update-and-restart.sh"
```

And this is the script it runs:

```zsh
#!/bin/zsh
set -euo pipefail

if docker info >/dev/null 2>&1; then
  "$HOME/bin/stop-containers.sh" || { print "Update and restart cancelled."; exit 1 }
  docker container prune -f
  docker volume prune -af
fi

brew update
brew upgrade -y
brew cleanup

sleep 60
touch "$HOME/.cache/gm-clear-screen"
osascript -e 'tell application "System Events" to restart with state saving preference'
```

If Docker is running, it first stops every container with `~/bin/stop-containers.sh`:

```zsh
#!/bin/zsh
set -euo pipefail

running=(${(f)"$(docker ps -q)"})
wait_s=45
if (( ${#running} )); then
  print "Stopping containers (${#running})..."
fi
for id in $running; do
  signal=$(docker inspect -f '{{.Config.StopSignal}}' $id)
  timeout=$(docker inspect -f '{{.Config.StopTimeout}}' $id)
  [[ $timeout == <-> ]] && (( timeout > wait_s )) && wait_s=$timeout
  docker kill --signal ${signal:-SIGTERM} $id >/dev/null || true
done
deadline=$(( SECONDS + wait_s ))
while [[ -n $(docker ps -q) ]] && (( SECONDS < deadline )); do
  sleep 1
done
if [[ -n $(docker ps -q) ]]; then
  print "Still running after ${wait_s} s:"
  docker ps --format '  {{.Names}}'
  exit 1
fi
```

It sends each container the signal that container is set to stop on and waits up to 45 seconds, or
longer when a container's own stop timeout says so. It never kills a container that does not stop:
if one is still running then, `gm` ends there and leaves it running, the way an app with unsaved
work stops a restart. Otherwise `gm` deletes the containers and all their volumes, so each project
starts the day from fresh test data and nothing from yesterday keeps running. Anything I changed by
hand in a local database is gone. Then it updates Homebrew and everything Homebrew installed,
without asking, and removes the old versions. Homebrew installs in the foreground, so nothing is
left half installed once it returns, and the script then waits a minute more as a margin. Then it
restarts the Mac the way Restart in the Apple menu does, without the dialog: every app is asked to
quit and can stop the restart over unsaved work. It follows that dialog's "Reopen windows when
logging in" choice, which I keep off, so after I log in only the apps set to Open at Login start.
Without `with state saving preference`, a System Events restart reopens every app whatever the
choice says. If an update fails, the script stops before the wait and the Mac keeps running. The
first restart asks once whether the terminal may control System Events. The flag file it leaves in
`~/.cache` makes `~/.zshrc` clear the output Terminal restores in the first window after the
restart:

```zsh
if [[ $TERM_PROGRAM == Apple_Terminal && -e $HOME/.cache/gm-clear-screen ]]; then
  rm "$HOME/.cache/gm-clear-screen"
  clear
fi
```

For a restart at any other time, I run `restart`, an alias beside `gm` in `~/.zshrc`, since `reboot`
is already a system command:

```zsh
alias restart="$HOME/bin/safe-restart.sh"
```

The script it runs does the same container stop and then the same restart:

```zsh
#!/bin/zsh
set -euo pipefail

if docker info >/dev/null 2>&1; then
  "$HOME/bin/stop-containers.sh" || { print "Restart cancelled."; exit 1 }
fi

osascript -e 'tell application "System Events" to restart with state saving preference'
```

## Prompting

I work in the Code tab of the Claude desktop app, one session per task, started in the project's
folder under `~/Projects`. Sessions run in auto mode, so Claude does not ask before every command,
and [`settings.json`](../settings.json) picks the model and the effort.

I write prompts the way I would message a colleague: short, lowercase, typos left in. "start doing
issue 123" or "review pr 123" is a whole prompt. Claude reads the issue, the code and its notes, and
asks me only what is mine to decide, as a question with its recommended answer first. Most of my
follow-ups are a word or a click: "go", "shorter", "commit and push", or a button in the box Claude
leaves at the end of its turn. A follow-up that is a task of its own, Claude offers as a new session
I can start with one click.

Two habits do most of the work:

- When Claude does something that should never happen again, I put `dotclaude` in the prompt, as in
  "dotclaude fix. next time ...". Claude writes the rule into [`CLAUDE.md`](../CLAUDE.md) or a
  skill, runs [`sync.sh`](../sync.sh), and commits and pushes it here with my prompt quoted. Many of
  the rules here started that way.
- Every reply ends with a short Prompt feedback section: what my prompt left out, and a rewrite. I
  read it and write the next prompt better.

## Browsers

Firefox is my default browser, so the links Claude gives me, such as a pull request or a page it
made, open there. Claude does its own browsing in the browser built into the desktop app, the pane
beside the chat, where I sign in once to the sites it needs. When a bot check fails in that pane,
Claude moves to Claude in Chrome, and I handle the check there myself.

## Battery and sleep

The Air spends nights on its charger while Claude works, so it never charges past 80%. I set this
once:

1. Open System Settings and click Battery in the sidebar.
2. Click the info button next to Charging, set Charge Limit to 80%, and click Done.

Charge Limit needs macOS Tahoe 26.4 or later and a Mac with Apple silicon, as [Apple's support
page](https://support.apple.com/102338) says.

Nothing may put the Mac to sleep while Claude works. In the Claude app, Settings > Claude Code has
"Keep computer awake while Claude works" and "Keep awake on battery power", and both are on. macOS
itself never sleeps on a timer:

```zsh
sudo pmset -a sleep 0 disksleep 0
```

The display still turns off after 3 minutes:

```zsh
sudo pmset -a displaysleep 3
```

I also veto sleep altogether, so a long run is never cut short. The cost is that the Air stays awake
on battery too, until I shut it down:

```zsh
sudo pmset -a disablesleep 1
```

This shows what is in effect:

```zsh
pmset -g
```

## Dreaming at the weekend

The weekly limit of my Claude plan resets on Saturday afternoon. [`/dream`](../workflows/dream.js)
reads the reset time from the usage card in the app and picks its mode by itself, so I run it twice
around the reset:

1. Friday, when I get home: connect the charger, leave the Claude app open, and send this in a new
   Code session.

   ```text
   /dream
   ```

   On the day before the reset this is an eve run. It spends most of what is left of the week
   overnight, but keeps back the most my own work used on one of the last four Saturdays, or two
   5-hour windows until one is measured, since I may work until the reset, and leaves the 5-hour
   window that would be open at 08:00 on Saturday untouched. In the chat it says only how many
   percentage points of my usage it used and how many proposals wait, and leaves its report to the
   review.

2. Saturday: start a new Code session in `~/Projects/dotclaude` and send this there. That session
   reads the steps from their files, while the one that ran overnight would send its whole context
   again with every request.

   ```text
   dream review
   ```

   It shows the latest report first and reruns the evals, then applies most steps without asking and
   goes through the rest one question at a time, each with the exact change, a moment where things
   went wrong and how that moment goes once the change is in. I answer "Add it" or "Not now", and
   Claude applies what I added and pushes it here. Then I carry on with my own work.

3. Saturday, when I am done: connect the charger again and send `/dream` in a new Code session. On
   the reset day this is a final run. It spends the rest of the week, down to 1 percentage point,
   and stops starting work an hour and a quarter before the reset, so everything reports back in
   time. In the chat it shows only how many percentage points of my usage it used. Its report, with
   the week's figures and what the run spent, waits for the review.

4. The next time I sit down: send `dream review` in a new session as in step 2, which shows the
   report and goes through its proposals.
