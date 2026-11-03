# Evals

These are the numbers from the last `/dream` run, or from the last time I ran the evals by hand. The
rule counts come from my own sessions, and only the counts leave my computer. To run the evals on
your copy:

```bash
node ~/Projects/dotclaude/test/evals.mjs
```

<!-- evals:start -->
| Suite | What it checks | Result |
| --- | --- | --- |
| [Hook tests](../test/hooks/checks.mjs) | every hook, fed the input Claude Code sends it | 270 of 270 pass |
| [Dream simulation](../test/dream-sim/checks.mjs) | how `/dream` spends usage and when it stops | 120 of 120 pass |
| [Usage mod tests](../mods/session-usage/hooks/register.test.ts) | the line under the prompt box | 9 of 9 pass |

How often Claude kept rules from [`CLAUDE.md`](../CLAUDE.md) from 2026-10-27 to 2026-11-03, in 123 of my own sessions and the commits of the 9 repositories they worked in, counted by [`test/rules/adherence.mjs`](../test/rules/adherence.mjs):

| Rule | Kept |
| --- | --- |
| No long dashes in replies | 99% (525 of 527 replies) |
| Plain quotes, arrows and dots in replies | 99% (524 of 527 replies) |
| A Prompt feedback section after each typed prompt | 99% (460 of 464 replies) |
| Commit message lines within 72 columns | 99% (322 of 324 commits) |
| No Claude attribution in commits | 100% (324 of 324 commits) |
<!-- evals:end -->
