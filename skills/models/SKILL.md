---
name: models
description: Which Claude model and effort level each kind of work runs on, with the benchmarks behind each pick, and the cheaper ones a task steps down to when the plan's limits would not last. Load it at a prompt that starts software work, such as building, changing, debugging or reviewing code, or any other task of more than a few tool calls, before any other step, and before choosing the model or effort of any work a session starts, such as a subagent, a workflow agent, another session, a scheduled task or a prompt for another machine.
---

# Models and effort

- Every piece of work a session starts runs on the model and effort of its task's row below, set
  through the starting tool's own fields: `model` and `effort` of the Agent tool, the `model` and
  `effort` options of a workflow's `agent()` and `model` and `effort` of `start_session`. A task
  that fits two rows takes the stronger one. This skill is the instruction the Agent tool's
  `effort` field waits for.
- `start_session` takes a model and effort only at or below the starting session's own. A session
  that needs another model or effort, both as its row gives them, starts with a prompt that asks it
  only to reply `ready` and run no tools, so its first turn costs next to nothing. It then gets
  `detach_session`, `set_session_model` and `set_session_effort`, which the app may ask the user to
  approve, and only then its task with `send_message`.
- A tool that cannot set the model or effort its row asks for is named in the reply with that row.
- The reply that links a session this one started, or shows the card that proposes one, names that
  session's model and effort and says why they are the best for it: what in its task puts it on its
  row, and what the score or guidance behind the row means for that task, such as that a feature
  touching the backend and the frontend is software work, where Fable 5.2 scores highest at xhigh.
  The reason is written for that session's task, never the row's last cell copied as it stands.
- No row uses max effort: on Fable 5.2 Anthropic keeps it for measuring the model's ceiling, and
  on software work it does worse than xhigh.
- A session cannot switch its own model or effort, so at the prompt that starts a task it reads
  them with `get_session` and `self` and compares them with the task's row. Software work in a
  session off the software row's model or effort goes to a new session started as above, with
  `context` "fork" so it holds this conversation, and with a task that asks it to carry out the
  user's last prompt there, so the prompt stays the user's own in its log and its commits.
  The reply links that session and says the work goes on there, and this session does none of it.
  Any other task runs on the session's model as it is, and the first line of the reply that starts
  it names its row's model and effort. A session whose opening prompt says the user picked its
  model and effort for the pace keeps them, as Stepping down says.

| Task | Model | Effort | Benchmarks behind it |
|---|---|---|---|
| Software: building, changing, debugging or reviewing code, scripts, hooks, skills and workflows | Fable 5.2 (`fable`) | xhigh | FrontierCode 2.0: 49.1 at xhigh, 45.3 at high, Opus 5.5 45.5 at its best. FrontierSWE v2: 69.9, Opus 5.5 62.3 |
| Research across many web sources and collecting data from them | Fable 5.2 (`fable`) | medium | WANDR: medium matches Opus 5.5's top score for about 40% of its cost per task |
| Reading charts, figures and screenshots | Fable 5.2 (`fable`) | medium | Chartography: 66.4 at medium, Opus 5.5 64.4 at max, for under a tenth of the cost |
| Everything else: writing, drafts, documents, planning and questions | Opus 5.5 (`opus`) | xhigh | Anthropic names Opus 5.5 the daily driver for most coding and knowledge tasks. Humanity's Last Exam with tools: 66.4 at xhigh, 63.9 at high, and 67.7 at max for three times the cost per task |
| A bounded step that needs judgement, such as summarising one file | Sonnet 5.5 (`sonnet`) | medium | Anthropic: move down to Sonnet or Haiku when a task is simpler |
| A mechanical step: a lookup, a listing, reading one value, a format check | Haiku 5.5 (`haiku`) | low | The same guidance |

- The table changes only when newer benchmarks back another pick, or when two or more independent
  trackers that rerun a fixed test on live models show a row's model has dropped. The dream
  workflow's `anthropic` source reads each model launch page and those trackers, and proposes the
  row as it would read, with the scores behind it.

## Stepping down

- At the prompt that starts a task, the session also reads the plan's limits with `get_usage` and
  pipes the result as it came to `~/.claude/skills/models/pace.sh`, which prints what the 5-hour
  limit and each weekly limit is on pace for, and a verdict. On `fits` or `unknown` the task runs
  as above. A task that a few tool calls settle runs here whatever the verdict, since a new session
  costs more than it would save.
- On `tight` the task steps down. Its rung is the first in its line of the table below, read from
  the left, whose share is at most the share `pace.sh` printed, and never one below the task's
  floor. When the limit that binds is the weekly Fable one, only a rung on another model counts. A
  task whose floor costs more than the printed share takes the floor, and the reply says the limit
  is still on pace to fill.
- The floor is the least a task gets away with. Software that is hard or open, such as a cause not
  yet found, a design decision or a change across layers, stops at Fable 5.2 high, level with Opus
  5.5's best score. Software whose prompt names the files and the done state stops at Fable 5.2
  medium, or at Opus 5.5 high when the Fable limit binds. An edit the prompt describes exactly, a
  mechanical change or a question about code already in context stops at the Sonnet row of the
  table above, and a lookup at its Haiku row. Any other task stops at the last rung of its line.
- Before any of the task is done, the session asks whether it should run on that rung. The
  next-step box holds the question, with the model and the effort in full, and two buttons: yes,
  and no, stay on this session's own. The closing message gives what `pace.sh` printed for the
  limit that binds, the rung's score and cost per task beside those of this session's own model
  and effort, both from the table, and what the tracker line below says of the rung's model.
- On yes the task goes to a new session on that rung, started with the `model` and `effort` of
  `start_session`, which a step down needs no approval for, and with `context` "fresh". Its prompt
  quotes the user's prompt whole and says the user picked this model and effort for the pace, so
  that session keeps them and asks nothing. A task that leans on this conversation, or on a file
  attached to it, goes to a fork instead, which gets its rung as the second bullet of this skill
  says. On no the task runs as on `fits`. Work a stepped-down session starts takes the rung of its
  own line without another question.
- A stepped-down session that has the context it needs and still gets the task wrong twice says so
  and names the next rung up, which the user picks in the app's model menu.

Each rung gives its score, its cost per task in dollars at API prices, and that cost as a share of
Fable 5.2 at xhigh, the model and effort the user's sessions start on.

| Task | Rungs, strongest first | Benchmark |
|---|---|---|
| Software | Fable 5.2 xhigh 49.1, $14.19, 100%. Fable 5.2 high 45.3, $6.72, 47%. Opus 5.5 xhigh 43.4, $5.18, 37%. Fable 5.2 medium 37.6, $2.48, 17%. Opus 5.5 high 34.5, $2.42, 17%. Opus 5.5 medium 30.1, $1.70, 12% | FrontierCode 2.0 |
| Research | Fable 5.2 xhigh 80.6, $39.84, 100%. Fable 5.2 high 79.3, $29.20, 73%. Fable 5.2 medium 73.6, $15.71, 39%. Fable 5.2 low 71.4, $12.66, 32%. Opus 5.5 xhigh 71.3, $29.25, 73%. Opus 5.5 high 67.3, $17.31, 43%. Opus 5.5 medium 62.8, $11.40, 29% | WANDR |
| Charts, figures and screenshots | Fable 5.2 xhigh 71.4, $0.151, 100%. Fable 5.2 high 69.8, $0.068, 45%. Fable 5.2 medium 66.4, $0.035, 23%. Fable 5.2 low 64.2, $0.031, 21%. Opus 5.5 xhigh 62.4, $0.082, 54%. Opus 5.5 high 59.2, $0.032, 21%. Opus 5.5 medium 59.0, $0.025, 17% | Chartography |
| Everything else | Fable 5.2 xhigh 73.4, $1.48, 100%. Fable 5.2 high 71.5, $0.63, 42%. Fable 5.2 medium 68.6, $0.21, 14%. Fable 5.2 low 68.4, $0.19, 13%. Opus 5.5 xhigh 66.4, $0.69, 47%. Opus 5.5 high 63.9, $0.29, 20%. Opus 5.5 medium 63.0, $0.17, 12% | Humanity's Last Exam with tools |

- Trackers, read on 11 November 2026: none flags a Claude model. NerfBench has Opus 5.5 at 105.8%
  of its launch score, last tested on 16 October, and showed no other Claude model. AIStupidLevel,
  for 12 October to 11 November, gives a coding pass rate of 93% for Opus 5.5, 85% for Fable 5.2
  and 80% for Sonnet 5.5, from 7 bug fixes tried 7 times every 4 hours. MarginLab runs Claude Code
  on Opus 5.5 at high: 77% on the day and 81% over 30 days, with its baseline still being
  collected. IsItNerfed lists no current Claude model.
- The rungs and the tracker line change as the rows do: the dream workflow's `anthropic` source
  proposes each as it would read. A launch page's HTML holds the points of each cost chart as rows
  of series, cost, score and effort, which is where the costs per task come from.

Sources: Claude Fable 5.2 and Mythos 5.2 launch page, 9 November 2026,
[https://www.anthropic.com/claude-fable-and-mythos-5-2](https://www.anthropic.com/claude-fable-and-mythos-5-2),
the model configuration page of the Claude Code docs,
[https://code.claude.com/docs/en/model-config](https://code.claude.com/docs/en/model-config),
Anthropic's post on choosing a model and effort level, 7 July 2026,
[https://www.claude.com/blog/claude-model-and-effort-level-in-claude-code](https://www.claude.com/blog/claude-model-and-effort-level-in-claude-code),
and the trackers:
[https://www.bridgebench.ai/nerf-bench](https://www.bridgebench.ai/nerf-bench),
[https://aistupidlevel.info](https://aistupidlevel.info),
[https://marginlab.ai/trackers/claude-code](https://marginlab.ai/trackers/claude-code) and
[https://isitnerfed.org](https://isitnerfed.org).
