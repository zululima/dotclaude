#!/usr/bin/env bash

# Builds overload.swift into ~/Applications/Overload.app and starts it: a menu
# bar item for the battery, and one that shows only while the CPU, memory,
# heat, disk or network needs a look. Its menu has Open at Login. Mac only;
# needs swiftc from Xcode or its command line tools. Run it again after
# changing the Swift file: it quits the running copy, puts the new build in its
# place and opens it.

set -eu

dir="$(cd "$(dirname "$0")" && pwd)"
app="$HOME/Applications/Overload.app"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT

swiftc -O -swift-version 5 "$dir/overload.swift" -o "$build/Overload"
"$build/Overload" --render "$build"
iconutil -c icns "$build/AppIcon.iconset" -o "$build/AppIcon.icns"

pkill -x Overload || true
for _ in $(seq 50); do
  pgrep -x Overload >/dev/null || break
  sleep 0.2
done
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$build/Overload" "$app/Contents/MacOS/Overload"
cp "$build/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
cp "$dir/Info.plist" "$app/Contents/Info.plist"
codesign --force --sign - "$app"
touch "$app"
open "$app"
