# dotclaude

My Claude Code setup, the `~/.claude` folder, made public so you can borrow from it. Most of it
stops a mistake Claude Code makes again and again before it happens. Projects that write their code
with AI should publish how they used it too, so every commit here quotes the prompts behind it,
collected in [`PROMPTS.md`](PROMPTS.md).

| [`CLAUDE.md`](CLAUDE.md) | [`hooks/`](hooks) | [`skills/`](skills) | [`workflows/`](workflows/dream.js) | [`mods/`](mods) |
| --- | --- | --- | --- | --- |
| the rules Claude follows in every project | stop mistakes, keep git tidy, keep a record | pull requests, Slack drafts, this copy | `/dream`, an idle-time review that proposes changes | cache and context gauge under the prompt, archived sessions' files moved |

**Docs:** [what you get](docs/what-you-get.md), [how I work](docs/how-i-work.md),
[evals](docs/evals.md), [install](docs/install.md).

New here? Paste this into Claude Code:

```text
clone github.com/zululima/dotclaude into ~/Projects and help me pick what to install
```

Prose, meaning `CLAUDE.md`, `PROMPTS.md`, `docs/`, every `SKILL.md` and this README, is [CC BY-SA
4.0](LICENSE-CC-BY-SA-4.0). Everything else is [AGPL-3.0-or-later](LICENSE).
