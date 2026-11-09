#!/usr/bin/env bash

# The KDE Plasma counterpart of lock-listener.swift: keeps the marker file that
# CLAUDE_CLIENT_PRESENCE_FILE names there while the screen is unlocked and a
# display is on, and removes it while the screen is locked or every display is
# off. KWin on Wayland refuses GetSessionIdleTime, so the displays that
# PowerDevil turns off after its idle timeout stand in for an idle check. The
# systemd user unit that install.sh writes runs it with the file's path as its
# one argument.

set -u

if [ $# -ne 1 ]; then
  echo "usage: lock-listener-kde.sh <marker file>" >&2
  exit 64
fi
marker=$1

screen_state() {
  case $(gdbus call --session --timeout 5 --dest org.freedesktop.ScreenSaver \
    --object-path /ScreenSaver --method org.freedesktop.ScreenSaver.GetActive 2>/dev/null) in
    '(true,)') echo locked; return ;;
    '(false,)') ;;
    *) echo unknown; return ;;
  esac
  case $(timeout 10 kscreen-doctor --dpms show 2>/dev/null) in
    *': on'*) echo unlocked ;;
    *'dpms mode'*) echo 'displays off' ;;
    *) echo unknown ;;
  esac
}

# A stopped listener can no longer tell, so pushes go out as if no file were set.
trap 'rm -f "$marker"' EXIT
trap 'exit 0' TERM INT

last=
while :; do
  state=$(screen_state)
  if [ "$state" = unlocked ]; then
    [ -e "$marker" ] || : >"$marker"
  else
    rm -f "$marker"
  fi
  if [ "$state" != "$last" ]; then
    echo "$state"
    last=$state
  fi
  sleep 15 &
  wait $!
done
