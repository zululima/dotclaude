#!/usr/bin/env bash

# Installs the root half of the energy log: a LaunchDaemon that runs powermetrics.zsh, which logs
# the measured CPU, GPU and Neural Engine power of the whole chip every 10 seconds while the Mac
# runs on battery, to /Library/Logs/claude-energy. report.py reads it beside the energy sampler's
# log. The daemon runs a root-owned copy in /usr/local/libexec, so no file a user can write runs
# as root. Run it with sudo, and again after changing powermetrics.zsh.
#
#   sudo install-root.sh               install and start the daemon
#   sudo install-root.sh --uninstall   stop and remove the daemon; the log stays

set -eu

if [ "$(id -u)" != 0 ]; then
  echo "install-root: run it with sudo" >&2
  exit 1
fi
dir="$(cd "$(dirname "$0")" && pwd)"
label=local.claude.energy-powermetrics
plist="/Library/LaunchDaemons/$label.plist"
program=/usr/local/libexec/claude-energy-powermetrics
logs=/Library/Logs/claude-energy

launchctl bootout "system/$label" 2>/dev/null || true
if [ "${1:-}" = --uninstall ]; then
  rm -f "$plist" "$program"
  exit 0
fi

install -d -o root -g wheel -m 755 /usr/local/libexec "$logs"
install -o root -g wheel -m 755 "$dir/powermetrics.zsh" "$program"
cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$program</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>Nice</key>
  <integer>5</integer>
  <key>StandardErrorPath</key>
  <string>$logs/powermetrics.log</string>
</dict>
</plist>
EOF
chown root:wheel "$plist"
chmod 644 "$plist"
plutil -lint -s "$plist"

# A bootout can still be settling, and bootstrap then fails with error 5.
for _ in 1 2 3 4 5; do
  launchctl bootstrap system "$plist" 2>/dev/null && exit 0
  sleep 1
done
launchctl bootstrap system "$plist"
