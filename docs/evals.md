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
| [Hook tests](../test/hooks/checks.mjs) | every hook, fed the input Claude Code sends it | 240 of 240 pass |
| [Dream simulation](../test/dream-sim/checks.mjs) | how `/dream` spends usage and when it stops | 56 of 56 pass |
| [Usage mod tests](../mods/session-usage/hooks/register.test.ts) | the line under the prompt box | 7 of 7 pass |

How often Claude kept rules from [`CLAUDE.md`](../CLAUDE.md) from 2026-10-24 to 2026-10-31, in 124 of my own sessions and the commits of the 10 repositories they worked in, counted by [`test/rules/adherence.mjs`](../test/rules/adherence.mjs):

| Rule | Kept |
| --- | --- |
| No long dashes in replies | 99% (557 of 559 replies) |
| Plain quotes, arrows and dots in replies | 100% (559 of 559 replies) |
| A Prompt feedback section after each typed prompt | 99% (486 of 490 replies) |
| Commit message lines within 72 columns | 99% (308 of 309 commits) |
| No Claude attribution in commits | 100% (309 of 309 commits) |
<!-- evals:end -->
