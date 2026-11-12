---
name: scheduling
description: Finding a time with other people: free/busy only, through suggest_time, within hours a source gives. Load before looking for a meeting time or reading anyone's calendar.
---

# Finding a time

- A `PreToolUse` hook, `~/.claude/hooks/calendar-free-busy-only.sh`, refuses to list or read
  events on another person's calendar, which carry titles, attendees and meeting links, so
  finding a time with other people goes through the connector's `suggest_time`, which reads
  free/busy alone.
- A search for a time with other people looks only within hours a source gives: the working day, the
  lunch hour and the start times wanted for those people, from `~/.claude/rules/`, project memory or
  another source. Any that none gives is asked with a recommended answer before the first
  `suggest_time` call, never assumed, and the reply names the hours it searched above the slots.
