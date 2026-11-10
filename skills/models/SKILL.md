---
name: models
description: Which Claude model and effort level each kind of work runs on, with the benchmarks behind each pick. Load it at a prompt that starts software work, such as building, changing, debugging or reviewing code, before any other step, and before choosing the model or effort of any work a session starts, such as a subagent, a workflow agent, another session, a scheduled task or a prompt for another machine.
---

# Models and effort

- Every piece of work a session starts runs on the model and effort of its task's row below, set
  through the starting tool's own fields: `model` and `effort` of the Agent tool, the `model` and
  `effort` options of a workflow's `agent()` and `model` and `effort` of `start_session`. A task
  that fits two rows takes the stronger one. This skill is the instruction the Agent tool's
  `effort` field waits for.
- `start_session` takes a model and effort only at or below the starting session's own. A session
  that needs a stronger model or a higher effort is switched with `set_session_model` and
  `set_session_effort` right after the start, which the app may ask the user to approve, and the
  reply says that its first turn ran on the model it started with.
- A tool that cannot set the model or effort its row asks for is named in the reply with that row.
- No row uses max effort: on Fable 5.2 Anthropic keeps it for measuring the model's ceiling, and
  on software work it does worse than xhigh.
- A session cannot switch its own model or effort, so at the prompt that starts a task it reads
  them with `get_session` and `self` and compares them with the task's row. A prompt that starts
  software work in a session off the software row's model or effort gets no work in that turn: the
  reply names the row's model and effort to pick in the app's model menu, and the turn ends with
  `wrap_up` and `blocked`. The work starts at the next prompt, once `get_session` shows the row's
  model and effort. Any other task runs on the session's model as it is, and the first line of the
  reply that starts it names its row's model and effort.

| Task | Model | Effort | Benchmarks behind it |
|---|---|---|---|
| Software: building, changing, debugging or reviewing code, scripts, hooks, skills and workflows | Fable 5.2 (`fable`) | xhigh | FrontierCode 2.0: 49.1 at xhigh, 45.3 at high, Opus 5.5 45.5 at its best. FrontierSWE v2: 69.9, Opus 5.5 62.3 |
| Research across many web sources and collecting data from them | Fable 5.2 (`fable`) | medium | WANDR: medium matches Opus 5.5's top score for about 40% of its cost per task |
| Reading charts, figures and screenshots | Fable 5.2 (`fable`) | medium | Chartography: 66.4 at medium, Opus 5.5 64.4 at max, for under a tenth of the cost |
| Everything else: writing, drafts, documents, planning and questions | Opus 5.5 (`opus`) | xhigh | Anthropic names Opus 5.5 the daily driver for most coding and knowledge tasks. No benchmark compares its effort levels, so the effort is the one set in the app today |
| A bounded step that needs judgement, such as summarising one file | Sonnet 5.5 (`sonnet`) | medium | Anthropic: move down to Sonnet or Haiku when a task is simpler |
| A mechanical step: a lookup, a listing, reading one value, a format check | Haiku 5.5 (`haiku`) | low | The same guidance |

- The table changes only when newer benchmarks back another pick. The dream workflow's `anthropic`
  source reads each model launch page and proposes the row as it would read, with the scores
  behind it.

Sources: Claude Fable 5.2 and Mythos 5.2 launch page, 9 November 2026,
[https://www.anthropic.com/claude-fable-and-mythos-5-2](https://www.anthropic.com/claude-fable-and-mythos-5-2),
and the model configuration page of the Claude Code docs,
[https://code.claude.com/docs/en/model-config](https://code.claude.com/docs/en/model-config).
