#!/usr/bin/env bash

# Builds energy-sampler.swift and runs it as a LaunchAgent at login, so the Mac
# logs, while it runs on battery, the energy each Claude Code session and each
# app used to ~/Library/Logs/claude-energy, one file a day, kept 30 days.
# report.py beside it reads the log. The hook hooks/energy-session-pid.sh, set
# in settings.json for SessionStart and UserPromptSubmit, tells the sampler which
# process belongs to which session. Mac only; needs swiftc from Xcode or its
# command line tools. Run it again after changing the Swift file.
#
#   install.sh               build, install and start the agent
#   install.sh --uninstall   stop and remove the agent; the log stays

set -eu

dir="$(cd "$(dirname "$0")" && pwd)"
label=local.claude.energy
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
logs="$HOME/Library/Logs/claude-energy"

launchctl bootout "$domain/$label" 2>/dev/null || true
if [ "${1:-}" = --uninstall ]; then
  rm -f "$plist" "$dir/energy-sampler"
  rm -rf "$logs/pids"
  exit 0
fi

swiftc -O -o "$dir/energy-sampler" "$dir/energy-sampler.swift"
mkdir -p "$HOME/Library/LaunchAgents" "$logs/pids"
cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$dir/energy-sampler</string>
    <string>$logs</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>Nice</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$logs/sampler.log</string>
  <key>StandardErrorPath</key>
  <string>$logs/sampler.log</string>
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
