#!/usr/bin/env bash

# Builds lock-listener.swift and runs it as a LaunchAgent at login, so the
# marker file that CLAUDE_CLIENT_PRESENCE_FILE in settings.json names exists
# only while the screen is unlocked, and Remote Control pushes reach the phone
# only while the Mac is locked. Needs swiftc from Xcode or its command line
# tools. Run it again after changing the Swift file or the path. The listener
# logs each lock and unlock to ~/Library/Logs/claude-presence.log. On Linux
# with KDE Plasma it runs lock-listener-kde.sh instead, as the systemd user
# service claude-presence with the graphical session, logging to its journal.
#
#   install.sh               build, install and start the agent
#   install.sh --uninstall   stop and remove the agent and the marker file

set -eu

dir="$(cd "$(dirname "$0")" && pwd)"
label=local.claude.presence
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
marker="$(jq -r '.env.CLAUDE_CLIENT_PRESENCE_FILE // empty' "$HOME/.claude/settings.json")"

if [ "$(uname -s)" = Linux ]; then
  unit="$HOME/.config/systemd/user/claude-presence.service"
  systemctl --user disable --now claude-presence.service 2>/dev/null || true
  if [ "${1:-}" = --uninstall ]; then
    rm -f "$unit"
    systemctl --user daemon-reload
    [ -z "$marker" ] || rm -f "$marker"
    exit 0
  fi
  if [ -z "$marker" ]; then
    echo "install: settings.json sets no CLAUDE_CLIENT_PRESENCE_FILE in env" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$unit")"
  cat >"$unit" <<EOF
[Unit]
Description=Keep the Claude Code presence file in step with the screen lock and displays
PartOf=graphical-session.target
After=graphical-session.target

[Service]
ExecStart="$dir/lock-listener-kde.sh" "$marker"
Restart=always
RestartSec=5

[Install]
WantedBy=graphical-session.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now claude-presence.service
  exit 0
fi

launchctl bootout "$domain/$label" 2>/dev/null || true
if [ "${1:-}" = --uninstall ]; then
  rm -f "$plist" "$dir/lock-listener"
  [ -z "$marker" ] || rm -f "$marker"
  exit 0
fi
if [ -z "$marker" ]; then
  echo "install: settings.json sets no CLAUDE_CLIENT_PRESENCE_FILE in env" >&2
  exit 1
fi

swiftc -O -o "$dir/lock-listener" "$dir/lock-listener.swift"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$dir/lock-listener</string>
    <string>$marker</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/claude-presence.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/claude-presence.log</string>
</dict>
</plist>
EOF
plutil -lint -s "$plist"

# A bootout can still be settling, and bootstrap then fails with error 5.
for _ in 1 2 3 4 5; do
  launchctl bootstrap "$domain" "$plist" 2>/dev/null && exit 0
  sleep 1
done
launchctl bootstrap "$domain" "$plist"
