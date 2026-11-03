#!/bin/zsh

# Runs as root from the LaunchDaemon that install-root.sh writes, from a root-owned copy of this
# file. While the Mac runs on battery it takes one 10-second sample from powermetrics, Apple's
# power sampler, which needs root, and appends a JSON line to
# /Library/Logs/claude-energy/<date>.jsonl: t (Unix seconds) and the fields elapsed_ns,
# cpu_energy, cpu_power, gpu_energy, gpu_power, ane_energy, ane_power and combined_power as
# powermetrics names them, from its processor section where it has them there. report.py reads
# the lines beside the energy sampler's.

emulate -L zsh
zmodload zsh/datetime
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
logs=/Library/Logs/claude-energy
sample=$(mktemp -t claude-powermetrics)
mkdir -p $logs

while true; do
  if ! pmset -g batt | grep -q "'Battery Power'"; then
    sleep 60
    continue
  fi
  if ! powermetrics -n 1 -i 10000 --samplers cpu_power,gpu_power -f plist -o $sample >/dev/null 2>&1; then
    sleep 60
    continue
  fi
  tr -d '\000' <$sample | plutil -p - 2>/dev/null | awk -v t=$EPOCHSECONDS '
    /^  "processor" => \{/ { inside = 1; next }
    inside && /^  \}/ { inside = 0; next }
    match($0, /"[a-z_]+" => [0-9.]+$/) {
      split(substr($0, RSTART), pair, /" => /)
      key = substr(pair[1], 2)
      if (inside && !(key in processor)) processor[key] = pair[2]
      if (!inside && !(key in elsewhere)) elsewhere[key] = pair[2]
    }
    END {
      printf "{\"t\":%s", t
      split("elapsed_ns cpu_energy cpu_power gpu_energy gpu_power ane_energy ane_power combined_power", keys, " ")
      for (i = 1; i in keys; i++) {
        key = keys[i]
        if (key in processor) printf ",\"%s\":%s", key, processor[key]
        else if (key in elsewhere) printf ",\"%s\":%s", key, elsewhere[key]
      }
      print "}"
    }' >>$logs/$(strftime %F $EPOCHSECONDS).jsonl
  find $logs -maxdepth 1 -name '*.jsonl' -mtime +30 -delete
done
