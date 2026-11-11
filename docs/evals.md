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
| [Hook tests](../test/hooks/checks.mjs) | every hook, fed the input Claude Code sends it | 356 of 357 pass |
| [Sync tests](../test/sync/checks.mjs) | what `sync.sh` pulls and copies between two computers, against a throwaway remote | 17 of 17 pass |
| [Dream simulation](../test/dream-sim/checks.mjs) | how `/dream` spends usage and when it stops | 181 of 181 pass |
| [Usage mod tests](../mods/session-usage/hooks/register.test.ts) | the line under the prompt box | 29 of 29 pass |

How often Claude kept rules from [`CLAUDE.md`](../CLAUDE.md) from 2026-11-04 to 2026-11-11, in 188 of my own sessions and the commits of the 6 repositories they worked in, counted by [`test/rules/adherence.mjs`](../test/rules/adherence.mjs):

| Rule | Kept |
| --- | --- |
| No long dashes in replies | 98% (645 of 653 replies) |
| Plain quotes, arrows and dots in replies | 99% (652 of 653 replies) |
| A Prompt feedback section after each typed prompt | 96% (489 of 505 replies) |
| Commit message lines within 72 columns | 100% (330 of 330 commits) |
| No Claude attribution in commits | 100% (330 of 330 commits) |
<!-- evals:end -->
