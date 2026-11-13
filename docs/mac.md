# My Mac

The Mac this setup runs on, read from the Mac itself on 13 November 2026: its menu bar, apps,
command-line tools, settings and what runs in the background. It leaves out what I work on. The
daily routine, battery and sleep are in [how I work](how-i-work.md).

It is a MacBook Air with an Apple M5 chip and 24 GB of memory, on macOS 27.2.1, with a 2560x1440
display beside it.

## Menu bar

Three items on the right:

- Overload's battery: the percentage over a bar as full as the battery, with a bolt while it is
  plugged in. Overload is a small menu bar app Claude wrote for me in Swift. It has a second item
  that shows only when something needs a look, one symbol for the first that applies: the CPU at 90%
  or more, critical memory pressure or heat, or a disk with under 10 GB free in red, no network or
  no internet in blue, a busy iPhone hotspot in orange and the hotspot itself in green. Its menu
  lists CPU, memory, swap, disk, heat, battery and network, and the processes using the most CPU and
  memory. It is not published here.
- Control Center.
- The clock.

Everything else is hidden: Wi-Fi, Battery, Spotlight, the keyboard layout menu and the icons of
Docker Desktop and the Claude app. Overload shows the network and the battery, and Cmd+Space in
macOS opens Spotlight.

## Apps

Pinned in the Dock, in this order:

| App | What it is | Installed from |
| --- | --- | --- |
| Terminal | Apple's own, where I run `gm` each morning | macOS |
| Claude | the desktop app, whose Code tab is where I work with Claude Code | the maker's site |
| Firefox | my default browser | the maker's site |
| Google Chrome | where Claude browses for me, through Claude in Chrome | Homebrew |
| Slack | chat | App Store |
| Signal | messages | the maker's site |
| Qobuz | music | the maker's site |
| System Settings | macOS settings | macOS |
| Visual Studio Code | code editor | Homebrew |
| Reminders | to-do lists | macOS |
| 1Password | passwords | the maker's site |
| Proton VPN | VPN, on only when I need it | the maker's site |
| Photo Booth | camera | macOS |
| Preview | PDFs and images | macOS |
| Xcode | Apple's developer tools, for apps for the Mac and the iPhone | App Store |
| Docker Desktop | containers for each project's local stack | the maker's site |
| LibreOffice | office suite, which Claude also runs headless to make PDFs | Homebrew |

Installed but not pinned:

| App | What it is | Installed from |
| --- | --- | --- |
| Draw Things | image generation that runs on the Mac | App Store |
| Developer | Apple's developer videos and documentation | App Store |
| Figma | design | the maker's site |
| GIMP | image editing | the maker's site |
| OBS | screen recording | Homebrew |
| VLC | video player | Homebrew |

## Command-line tools

From Homebrew, which `gm` updates every morning:

| Tool | What it is for |
| --- | --- |
| `gh` | GitHub from the command line, which Claude uses for issues and pull requests |
| `terminal-notifier` | macOS notifications from the shell, see [Shell](#shell) |
| `syncthing` | keeps `~/.claude` the same on this Mac and a Linux desktop |
| `ollama` | runs language models on the Mac |
| `ffmpeg` | converts audio and video |
| `poppler` | reads and renders PDFs, such as `pdftotext` |
| `unar` | unpacks archives of most formats |
| `nmap` | scans a network's ports |
| `fastfetch` | prints the system's details |
| `xcodegen`, `xcbeautify` | Xcode projects from a spec file, and readable `xcodebuild` output |
| `gradle`, `temurin@21`, `android-commandlinetools` | Android builds from the command line |
| `eurkey-next` | the EurKEY Next keyboard layout, see [Settings](#settings) |

Node.js comes from nvm, and Claude Code itself from its native installer in `~/.local/bin`.

## Settings

The settings that shape how I use this Mac, each with the key that holds it:

| Setting | Value | Domain and key |
| --- | --- | --- |
| Appearance | Dark | `NSGlobalDomain AppleInterfaceStyle` |
| Languages | English (US), then Finnish | `NSGlobalDomain AppleLanguages` |
| Region | Finland, so dates, times and units follow it while menus stay English | `NSGlobalDomain AppleLocale` |
| Keyboard layouts | EurKEY Next, then Finnish | `com.apple.HIToolbox AppleEnabledInputSources` |
| Keyboard layout menu | hidden from the menu bar | `com.apple.TextInputMenu visible` |
| Correct spelling automatically | off | `NSGlobalDomain NSAutomaticSpellingCorrectionEnabled` |
| Two spaces type a full stop | off | `NSGlobalDomain NSAutomaticPeriodSubstitutionEnabled` |
| Finder view | columns | `com.apple.finder FXPreferredViewStyle` |
| New Finder window opens | Downloads | `com.apple.finder NewWindowTargetPath` |
| Screenshots go to | `~/Pictures/Screenshots` | `com.apple.screencapture location` |
| Hot corners | none | `com.apple.dock wvous-br-corner` |
| Margins between tiled windows | off | `com.apple.WindowManager EnableTiledWindowMargins` |
| Terminal profile | Clear Dark | `com.apple.Terminal "Default Window Settings"` |

`defaults read` followed by the domain and the key shows a value on your own Mac:

```zsh
defaults read com.apple.finder FXPreferredViewStyle
```

Spotlight runs two actions from a few letters: `sbcl` sets the battery's charge limit and `tbs`
turns Background Sounds on or off. In the Claude app the menu bar icon and the quick entry shortcut
are off, and keeping the computer awake is on, as [how I work](how-i-work.md#battery-and-sleep)
says.

## Shell

zsh in Terminal. `~/.zshrc` keeps 100,000 lines of history, each with the time the command started
and how long it ran:

```zsh
HISTSIZE=100000
SAVEHIST=100000
setopt EXTENDED_HISTORY INC_APPEND_HISTORY_TIME
```

When Claude Code runs the shell, an unmatched glob, a leading `=` and an unquoted variable act as in
bash, which is what Claude tends to write:

```zsh
if [[ -n $CLAUDECODE ]]; then
  setopt nonomatch noequals shwordsplit
fi
```

A command that ran a minute or more ends with a macOS notification, unless Ctrl+C stopped it or it
was an interactive program. A click on the notification brings back the app the shell runs in. It
needs `terminal-notifier`:

```zsh
if [[ -o interactive ]]; then
  zmodload zsh/datetime
  autoload -Uz add-zsh-hook
  long_command_seconds=60
  long_command_preexec() {
    long_command_line=$1
    long_command_start=$EPOCHSECONDS
  }
  long_command_precmd() {
    local exit_code=$? seconds title message
    [[ -n $long_command_start ]] || return 0
    seconds=$(( EPOCHSECONDS - long_command_start ))
    unset long_command_start
    (( seconds >= long_command_seconds && exit_code != 130 )) || return 0
    case ${${(z)long_command_line}[1]} in
      claude|ssh|vim|nvim|less|man|top|htop|tmux) return 0 ;;
    esac
    title="Done after $(( seconds / 60 )) min $(( seconds % 60 )) s"
    (( exit_code )) && title="Failed, exit code $exit_code, after $(( seconds / 60 )) min $(( seconds % 60 )) s"
    # terminal-notifier reads a message that starts with [ or - as an option unless escaped
    message=$long_command_line
    [[ $message == [\[-]* ]] && message="\\$message"
    ( terminal-notifier -title "$title" -message "$message" -sound Glass \
        -activate "${__CFBundleIdentifier:-com.apple.Terminal}" >/dev/null 2>&1 & )
  }
  add-zsh-hook preexec long_command_preexec
  add-zsh-hook precmd long_command_precmd
fi
```

The `gm` and `restart` aliases are in [how I work](how-i-work.md#start-of-day).

## In the background

LaunchAgents in `~/Library/LaunchAgents` start these at login:

- The Claude app, with `open -a Claude`.
- `claude remote-control --spawn same-dir --permission-mode auto`, kept running, so I can reach
  Claude Code on this Mac from claude.ai/code or the Claude mobile app.
- Firefox, once the network answers. Firefox here loads every tab it restores at launch, and a tab
  loaded before the Wi-Fi is up keeps its error page, so this script replaces Firefox's own Open at
  Login:

  ```zsh
  #!/bin/zsh
  probe=https://detectportal.firefox.com/success.txt
  max_wait_s=300

  note() { print "$(date '+%F %T') $*" }

  start=$(date +%s)
  until curl -fs -o /dev/null --max-time 3 $probe; do
    if (( $(date +%s) - start >= max_wait_s )); then
      note "no network after $max_wait_s s"
      break
    fi
    sleep 1
  done
  note "waited $(( $(date +%s) - start )) s"

  if pgrep -xq firefox; then
    note "Firefox already running"
  else
    open -a Firefox
  fi
  ```

- Syncthing, as a Homebrew service.
- The [energy sampler](../energy/install.sh) and the [lock listener](../presence/install.sh) from
  this repository, which [what you get](what-you-get.md) explains.
- A helper Claude wrote for Qobuz, which ignores the pause macOS sends when I take my AirPods out
  and lets a press on an AirPod open Apple Music. The helper pauses Qobuz then, and makes the press
  play and pause Qobuz. It is not published here.
