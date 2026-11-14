---
name: models
description: Which Claude model and effort each kind of work runs on, and the cheaper steps down when the limits run short. Load at a prompt that starts software work or any task of more than a few tool calls, before any other step, and before choosing the model or effort of any work a session starts.
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
- No session nests under another. Every brief, a card's too, opens by telling its session to call
  `detach_session` with `self` before any other step, and a session another one started does so
  first, told or not. The session that started one also detaches it in the next message. It then
  reports nothing back, so the reply links it, and a step that needs its result waits for the user
  to say it is done.
- The window layout of the desktop app is the user's. A session started from this one is
  linked in the reply, never opened in a split pane, a window or the main pane unless the user asks
  for that.
- A tool that cannot set the model or effort its row asks for is named in the reply with that row.
- An offer to start a session is a question in the next-step box, never a `start_session` card,
  neither an "own_initiative" proposal nor an "offer": the question names the task with the
  session's model and effort in full, its first button, which one shortcut presses, is the yes,
  and on that yes the session starts it with `start_session` and "user_asked". When the pace is
  `tight`, that one question names the rung Stepping down gives, and its second button keeps this
  session's own model and effort.
- The turn that the yes opens makes `start_session` its first call and `detach_session` its next
  message, before any other step, `get_usage` and loading a skill included. The app posts its
  "moved to top level" banner when the session that calls `detach_session` is not the one on
  screen, and the person who pressed yes may move to another session within seconds. A started
  session that needs another model or effort gets `set_session_model` and `set_session_effort`
  right after the detach, in the same way.
- The reply that asks, like the one that links a session this one started, names that session's
  model and effort and says why they are the best for it: what in its task puts it on its row, and
  what the score or guidance behind the row means for that task, such as that a crash whose cause
  is not yet found is hard software, where Fable 5.2 at high scores above Opus 5.5 at xhigh. The
  reason is written for that session's task, never the row's last cell copied as it stands.
- No row uses max effort: on Fable 5.2 Anthropic keeps it for measuring the model's ceiling, and
  on software work it does worse than xhigh. No row uses Fable 5.2 at xhigh either: the 5-hour
  limit cannot carry it, as What a session costs shows.
- A session cannot switch its own model or effort, so at the prompt that starts a task it reads
  them with `get_session` and `self` and compares its model with the task's row. Software that is
  hard or open, in a session on a cheaper model than Fable 5.2, goes to a new session on its row
  unless the pace is `tight`: started as above, with `context` "fork" so it holds this conversation,
  and with a task that asks it to carry out the user's last prompt there, so the prompt stays the
  user's own in its log and its commits. The reply links that session and says the work goes on
  there, and this session does none of it. A task in a session on a model that costs more than
  its row's, such as a draft or a change with its files named in a session on Fable 5.2, is asked
  about as a step down is, whatever the pace: the question names the row's model and effort, and
  on yes the task goes to a session on them as Stepping down says. Any other task runs on the
  session's model and effort as they are, and the first line of the reply that starts it says so
  in a full sentence of plain words: which model and effort this skill gives that kind of task
  and which the session runs on, such as "This skill gives a question like this to Opus 5.5 at
  xhigh effort, and this session runs on Fable 5.2 at xhigh". No line a reply writes under this
  skill opens with a label before a colon, such as the task's kind, which reads as a question put
  to the user, and none uses this skill's own words row, rung or tight: it names the model, the
  effort and the limit, and says of the limit how full it is and what it is on pace for. A session
  whose opening prompt says the user picked its model and effort for the pace keeps them, as
  Stepping down says. That settles its own model and effort only: it still loads this skill
  before it starts or proposes a session, and its reply names that session's model and effort as
  the bullet above says.

| Task | Model | Effort | Benchmarks behind it |
|---|---|---|---|
| Software that is hard or open: a cause not yet found, a design decision or a change across layers | Fable 5.2 (`fable`) | high | FrontierCode 2.0: 45.3 at high, Opus 5.5 43.4 at xhigh and 45.5 at its best. FrontierSWE v2: 69.9, Opus 5.5 62.3. Fable 5.2 at xhigh scores 49.1 for 2.1 times the cost per task |
| Other software: building, changing, debugging or reviewing code, scripts, hooks, skills and workflows | Opus 5.5 (`opus`) | xhigh | FrontierCode 2.0: 43.4 at xhigh, 1.9 under Fable 5.2 at high for 77% of its cost per task, and 34.5 at high. Anthropic names Opus 5.5 the daily driver for most coding and knowledge tasks |
| Research across many web sources and collecting data from them | Fable 5.2 (`fable`) | medium | WANDR: medium matches Opus 5.5's top score for about 40% of its cost per task |
| Reading charts, figures and screenshots | Fable 5.2 (`fable`) | medium | Chartography: 66.4 at medium, Opus 5.5 64.4 at max, for under a tenth of the cost |
| Everything else: writing, drafts, documents, planning and questions | Opus 5.5 (`opus`) | xhigh | Humanity's Last Exam with tools: 66.4 at xhigh, 63.9 at high, and 67.7 at max for three times the cost per task |
| A bounded step that needs judgement, such as summarising one file | Sonnet 5.5 (`sonnet`) | medium | Anthropic: move down to Sonnet or Haiku when a task is simpler |
| A mechanical step: a lookup, a listing, reading one value, a format check | Haiku 5.5 (`haiku`) | low | The same guidance |

- The table changes only when newer benchmarks back another pick, or when two or more independent
  trackers that rerun a fixed test on live models show a row's model has dropped. The dream
  workflow's `anthropic` source reads each model launch page and those trackers, and proposes the
  row as it would read, with the scores behind it.

## What a session costs

- The rows are the strongest picks the plan's 5-hour limit carries through a working day, counted
  on 12 November 2026 from the transcripts under `~/.claude/projects` at API list prices. That
  limit holds about $108 of Fable 5.2. A window filled in 3 hours 30 minutes with 13 sessions and
  473 responses, every one on Fable 5.2, 312 at xhigh and 161 at high after a step down. Cache
  writes were 48% of its cost, output 34% and cache reads 18%.
- The model sets what a response costs, and the effort sets little of it: two thirds of the cost
  is the context each response carries, which is priced by the model. Per response since 9
  November 2026, Fable 5.2 cost $0.235 at xhigh over 1,204 responses and $0.198 at high over 621,
  and Opus 5.5 cost $0.090 at xhigh over 6,531. A lower effort ends a task in fewer responses,
  which is the saving a benchmark's cost per task shows, but each response costs nearly the same,
  so the limit fills almost as fast. A step down therefore changes the model, and no session is
  started only to lower the effort on the model it already runs on.
- A new session writes its context again before its task starts: about 65,000 tokens beyond the
  shared prompt, $1.04 on Fable 5.2 and $0.52 on Opus 5.5. Such writes, at a session's start and
  after its cache went cold, were 21% of the window that filled. So a task moves to another
  session only for another model, and never when a few tool calls settle it.
- The user's sessions on the Mac start on Fable 5.2 at xhigh, which the user keeps: `start_session`
  takes only a model and effort at or below the session's own, so a session there can start one on
  any row without an approval. Such a session reads the task, asks as the bullet on a session's own
  model says and hands the task on. It does none of the task first, since each of its responses
  costs the most. On the Linux desktop, whose account is on the Pro plan, they start on Opus 5.5 at
  xhigh, as every desktop session there since 12 November 2026 did, so on `tight` the step down
  there is the one to Sonnet 5.5 that Stepping down gives.

## Stepping down

- At every prompt that starts a task, one that a few tool calls settle too, the session reads the
  plan's limits with `get_usage` before any other step but the start and detach that a yes to an
  offer of a session makes first, and pipes the result as it came to
  `~/.claude/skills/models/pace.sh`, which prints what the 5-hour limit and each weekly limit is
  on pace for, and a verdict. On `fits` or `unknown` the task runs as above. A task that a few tool
  calls settle runs here whatever the verdict, since a new session costs more than it would save,
  and on `tight` its reply still gives what `pace.sh` printed for the limit that binds.
- On `tight` no work starts on Fable 5.2, apart from research and chart reading, whose benchmarks
  put every Opus 5.5 rung at a higher cost per task or far below. A session's own task steps down
  by model, which sets what a response costs: software that is hard or open runs on Opus 5.5 at
  xhigh, 1.9 points under its row, at 38% of Fable 5.2's cost per response, and stays in a session
  that is on Opus 5.5 already. Other software and everything else run on Sonnet 5.5 at xhigh,
  within 5 points or 34 Elo of Opus 5.5 at xhigh on the four charts of the second table and at
  about 70% of its cost per task, so about 27% of Fable 5.2's. When the share `pace.sh` printed is
  under the rung's share of the session's own cost, the reply says the limit is still on pace to
  fill.
- A session on Sonnet 5.5 or a cheaper model keeps its own task whatever the verdict, and so does
  one on Opus 5.5 whose task is software that is hard or open, research or chart reading. On
  `tight` its reply says so with what `pace.sh` printed for the limit that binds.
- Work a session starts while the pace is `tight`, such as a subagent, a workflow agent or a new
  session, takes the second rung of its line: Opus 5.5 at xhigh for software that is hard or open,
  Opus 5.5 at high for other software and for everything else, and Fable 5.2 at low for research
  and chart reading, or Opus 5.5 at medium when the limit that binds is the weekly Fable one. The
  Sonnet and Haiku rows stay as they are. It takes that rung without a question of its own, and
  an offer to start a session names it.
- Before any of its own task is done, a session on `tight` whose model costs more than its task's
  rung above, such as one on Fable 5.2 whose task is neither research nor chart reading or one on
  Opus 5.5 whose task is other software or anything else, asks whether the task should run on that
  rung. The next-step box holds the question, with the model and the effort in full, and two
  buttons: yes, and no, stay on this session's own. The closing message gives what `pace.sh`
  printed for the limit that binds, the rung's score and cost per task beside those of this
  session's own model and effort, from the table that holds both, the cost per response of both
  where What a session costs gives it, and what the tracker line below says of the rung's model.
- On yes the task goes to a new session on that rung, started with the `model` and `effort` of
  `start_session`, which a step down needs no approval for, and with `context` "fresh". Its prompt
  quotes the user's prompt whole and says the user picked this model and effort for the pace, so
  that session keeps them and asks nothing. A task that leans on this conversation, or on a file
  attached to it, goes to a fork instead, which gets its rung as the second bullet of this skill
  says. On no the task runs as on `fits`.
- A stepped-down session that has the context it needs and still gets the task wrong twice says so
  and names the next rung up, which the user picks in the app's model menu.

The first table gives the score of each model and effort, its cost per task in dollars at API
prices, and that cost as a share of Fable 5.2 at xhigh. A benchmark runs its task in a small
context, so its share between two models holds in the user's sessions, where Opus 5.5 at xhigh
costs 38% of Fable 5.2 at xhigh per response, and its share between two efforts of one model does
not: Fable 5.2 at high costs 84% of xhigh per response, not 47%.

| Task | Score and cost per task, strongest first | Benchmark |
|---|---|---|
| Software | Fable 5.2 xhigh 49.1, $14.19, 100%. Fable 5.2 high 45.3, $6.72, 47%. Opus 5.5 xhigh 43.4, $5.18, 37%. Fable 5.2 medium 37.6, $2.48, 17%. Opus 5.5 high 34.5, $2.42, 17%. Opus 5.5 medium 30.1, $1.70, 12% | FrontierCode 2.0 |
| Research | Fable 5.2 xhigh 80.6, $39.84, 100%. Fable 5.2 high 79.3, $29.20, 73%. Fable 5.2 medium 73.6, $15.71, 39%. Fable 5.2 low 71.4, $12.66, 32%. Opus 5.5 xhigh 71.3, $29.25, 73%. Opus 5.5 high 67.3, $17.31, 43%. Opus 5.5 medium 62.8, $11.40, 29% | WANDR |
| Charts, figures and screenshots | Fable 5.2 xhigh 71.4, $0.151, 100%. Fable 5.2 high 69.8, $0.068, 45%. Fable 5.2 medium 66.4, $0.035, 23%. Fable 5.2 low 64.2, $0.031, 21%. Opus 5.5 xhigh 62.4, $0.082, 54%. Opus 5.5 high 59.2, $0.032, 21%. Opus 5.5 medium 59.0, $0.025, 17% | Chartography |
| Everything else | Fable 5.2 xhigh 73.4, $1.48, 100%. Fable 5.2 high 71.5, $0.63, 42%. Fable 5.2 medium 68.6, $0.21, 14%. Fable 5.2 low 68.4, $0.19, 13%. Opus 5.5 xhigh 66.4, $0.69, 47%. Opus 5.5 high 63.9, $0.29, 20%. Opus 5.5 medium 63.0, $0.17, 12% | Humanity's Last Exam with tools |

The second table gives Sonnet 5.5 beside Opus 5.5 from the Sonnet 5.5 launch page, whose charts
leave out Fable 5.2, with each cost per task as a share of Opus 5.5 at xhigh. On Humanity's Last
Exam with tools that page gives Sonnet 5.5 64.5 and Opus 5.5 67.7, with no effort or cost.

| Task | Score and cost per task, strongest first | Benchmark |
|---|---|---|
| Software | Opus 5.5 xhigh 66.4, $7.35, 100%. Opus 5.5 high 64.2, $3.88, 53%. Sonnet 5.5 xhigh 61.5, $5.30, 72%. Opus 5.5 medium 57.6, $2.94, 40%. Sonnet 5.5 high 43.0, $1.94, 26%. Sonnet 5.5 medium 28.8, $0.83, 11% | Terminal-Bench 4.0 |
| Software | Opus 5.5 medium 54.6, $0.80, 36%. Opus 5.5 high 54.0, $1.09, 48%. Sonnet 5.5 xhigh 52.1, $1.59, 71%. Opus 5.5 xhigh 51.4, $2.25, 100%. Sonnet 5.5 high 49.4, $0.42, 19%. Sonnet 5.5 medium 36.5, $0.24, 11% | FrontierCode 1.1, main set |
| Software | Opus 5.5 xhigh 56.0, $6.98, 100%. Opus 5.5 high 56.0, $3.97, 57%. Sonnet 5.5 xhigh 53.1, $3.88, 56%. Opus 5.5 medium 52.5, $2.91, 42%. Sonnet 5.5 high 47.8, $1.67, 24%. Sonnet 5.5 medium 39.2, $0.70, 10% | CursorBench 4.0 |
| Everything else | Opus 5.5 xhigh 1780, $12.27, 100%. Sonnet 5.5 xhigh 1746, $9.63, 79%. Opus 5.5 high 1705, $6.27, 51%. Opus 5.5 medium 1642, $4.40, 36%. Sonnet 5.5 high 1634, $3.95, 32%. Sonnet 5.5 medium 1461, $1.64, 13% | AA-Briefcase v1.1, Elo |

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
the Claude Sonnet 5.5 launch page, 28 September 2026,
[https://www.anthropic.com/news/claude-sonnet-5-5](https://www.anthropic.com/news/claude-sonnet-5-5),
the model configuration page of the Claude Code docs,
[https://code.claude.com/docs/en/model-config](https://code.claude.com/docs/en/model-config),
Anthropic's post on choosing a model and effort level, 7 July 2026,
[https://www.claude.com/blog/claude-model-and-effort-level-in-claude-code](https://www.claude.com/blog/claude-model-and-effort-level-in-claude-code),
and the trackers:
[https://www.bridgebench.ai/nerf-bench](https://www.bridgebench.ai/nerf-bench),
[https://aistupidlevel.info](https://aistupidlevel.info),
[https://marginlab.ai/trackers/claude-code](https://marginlab.ai/trackers/claude-code) and
[https://isitnerfed.org](https://isitnerfed.org).
