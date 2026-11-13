// Runs dream.js against the simulation in run.mjs and checks how each mode spends and stops.
// Usage: node test/dream-sim/checks.mjs [path to dream.js]
import { HISTORY, loadWorkflow, simulate } from './run.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

const wf = await loadWorkflow(process.argv[2] || new URL('../../workflows/dream.js', import.meta.url).pathname)
const workAt = Date.parse('2026-10-17T05:00:00Z')
const reset = Date.parse('2026-10-17T13:59:59Z')
const noHits = ['no agent reaches a limit and fails', st => st.hits === 0]
const sat = { five: 8, fiveReset: '2026-10-17T10:00:00Z', weekReset: '2026-10-17T13:59:59Z', now: '2026-10-17T07:00:00Z', since: '2026-10-16T22:00:00Z' }
const fri = { five: 10, fiveReset: '2026-10-16T16:49:59Z', weekReset: '2026-10-17T13:59:59Z', now: '2026-10-16T15:10:00Z', since: '2026-10-14T00:00:00Z' }
const wed = { five: 5, fiveReset: '2026-10-14T21:00:00Z', weekReset: '2026-10-17T13:59:59Z', now: '2026-10-14T18:00:00Z', since: '2026-10-13T18:00:00Z' }
// The final run of 31 Oct: 13:12 local, the 5-hour limit at 70% until 14:00, the week at 73% until 16:00, and 13 open proposals whose checks the reserve keeps room for.
const oct31 = { five: 70, fiveReset: '2026-10-31T12:00:00Z', week: 73, weekReset: '2026-10-31T14:00:00Z', now: '2026-10-31T11:12:00Z', since: '2026-10-30T20:14:00Z', utcOffset: '+0200', sessions: 200, backlog: {
  valid: true,
  open: Array.from({ length: 13 }, (_, i) => ({ key: `2026-10-30-n${i + 1}`, title: `open ${i + 1}`, kind: 'hook', impact: 'medium', target: '~/x', firstSeen: '2026-10-30', lastSeen: '2026-10-30', scriptFile: '' })),
  closed: [],
  unchecked: [],
} }
const waited = st => st.started.some(s => / after the \d\d:\d\d reset$/.test(s.label))
const stopped = r => (r.verification || {}).stoppedBy || ''
// The final run of 31 Oct from its checks on: twelve checks of about six minutes start at 13:48 local, the backlog writes take a minute each, and the fit check of the third runs 81 minutes.
const quick = { evidence: 3, fit: 6, backlog: 1, write: 1 }
// The backlog writes and the run record as long as they took in the real runs of 30 and 31 Oct.
const tail = { backlog: 2, write: 1, record: 2 }
const oct31slow = { five: 10, fiveReset: '2026-10-31T15:00:00Z', week: 60, weekReset: '2026-10-31T14:00:00Z', now: '2026-10-31T10:55:00Z', since: '2026-10-30T20:14:00Z', utcOffset: '+0200', sessions: 0, args: { only: ['rules'] }, minutes: { ...quick, 'fit rules: Commands a': 81 } }
const scriptsAt = st => (st.started.find(s => /^scripts /.test(s.label)) || {}).at
const allScripts = (r, n) => r.plan.length === n && r.plan.every(p => p.endsWith(' runs'))
// A final run on 31 Oct that ends as the real one did, at 15:17 after the 14:45 cutoff, with work dropped for a 5-hour limit that reopens at 14:40.
const oct31late = { ...oct31, five: 50, fiveReset: '2026-10-31T12:40:00Z', now: '2026-10-31T10:26:00Z' }
// The JSON the report agent's prompt gives under a heading such as Pace or Agents.
const block = (st, head) => { const p = (st.prompts.report || '').split(`\n${head}, as JSON`)[1]; return p ? JSON.parse(p.split('\n')[1]) : {} }
// Weekly readings as the dream runs wrote them: the week to 31 Oct went from 61% at the eve run to 77% at the final run, which spent 4 points itself, so the user spent 12.
const weekRow = (mode, weekEnds, readAt, used, dreamSpent) => JSON.stringify({ weekEnds, readAt, runId: readAt.slice(0, 10), mode, windows: [{ label: 'Weekly · all models', percentUsed: used }], dreamSpent })
const weekRows = [
  weekRow('final', '2026-10-17T13:59:59.698Z', '2026-10-17T12:30:04Z', 92, 24),
  weekRow('eve', '2026-10-24T13:59:59.981Z', '2026-10-23T22:32:25.000Z', 50, 13),
  weekRow('final', '2026-10-24T14:00:00.111Z', '2026-10-24T07:51:56.000Z', 65, 9),
  weekRow('eve', '2026-10-31T14:00:00.454Z', '2026-10-30T20:14:32.000Z', 61, 8),
  weekRow('final', '2026-10-31T13:59:59.794Z', '2026-10-31T13:15:33.000Z', 77, 4),
]
// Merges the backlog patch a run wrote into sc.backlog with its own merge.jq, as the write backlog agent does.
const between = (p, head) => (p.split(`${head} <<'EOF'\n`)[1] || '').split('\nEOF')[0]
const mergedBacklog = (st, sc) => {
  const p = st.prompts['backlog patch'] || ''
  const dir = fs.mkdtempSync(`${os.tmpdir()}/dream-sim-`)
  fs.writeFileSync(`${dir}/full.json`, JSON.stringify({ ...JSON.parse(between(p, 'patch.json') || '{}'), addOpen: [], addUnchecked: [] }))
  fs.writeFileSync(`${dir}/merge.jq`, between(p, 'merge.jq'))
  fs.writeFileSync(`${dir}/backlog.json`, JSON.stringify(sc.backlog))
  const out = spawnSync('jq', ['--slurpfile', 'p', `${dir}/full.json`, '-f', `${dir}/merge.jq`, `${dir}/backlog.json`], { encoding: 'utf8' })
  fs.rmSync(dir, { recursive: true })
  return out.status === 0 ? JSON.parse(out.stdout) : { open: [], closed: [] }
}
const onPr = (key, waitsOn, more = {}) => ({ key, title: key, kind: 'hook', impact: 'high', target: '~/x', firstSeen: '2026-10-10', lastSeen: '2026-10-10', scriptFile: '', ...(waitsOn ? { waitsOn } : {}), ...more })
const prRun = { ...wed, week: 30, sessions: 4, backlog: {
  valid: true,
  open: [onPr('merged', 'o/r#1'), onPr('pending', 'o/r#2'), onPr('unmerged', 'o/r#3'), onPr('unknown', 'o/r#4'), onPr('plain')],
  closed: [],
  unchecked: [],
}, checks: [
  { key: 'merged', status: 'applied', note: 'o/r#1 merged' },
  { key: 'pending', status: 'waiting', note: 'o/r#2 is open' },
  { key: 'unmerged', status: 'open', note: 'o/r#3 closed unmerged, issue o/r#9 took its place' },
  { key: 'plain', status: 'open', note: 'not in place' },
] }
const nov6 = { five: 10, fiveReset: '2026-11-06T18:00:00Z', weekReset: '2026-11-07T14:00:00Z', now: '2026-11-06T16:00:00Z', since: '2026-11-05T20:00:00Z', utcOffset: '+0200', week: 50, sessions: 48 }
// A usage history row of a run that read the battery logs at the given time.
const ranBattery = time => JSON.stringify({ date: time.slice(0, 10), time, model: 'claude-opus-5-5', effort: 'xhigh', ledger: {}, sources: ['battery'] })
const battery = st => st.prompts.battery || ''
// The same for a run that read the Finnish the sessions wrote.
const ranFinnish = time => JSON.stringify({ date: time.slice(0, 10), time, model: 'claude-opus-5-5', effort: 'xhigh', ledger: {}, sources: ['finnish'] })
const finnish = st => st.prompts['finnish terms'] || ''
// A usage history row whose run carried one transcript over, and the row a simulated run records.
const carried = (time, more = {}) => JSON.stringify({ date: time.slice(0, 10), time, model: 'claude-opus-5-5', effort: 'xhigh', ledger: {}, sources: ['transcripts'], pending: [{ path: '/t/carried.jsonl', project: 'p', bytes: 1e6, mtime: time, from: '2026-10-12T00:00:00Z' }], ...more })
const recorded = st => ({ pending: [], ...JSON.parse(st.historyLine || '{}') })
// A second machine with a plan of its own, whose week resets on Fridays at 07:00 local, before the work day: nobody watches its runs, and its sessions read the limits from the status line's file.
const fridayReset = Date.parse('2026-11-13T05:00:00Z')
const fridayWork = Date.parse('2026-11-13T06:00:00Z')
const thu = { five: 0, fiveReset: '2026-11-12T10:00:00Z', week: 5, weekReset: '2026-11-13T05:00:00Z', now: '2026-11-12T14:30:00Z', since: '2026-11-05T14:30:00Z', utcOffset: '+0200', machine: 'desk', sessions: 400, args: { unattended: true } }
const friday = { ...thu, five: 3, fiveReset: '2026-11-13T07:00:00Z', week: 63, now: '2026-11-13T04:50:00Z', sessions: 10 }
// A record line as one machine wrote it.
const on = (machine, line) => JSON.stringify({ ...JSON.parse(line), machine })
const weekLine = st => JSON.parse(st.weekLine || '{}')
const readings = st => Object.entries(st.prompts).filter(([k]) => /^usage \d/.test(k))
const marker = JSON.stringify({ machine: 'desk', runId: '2026-10-14', started: '2026-10-14T13:30:00Z', alive: '2026-10-14T17:48:00Z', aliveEpoch: 1 })
// Work the pool starts, as against readings, listings and the scout.
const work = s => /^(transcripts|prompt feedback|config|github|battery)( |$)/.test(s.label)

const scenarios = [
  ['eve, real numbers', { ...fri, week: 54, sessions: 48 }, [
    ['mode is eve', (st, r) => r.mode.startsWith('eve')],
    ['the session is told to show only the points the run used', (st, r) => /show in the chat only how many percentage points/.test(r.forTheSession) && /get_usage/.test(r.forTheSession) && !/show all of it/.test(r.forTheSession)],
    ['weekly stays under 95 minus the reserve, plus a point', st => st.maxWeek <= 95 - 2 * 16.9 + 1],
    ['no window the run touched is open at 08:00 Saturday', st => !st.windows.some(([a, b]) => a <= workAt && workAt < b && st.lastUse >= a)],
    noHits,
  ]],
  ['eve, big budget', { ...fri, week: 10, since: '2026-10-10T00:00:00Z', sessions: 400 }, [
    ['no window the run touched is open at 08:00 Saturday', st => !st.windows.some(([a, b]) => a <= workAt && workAt < b && st.lastUse >= a)],
    noHits,
  ]],
  ['eve after 31 Oct', { ...nov6, weekLines: weekRows }, [
    ['mode is eve', (st, r) => /^eve/.test(r.mode)],
    ['keeps back the 12 points the user spent outside dream runs on 31 Oct, 77 less 61 less 4', (st, r) => /keeps 12\.0 weekly points back/.test(r.mode)],
    ['records them as the reserve of its row in the usage history', st => /"mode":"eve".*"reserve":12,/.test(st.historyLine || '')],
    ['weekly stays under 95 minus that reserve, plus a point', st => st.maxWeek <= 95 - 12 + 1],
    noHits,
  ]],
  ['eve with no final run in the readings', { ...nov6, weekLines: weekRows.filter(l => !l.includes('"final"')) }, [
    ['falls back to two 5-hour windows', (st, r) => /keeps 33\.8 weekly points back/.test(r.mode) && /"reserve":33\.8,/.test(st.historyLine || '')],
  ]],
  ['eve with keep: 1', { ...nov6, weekLines: weekRows, args: { keep: 1 } }, [
    ['keeps the one 5-hour window asked for instead', (st, r) => /keeps 16\.9 weekly points back/.test(r.mode) && /"reserve":16\.9,/.test(st.historyLine || '')],
  ]],
  ['final, little work', { ...sat, week: 64, sessions: 6, minutes: tail }, [
    ['mode is final', (st, r) => r.mode.startsWith('final')],
    ['nothing used after the weekly reset', st => st.afterWeekReset === 0],
    ['the session is told to show only the points the run used, leaving the report to the review', (st, r) => /show in the chat only how many percentage points/.test(r.forTheSession) && !/show all of it/.test(r.forTheSession)],
    ['with a row for every limit, the Fable one too, in the chat and the report', (st, r) => /a table with a row per limit and the columns/.test(r.forTheSession) && !/but the Fable one/.test(r.forTheSession) && /Weekly · Fable/.test(st.prompts.report || '')],
    ['the report is asked to stay near 4,000 characters, the setup changes and coverage in a line each', st => /at most about 2,500 characters/.test(st.prompts.report || '') && /one line per impact level naming its ids, such as "High: p1, p2, p4\. Medium: p3, p5\.", and nothing else/.test(st.prompts.report || '') && /7\. Coverage: one line:/.test(st.prompts.report || '') && !/every open proposal in plan order/.test(st.prompts.report || '')],
    ['and to add the tokens and dollars the run spent to the report file', (st, r) => /usage\.sh --run/.test(r.forTheSession) && /the dollars at API list prices/.test(r.forTheSession) && /under a heading Cost/.test(r.forTheSession)],
    ['and last week and this week of all sessions, from reset to reset', (st, r) => /usage\.sh --since 2026-10-03T13:59:59\.000Z 2026-10-10T13:59:59\.000Z/.test(r.forTheSession) && /under a heading Week/.test(r.forTheSession)],
    ['and where the run stopped, from the usage card', (st, r) => /section headed Where the run stopped/.test(r.forTheSession) && /get_usage/.test(r.forTheSession)],
    noHits,
  ]],
  ...[80, 88, 93, 97].map(week => [`final, weekly at ${week}`, { ...sat, week, sessions: 200 }, [
    ['weekly never passes 99.5', st => st.maxWeek <= 99.5],
    ['last use before the reset', st => st.lastUse < reset],
    noHits,
  ]]),
  ['final of 31 Oct, 5-hour limit at 70% until 14:00', oct31, [
    ['mode is final', (st, r) => /^final/.test(r.mode)],
    ['waits for the 14:00 reset instead of dropping the work', st => st.started.some(s => s.label.endsWith(' after the 14:00 reset'))],
    ['starts the work after the reset and before the 14:45 cutoff', st => {
      const read = st.started.filter(s => s.label.startsWith('transcripts '))
      return read.length > 0 && read.every(s => s.at >= Date.parse('2026-10-31T12:00:00Z') && s.at < Date.parse('2026-10-31T12:45:00Z'))
    }],
    ['skips what is left as too close to the weekly reset, not for the 5-hour limit', (st, r) => /as the weekly reset is too close/.test(stopped(r)) && !/5-hour/.test(stopped(r))],
    noHits,
  ]],
  ['final of 31 Oct, had the 5-hour limit reset at 15:00', { ...oct31, five: 40, fiveReset: '2026-10-31T13:00:00Z' }, [
    ['drops the work it could not finish before the cutoff after the reset', (st, r) => /as no room left under the 5-hour limit/.test(stopped(r))],
    ['without waiting for that reset', st => !waited(st)],
    noHits,
  ]],
  ['final of 31 Oct, one check far slower than the rest', oct31slow, [
    ['carries the slow check over unchecked, as ran past 30 minutes', (st, r) => r.unchecked === 1 && /^1 pieces of work skipped as ran past 30 minutes( The \d+ weekly points left lapse|$)/.test(stopped(r)) && !r.plan.some(p => p.includes('-w3)'))],
    ['starts the scripts step for the other 11 before the 14:45 cutoff', (st, r) => scriptsAt(st) < Date.parse('2026-10-31T12:45:00Z') && allScripts(r, 11)],
    ['once the slow check has run 30 minutes, not before', st => scriptsAt(st) >= st.started.find(s => s.label === 'fit rules: Commands a').at + 30 * 60000],
    noHits,
  ]],
  ['final of 31 Oct, the slow check the last to start', { ...oct31slow, now: '2026-10-31T10:35:00Z', minutes: { ...quick, 'fit rules: Memory a': 81 } }, [
    ['a timer lets it go, since no reading comes while it runs alone', (st, r) => st.labels.timer > 0 && r.unchecked === 1 && /ran past 30 minutes/.test(stopped(r))],
    ['and the scripts step starts for the others before the 14:45 cutoff', (st, r) => scriptsAt(st) < Date.parse('2026-10-31T12:45:00Z') && allScripts(r, 11)],
    ['the report gets the most agents each phase ran at once', st => { const a = block(st, 'Agents'); return a.pool === 7 && (a.mostAtOnce || {}).Scout === 1 && a.mostAtOnce.Weekly === 7 }],
    ['and the slow check as released, not waited on, after it ran alone', st => (block(st, 'Agents').alone || []).some(s => s.agent === 'fit rules: Memory a' && s.released && /^released after 30 minutes/.test(s.why) && s.minutes > 10)],
    ['and is asked for those lines and the pace line under Usage', st => /one line per phase with the most agents it ran at once/.test(st.prompts.report || '') && /one line on pace/.test(st.prompts.report || '')],
    noHits,
  ]],
  ['final of 31 Oct, the last check alone for 25 minutes', { ...oct31slow, now: '2026-10-31T10:35:00Z', minutes: { ...quick, 'fit rules: Memory a': 25 } }, [
    ['the report gets the stretch and why the run waited on it', st => (block(st, 'Agents').alone || []).some(s => s.agent === 'fit rules: Memory a' && !s.released && s.why === 'the scripts step waits for every proposal check' && s.minutes > 10)],
    noHits,
  ]],
  ['final of 31 Oct, ending at 15:17 after the 14:45 cutoff', oct31late, [
    ['dropped work for a 5-hour limit that reopens before the cutoff, and ended after it', (st, r) => /as no room left under the 5-hour limit/.test(stopped(r)) && st.now > Date.parse('2026-10-31T12:45:00Z')],
    ['offers no new run and says the points left lapse at the 16:00 reset', (st, r) => !/another \/dream/.test(stopped(r)) && /\d+ weekly points left lapse at the 16:00 reset, and no new run can start work before then/.test(stopped(r))],
    ['gives the report its pace: what it had to spend at its start did not fit before 14:45', st => { const p = block(st, 'Pace'); return p.cutoff === '14:45' && p.fitsAtThatPace === false && p.perHour > 0 && p.pool === 7 }],
    noHits,
  ]],
  ['final of 7 Nov, started at 15:00 after the 14:35 cutoff', { five: 12, fiveReset: '2026-11-07T15:20:00Z', week: 83, weekReset: '2026-11-07T14:00:00Z', now: '2026-11-07T13:00:44Z', since: '2026-10-31T11:14:25Z', utcOffset: '+0200', sessions: 154 }, [
    ['stops on the usage card before the scout and names the reset', (st, r) => !st.labels.scout && /stopped before its scout/.test(r.error || '') && /resets today at 16:00, and a run started after 14:35 can start no work/.test(r.error)],
  ]],
  ['final of 7 Nov, started at 14:30 before the cutoff', { five: 12, fiveReset: '2026-11-07T15:20:00Z', week: 83, weekReset: '2026-11-07T14:00:00Z', now: '2026-11-07T12:30:00Z', since: '2026-10-31T11:14:25Z', utcOffset: '+0200', sessions: 20 }, [
    ['runs its scout', (st, r) => st.labels.scout === 1 && !/stopped before its scout/.test(r.error || '')],
  ]],
  ['night of 31 Oct, stopped by the 5-hour limit with time to spare',{ ...oct31, args: { mode: 'night' }, now: '2026-10-31T07:00:00Z', five: 60, fiveReset: '2026-10-31T09:00:00Z', week: 50 }, [
    ['offers another run from its end until the last start before the 14:45 cutoff', (st, r) => /another \/dream after \d\d:\d\d local time and before 14:34 can spend them/.test(stopped(r))],
    noHits,
  ]],
  ['night, stopped by the 5-hour window', { ...wed, five: 60, week: 30, sessions: 200 }, [
    ['says when another run could spend the rest', (st, r) => /another \/dream after/.test(r.verification.stoppedBy)],
    ['and drops the work instead of waiting into the morning', st => !waited(st)],
  ]],
  ['night', { ...wed, week: 30, sessions: 20 }, [
    ['mode is night', (st, r) => r.mode.startsWith('night')],
    ['no deep, subagents or brief', st => !st.labels.deep && !st.labels.subagents && !st.labels.monday],
    noHits,
  ]],
  ['night, weekly resets mid-run', { ...wed, week: 30, sessions: 120, weekJumpAt: '2026-10-14T19:00:00Z' }, [
    ['stops starting work after the reset', (st, r) => r.skipped > 0],
  ]],
  ['day', { ...wed, args: { mode: 'day' }, now: '2026-10-14T09:00:00Z', five: 60, fiveReset: '2026-10-14T12:00:00Z', week: 30, sessions: 40 }, [noHits]],
  ['usage unreadable', { ...wed, unreadable: true, week: 30, sessions: 8 }, [
    ['falls back to night', (st, r) => r.mode.startsWith('night')],
  ]],
  ['carried and parked backlog', { ...wed, week: 30, sessions: 4, backlog: {
    valid: true,
    open: [
      { key: 'parked', title: 'parked', kind: 'hook', impact: 'high', target: '~/x', firstSeen: '2026-10-10', lastSeen: '2026-10-10', scriptFile: '', askAgainAfter: '2026-10-20' },
      { key: 'due', title: 'due', kind: 'hook', impact: 'high', target: '~/y', firstSeen: '2026-10-10', lastSeen: '2026-10-10', scriptFile: '', askAgainAfter: '2026-10-12' },
    ],
    closed: [],
    unchecked: [{ key: 'old-n1', title: 'old one', kind: 'hook', impact: 'high', target: '~/z', firstSeen: '2026-10-10' }],
  } }, [
    ['the parked item stays out of the plan', (st, r) => !r.plan.some(p => p.includes('(parked)'))],
    ['the due item is in the plan', (st, r) => r.plan.some(p => p.includes('(due)'))],
    ['the carried unchecked one is checked by reading it from the backlog', st => /Read its whole text first with jq '\.unchecked\[\] \| select\(\.key == "old-n1"\)'/.test(st.prompts['fit old one'] || '')],
    ['the fit check asks for the exact change and both examples', st => /exactChange/.test(st.prompts['fit old one'] || '') && /exampleFixed/.test(st.prompts['fit old one'] || '')],
    ['the patch carries the examples', st => /"exampleWrong":"it broke"/.test(st.prompts['backlog patch'] || '') || Object.keys(st.prompts).some(k => k.startsWith('backlog items') && /"exampleWrong":"it broke"/.test(st.prompts[k]))],
    ['the session is told to show only the points the run used', (st, r) => /show in the chat only how many percentage points/.test(r.forTheSession) && /get_usage/.test(r.forTheSession) && !/Where the run stopped/.test(r.forTheSession)],
    ['and to add the energy to the report file without showing it', (st, r) => /usage\.sh --run/.test(r.forTheSession) && /Show none of it in the chat/.test(r.forTheSession) && !/the dollars at API list prices/.test(r.forTheSession)],
    ['and no week of all sessions, which only a final run adds', (st, r) => !/usage\.sh --since/.test(r.forTheSession)],
    ['and leaves the evals to the review', (st, r) => !/evals\.mjs/.test(r.forTheSession)],
    ['and leaves the steps to a dream review in a new session in the checkout', (st, r) => /\d+ proposals and the report wait for dream review/.test(r.forTheSession) && r.forTheSession.includes('start a new session in ~/Projects/setup and type "dream review" there') && !/one step per message/.test(r.forTheSession)],
  ]],
  ['backlog steps carried out as pull requests', prRun, [
    ['the check reads each pull request with gh pr view', st => /run gh pr view number --repo owner\/repo --json state,mergedAt/.test(st.prompts['backlog check'] || '') && st.prompts['backlog check'].includes('"waitsOn":"o/r#2"')],
    ['a step whose pull request merged closes as applied', st => mergedBacklog(st, prRun).closed.some(i => i.key === 'merged' && /^applied: /.test(i.reason))],
    ['steps whose pull request is open, or that no check reached, stay open with their pull request', st => { const open = mergedBacklog(st, prRun).open; return open.map(i => `${i.key} ${i.waitsOn || ''}`).join() === 'pending o/r#2,unmerged o/r#3,unknown o/r#4,plain ' }],
    ['and stay out of the plan', (st, r) => !r.plan.some(p => /\((pending|unknown|merged)\)/.test(p)) && r.plan.some(p => p.includes('(plain)'))],
    ['a step whose pull request closed unmerged is in the plan and marked with what took its place', (st, r) => r.plan.some(p => p.includes('(unmerged)')) && JSON.stringify(mergedBacklog(st, prRun).open.find(i => i.key === 'unmerged').unmerged) === '{"pr":"o/r#3","note":"o/r#3 closed unmerged, issue o/r#9 took its place"}'],
    ['no other step gets that mark', st => mergedBacklog(st, prRun).open.filter(i => i.unmerged).length === 1],
  ]],
  ['review with steps carried out as pull requests', { ...wed, week: 30, sessions: 4, args: 'review', backlog: {
    valid: true,
    open: [
      onPr('pending', 'o/r#2'),
      onPr('unmerged', 'o/r#3', { unmerged: { pr: 'o/r#3', note: 'o/r#3 closed unmerged, issue o/r#9 took its place' } }),
      onPr('again', 'o/r#5', { unmerged: { pr: 'o/r#3', note: 'an earlier pull request' } }),
      onPr('plain'),
    ],
    closed: [],
    unchecked: [],
  } }, [
    ['leaves out each step whose pull request a run has not seen close unmerged', (st, r) => r.due === 2 && r.waitingOnPr === 2 && !/"key":"(pending|again)"/.test(r.forTheSession) && /2 wait for their pull request to merge/.test(r.forTheSession)],
    ['asks about the one that closed unmerged, with what took its place', (st, r) => r.forTheSession.includes('"key":"unmerged"') && r.forTheSession.includes('issue o/r#9 took its place')],
    ['keeps a step carried out as an unmerged pull request open with waitsOn', (st, r) => /keep that one open, with waitsOn set to the pull request as owner\/repo#number/.test(r.forTheSession) && /never apply it unasked/.test(r.forTheSession)],
  ]],
  ['review of the open backlog', { ...wed, week: 30, sessions: 4, args: 'review', backlog: {
    valid: true,
    open: [
      { key: 'low-one', title: 'low', kind: 'hook', impact: 'low', target: '~/a', scriptFile: '~/.claude/dream/x/p9.sh' },
      { key: 'parked', title: 'parked', kind: 'hook', impact: 'high', target: '~/b', scriptFile: '', askAgainAfter: '2026-10-20' },
      { key: 'high-one', title: 'high', kind: 'hook', impact: 'high', target: '~/c', scriptFile: '~/.claude/dream/x/p2.sh' },
    ],
    closed: [],
    unchecked: [{ key: 'u1', title: 'u', kind: 'hook', impact: 'low', target: '~/d' }],
  } }, [
    ['runs one agent and nothing else', st => Object.keys(st.labels).join() === 'review'],
    ['asks about the due steps, high before low', (st, r) => r.due === 2 && r.forTheSession.indexOf('"high-one"') < r.forTheSession.indexOf('"low-one"')],
    ['leaves the parked step out', (st, r) => r.waiting === 1 && !r.forTheSession.includes('"parked"')],
    ['shows the newest report in full first', (st, r) => r.forTheSession.startsWith('Read ~/.claude/dream/2026-10-17.md and show all of it in the chat first')],
    ['then refreshes the evals, before the walk', (st, r) => /evals-checkout\.txt exists/.test(r.forTheSession) && /show its lines in a text block/.test(r.forTheSession) && r.forTheSession.indexOf('evals.mjs --write') < r.forTheSession.indexOf('one step per message')],
    ['uses the one-at-a-time dialogue', (st, r) => /1 open proposals wait/.test(r.forTheSession) && /one step per message/.test(r.forTheSession)],
    ['tests a script in a sandbox before running it', (st, r) => /test it in a sandbox before running it for real/.test(r.forTheSession)],
    ['names the unchecked ones', (st, r) => /1 unchecked proposals wait/.test(r.forTheSession)],
    ['leaves the tokens and dollars of the week out', (st, r) => !/usage\.sh --since/.test(r.forTheSession)],
    ['records the report as shown', (st, r) => r.forTheSession.includes('"2026-10-10T13:59:59.000Z ~/.claude/dream/2026-10-17.md" to ~/.claude/dream/shown.txt')],
  ]],
  ['review from gm in a week that already had its report', { ...wed, week: 30, sessions: 4, args: { review: true, gm: true }, shown: '2026-10-10T13:59:59.000Z ~/.claude/dream/2026-10-10.md' }, [
    ['shows no report, not even one written since, and runs no evals', (st, r) => !/show all of it/.test(r.forTheSession) && !/evals\.mjs/.test(r.forTheSession)],
    ['and says only that no proposal is due', (st, r) => r.forTheSession.startsWith('No open proposal is due')],
  ]],
  ['first review from gm after the weekly reset', { ...wed, week: 30, sessions: 4, args: { review: true, gm: true }, shown: '2026-10-03T13:59:59.000Z ~/.claude/dream/2026-10-03.md' }, [
    ['shows the newest report in full, the Fable limit included', (st, r) => r.forTheSession.startsWith('Read ~/.claude/dream/2026-10-17.md and show all of it') && /its usage and the week's figures included\. Then write/.test(r.forTheSession) && !/leaving out/.test(r.forTheSession)],
    ['records it as shown in this week', (st, r) => r.forTheSession.includes('"2026-10-10T13:59:59.000Z ~/.claude/dream/2026-10-17.md"')],
    ['and refreshes the evals', (st, r) => /evals\.mjs --write/.test(r.forTheSession)],
  ]],
  ['first review from gm after the reset, its report already shown in a review', { ...wed, week: 30, sessions: 4, args: { review: true, gm: true }, shown: '2026-10-03T13:59:59.000Z /srv/dreams/2026-10-17.md' }, [
    ['shows it no second time', (st, r) => !/show all of it/.test(r.forTheSession) && !/evals\.mjs/.test(r.forTheSession)],
  ]],
  ['review typed again after its report was shown, a week later', { ...wed, week: 30, sessions: 4, args: { review: true }, shown: '2026-10-03T13:59:59.000Z /srv/dreams/2026-10-17.md' }, [
    ['shows the report no second time', (st, r) => !/show all of it/.test(r.forTheSession) && !/shown\.txt, replacing/.test(r.forTheSession)],
    ['says no dream ran since it, and shows none of its proposals', (st, r) => r.forTheSession.startsWith('Say in one line that no dream has run since 2026-10-17') && /neither its text nor its proposals/.test(r.forTheSession)],
    ['still refreshes the evals', (st, r) => /evals\.mjs --write/.test(r.forTheSession)],
  ]],
  ['upstreams', { ...wed, week: 30, sessions: 4, args: { only: ['upstreams'] }, upstreams: [
    { upstream: '~/Projects/template', derived: ['~/Projects/app', '~/Projects/app2'], note: '' },
    { upstream: 'o/tool', derived: ['~/Projects/app'], note: 'the CLI the apps run' },
    { upstream: '~/Projects/orphan', derived: [], note: '' },
  ] }, [
    ['one agent per upstream that has derived projects', st => st.labels.upstream === 2 && !st.prompts['upstream ~/Projects/orphan']],
    ['the prompt names every derived project and the note', st => /~\/Projects\/app, ~\/Projects\/app2/.test(st.prompts['upstream ~/Projects/template'] || '') && /the CLI the apps run/.test(st.prompts['upstream o/tool'] || '')],
    ['reads the default branch, never the work tree', st => /never from its work tree/.test(st.prompts['upstream o/tool'] || '')],
    ['the run records the source', st => /"upstreams"/.test(st.historyLine || '')],
  ]],
  ['battery', { ...wed, week: 30, sessions: 4, args: { only: ['battery'] } }, [
    ['one agent reads the battery logs', st => st.labels.battery === 1],
    ['it covers the week before the window when no run read them yet', st => battery(st).includes('Cover 2026-10-06T18:00:00.000Z to 2026-10-14T18:00:00Z')],
    ['it queries copies of PowerLog with its -wal file, never the originals', st => /CurrentPowerlog\.PLSQL with its -wal and -shm files into your scratch folder/.test(battery(st)) && /never the originals/.test(battery(st))],
    ['a system setting it would change is a command for the user, never sudo', st => /kind "habit" with target "habit" and gives the command for the user to run: no session runs sudo/.test(battery(st))],
    ['it ranks sessions and prompts from the energy log', st => /python3 -I ~\/\.claude\/energy\/report\.py --since/.test(battery(st))],
    ['a PowerLog it cannot read, or a stretch the energy log missed, is a finding of high impact', st => /PowerLog could not be read/.test(battery(st)) && /found no samples for a stretch PowerLog shows on battery/.test(battery(st)) && /impact high/.test(battery(st))],
    ['its changes keep the user\'s work as it is', st => /a change that keeps the user's work as it is/.test(battery(st))],
    ['the run records the source', st => /"battery"/.test(st.historyLine || '')],
  ]],
  ['battery read 10 hours ago', { ...wed, week: 30, sessions: 4, extraHistory: [ranBattery('2026-10-14T08:00:00Z')] }, [
    ['is not due yet', (st, r) => !st.labels.battery && r.sources.notDue.includes('battery')],
  ]],
  ['battery read 21 hours ago', { ...wed, week: 30, sessions: 4, extraHistory: [ranBattery('2026-10-13T21:00:00Z')] }, [
    ['is due, and covers the time since that run', st => st.labels.battery === 1 && battery(st).includes('Cover 2026-10-13T21:00:00Z to')],
    ['and gives find that time without milliseconds, which BSD find and bfs reject', st => /-newermt 2026-10-13T21:00:00Z /.test(battery(st))],
  ]],
  ['finnish terms', { ...wed, week: 30, sessions: 4, args: { only: ['finnish'] } }, [
    ['one agent reads the Finnish the sessions wrote', st => st.labels.finnish === 1],
    ['it covers the week before the window when no run read it yet', st => finnish(st).includes('between 2026-10-06T18:00:00.000Z and 2026-10-14T18:00:00Z')],
    ['it reads the glossary first and changes no entry the user set', st => /Read the file whole/.test(finnish(st)) && /none of them is yours to change/.test(finnish(st))],
    ['it lists the transcripts with find, without -L', st => /find ~\/\.claude\/projects\/ -mindepth 2 -maxdepth 2 -type f/.test(finnish(st)) && /without -L/.test(finnish(st))],
    ['the Finnish Wikipedia article\'s title settles a term first, over a second name', st => /stop at the first source that settles it/.test(finnish(st)) && /The Finnish article's title is the word, also over a second name/.test(finnish(st))],
    ['a word only translated software uses is not established', st => /only translated software or scattered pages use is not established/.test(finnish(st))],
    ['a term with no established Finnish word keeps its English one', st => /"Keep the English word" when it found none/.test(finnish(st))],
    ['every new entry goes into one finding for the glossary file', st => /Return one finding of kind "memory" with target ~\/\.claude\/rules\/finnish-terms\.md/.test(finnish(st))],
    ['its requests carry nothing about the user', st => /nothing about the user/.test(finnish(st))],
    ['the run records the source', st => /"finnish"/.test(st.historyLine || '')],
  ]],
  ['finnish terms read 2 days ago', { ...wed, week: 30, sessions: 4, extraHistory: [ranFinnish('2026-10-12T18:00:00Z')] }, [
    ['are not due yet', (st, r) => !st.labels.finnish && r.sources.notDue.includes('finnish')],
  ]],
  ['finnish terms read 8 days ago, asked for alone', { ...wed, week: 30, sessions: 4, args: { only: ['finnish'] }, extraHistory: [ranFinnish('2026-10-06T10:00:00Z')] }, [
    ['cover the time since that run', st => st.labels.finnish === 1 && finnish(st).includes('between 2026-10-06T10:00:00Z and') && /-newermt 2026-10-06T10:00:00Z /.test(finnish(st))],
  ]],
  ['one source asked for alone, after a run that carried a transcript over', { ...wed, week: 30, sessions: 4, args: { only: ['finnish'] }, extraHistory: [carried('2026-10-13T18:00:00Z')] }, [
    ['the scout takes the window start from readTo, and from the time of a line without one', st => /the readTo field of the last line of \S+ when it has one, else that line's time field/.test(st.prompts.scout || '')],
    ['the run hands on the transcript carried to it', st => recorded(st).pending.length === 1 && recorded(st).pending[0].path === '/t/carried.jsonl' && recorded(st).pending[0].from === '2026-10-12T00:00:00Z'],
    ['and the window start it got, under its own time', st => recorded(st).readTo === '2026-10-13T18:00:00Z' && recorded(st).time === '2026-10-14T18:00:00Z'],
  ]],
  ['a second such run', { ...wed, week: 30, sessions: 4, args: { only: ['finnish'] }, extraHistory: [carried('2026-10-14T08:00:00Z', { readTo: '2026-10-13T18:00:00Z', sources: ['battery'] })] }, [
    ['keeps the window start and the transcript of the first', st => recorded(st).readTo === '2026-10-13T18:00:00Z' && recorded(st).pending.length === 1],
  ]],
  ['a run that reads the transcripts', { ...wed, week: 30, sessions: 4 }, [
    ['moves the window start to its own time', st => recorded(st).readTo === '2026-10-14T18:00:00Z' && recorded(st).time === '2026-10-14T18:00:00Z'],
  ]],
  ['symlinked project folders', { ...fri, five: 5, week: 30, sessions: 12, dupes: true }, [
    ['reads each transcript, carried or listed twice, once', st => {
      const read = Object.entries(st.prompts).filter(([k]) => /^(transcripts|deep|subagents) /.test(k)).flatMap(([, p]) => [...p.matchAll(/^- \S+\/(\S+\.jsonl) \(/gm)].map(m => m[1]))
      return read.filter(n => n.startsWith('s')).length === 12 && read.some(n => n.startsWith('o')) && read.some(n => n.startsWith('a')) && new Set(read).size === read.length
    }],
    ['lists with find without -L in every prompt that lists transcripts', st => {
      const listing = Object.entries(st.prompts).filter(([k]) => /^(scout|list older|token waste|config|rules: |transcripts )/.test(k))
      return listing.length > 5 && listing.every(([, p]) => /find ~\/\.claude\/projects\/ -mindepth 2 -maxdepth 2 -type [fd]/.test(p) && /without -L/.test(p))
    }],
  ]],
  ['eve on a machine whose week resets at 07:00, before the work day', thu, [
    ['mode is eve', (st, r) => /^eve/.test(r.mode)],
    ['says that no final run follows, so it also stops 75 minutes before the reset', (st, r) => /That reset comes before 08:00, so no final run follows, and it also stops starting work 75 minutes before the reset/.test(r.mode)],
    ['keeps nothing back while no reset day is measured, since the user does no work before that reset', (st, r) => /it keeps no weekly points back \(no reset day is measured yet, and the user does no work of their own before a reset that comes before 08:00\)/.test(r.mode) && st.maxWeek <= 95 + 1],
    ['uses nothing after the 07:00 reset', st => st.afterWeekReset === 0 && st.lastUse < fridayReset],
    ['no window the run touched is open at 08:00 Friday', st => !st.windows.some(([a, b]) => a <= fridayWork && fridayWork < b && st.lastUse >= a)],
    ['a session without the usage card reads the limits the status line wrote for this machine in the last 5 minutes', st => {
      const p = st.prompts['usage before the scout'] || ''
      return /When ToolSearch finds no such tool, as in a terminal session, read the limits the status line keeps instead/.test(p) && p.includes('select(.machine == $m and now - .writtenEpoch < 300)') && p.includes('~/.claude/plan-limits.json') && p.includes('uname -n | cut -d. -f1')
    }],
    ['and the session is pointed at that file for the points the run used', (st, r) => /or in a session without that tool, such as a terminal session, the limits in ~\/\.claude\/plan-limits\.json/.test(r.forTheSession)],
    ['its rows carry the machine', st => recorded(st).machine === 'desk' && weekLine(st).machine === 'desk' && weekLine(st).mode === 'eve'],
    ['every agent is told it is one step of the run and leaves the prompt files to the session that started it', st => Object.keys(st.prompts).length > 10 && Object.values(st.prompts).every(p => p.startsWith('This task is one step of the dream run that the request relayed above started') && /such as reading, reporting on and moving prompt files, so do only the task below/.test(p))],
    noHits,
  ]],
  ['eve on that machine, started at 21:50', { ...thu, now: '2026-11-12T19:50:00Z', sessions: 40 }, [
    ['skips work that would finish after the 07:00 reset as too close to it', (st, r) => /as the weekly reset is too close/.test(stopped(r))],
    ['starts none in the last 75 minutes before it', st => !st.started.some(s => !/^(usage|timer|clock|scripts|report|record|backlog|write)/.test(s.label) && s.at > fridayReset - 75 * 60000)],
    ['and uses nothing after it', st => st.afterWeekReset === 0 && st.lastUse < fridayReset],
    noHits,
  ]],
  ['the 06:50 start on that machine on the reset day', friday, [
    ['stops before its scout, as a final run too late to start work', (st, r) => !st.labels.scout && /stopped before its scout/.test(r.error || '') && /resets today at 07:00, and a run started after 05:35 can start no work/.test(r.error)],
    ['keeps its reading as a final line of the week, with nothing spent', st => { const l = weekLine(st); return l.mode === 'final' && l.dreamSpent === 0 && l.stopped === true && l.machine === 'desk' && l.weekEnds === '2026-11-13T05:00:00.000Z' && /^2026-11-13T04:5/.test(l.readAt) && l.windows.some(w => w.label === 'Weekly · all models' && w.percentUsed === 63) }],
    ['and says so', (st, r) => /The reading is kept in ~\/\.claude\/dream\/weekly-usage\.jsonl as the last one of this reset day/.test(r.error)],
  ]],
  ['eve on that machine a week later', { ...thu, week: 20, now: '2026-11-19T14:30:00Z', since: '2026-11-13T03:00:00Z', fiveReset: '2026-11-19T10:00:00Z', weekReset: '2026-11-20T05:00:00Z', sessions: 20, weekLines: weekRows.map(l => on('mac', l)).concat([
    on('desk', weekRow('eve', '2026-11-13T05:00:00Z', '2026-11-13T03:40:00Z', 60, 30)),
    on('desk', weekRow('final', '2026-11-13T05:00:00Z', '2026-11-13T04:51:00Z', 63, 0)),
  ]) }, [
    ['keeps back the 3 points used between its last run and 06:50, not the 12 the other machine measured', (st, r) => /keeps 3\.0 weekly points back until that reset/.test(r.mode) && /"reserve":3,/.test(st.historyLine || '')],
    noHits,
  ]],
  ['unattended, the limits out of reach', { ...thu, unreadable: true }, [
    ['stops before its scout and says why', (st, r) => !st.labels.scout && /This run is unattended and the plan's limits cannot be read here/.test(r.error || '') && /plan-limits\.sh/.test(r.error) && /stopped before its scout/.test(r.error)],
  ]],
  ['unattended, the limits lost three hours in', { ...thu, unreadableFrom: '2026-11-12T17:30:00Z' }, [
    ['reads once more, then starts no more work and reports', (st, r) => {
      const lost = st.started.filter(s => /^usage \d/.test(s.label)).pop()
      return st.logs.some(l => /Lost the usage limits in a run nobody watches/.test(l)) && /as the usage limits can no longer be read and nobody watches the run/.test(stopped(r)) && !st.started.some(s => work(s) && s.at > lost.at) && Boolean(r.report)
    }],
    noHits,
  ]],
  ['watched, the limits lost three hours in', { ...thu, args: {}, unreadableFrom: '2026-11-12T17:30:00Z', sessions: 60 }, [
    ['goes on without the guard, as before', (st, r) => st.logs.some(l => /continuing without the usage guard/.test(l)) && !/nobody watches/.test(stopped(r))],
  ]],
  ['another run going on the other machine', { ...wed, week: 30, sessions: 4, marker }, [
    ['stops before its scout, naming the machine, the run and both times', (st, r) => !st.labels.scout && /The dream run 2026-10-14 on desk is still going: it started at 2026-10-14 16:30 and gave its last sign of life at 2026-10-14 20:48/.test(r.error || '')],
    ['counts only a marker with a sign of life in the last 30 minutes', st => (st.prompts['usage before the scout'] || '').includes("jq -c 'select(now - .aliveEpoch < 1800)' ~/.claude/dream/running.json")],
  ]],
  ['a review while another run is going', { ...wed, week: 30, sessions: 4, marker, args: 'review' }, [
    ['is not held back', (st, r) => !r.error && r.due === 0 && Object.keys(st.labels).join() === 'review'],
  ]],
  ['the marker of a run', oct31, [
    ['the scout writes it once it has the run id', st => /before any later step, write the marker that tells other dream runs this one is going/.test(st.prompts.scout || '') && st.prompts.scout.includes('to ~/.claude/dream/running.json')],
    ['every usage reading rewrites it with the time', st => readings(st).length > 3 && readings(st).every(([, p]) => p.includes(`printf '{"machine":"%s","runId":"%s","started":"%s","alive":"%s","aliveEpoch":%s}\\n' 'mac' '2026-10-31' '2026-10-31T11:12:00Z' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date -u +%s)" > ~/.claude/dream/running.json`))],
    ['and so does each nine minutes of a wait', st => readings(st).some(([k, p]) => k.endsWith(' after the 14:00 reset') && /> ~\/\.claude\/dream\/running\.json; end=\$\(\( \$\(date -u \+%s\) \+ 540 \)\)/.test(p))],
    ['the run record removes it, when it is still this run\'s', st => (st.prompts['record run'] || '').includes(`jq -e 'select(.machine == "mac" and .started == "2026-10-31T11:12:00Z")' ~/.claude/dream/running.json >/dev/null 2>&1 && rm -f ~/.claude/dream/running.json`)],
  ]],
  ['a run that nothing fits in', { ...wed, week: 94, sessions: 4 }, [
    ['removes its marker before it stops', (st, r) => /^Nothing fitted/.test(r.error || '') && st.labels.clear === 1 && (st.prompts['clear marker'] || '').includes('select(.machine == "mac" and .started >= "2026-10-14T18:00:00Z")')],
  ]],
  ['a run with no weekly room above its margin', { ...wed, week: 96, sessions: 4 }, [
    ['stops before its scout and says why', (st, r) => !st.labels.scout && /^Nothing ran\. The weekly limit is at 96%, and this night run leaves 5 points of it free, so no work could start before the weekly reset at 2026-10-17 16:59\. The run stopped before its scout\./.test(r.error || '')],
  ]],
  ['an eve run with no weekly room above its reserve', { ...nov6, week: 62, weekLines: weekRows.filter(l => !l.includes('"final"')) }, [
    ['stops before its scout and names the reserve', (st, r) => !st.labels.scout && /this eve run leaves 5 points of it free and keeps 33\.8 back \(2 5-hour windows, since no reset day is measured yet\)/.test(r.error || '') && /stopped before its scout/.test(r.error)],
  ]],
  ['the eve run of 12 Nov on the machine whose week resets at 07:00, the week at 67%', { ...thu, args: {}, week: 67, five: 14, fiveReset: '2026-11-12T17:10:00Z', now: '2026-11-12T13:53:00Z', since: '2026-10-31T11:14:25Z', sessions: 325 }, [
    ['starts work instead of finding that nothing fits', (st, r) => !r.error && st.started.some(work)],
    ['keeps the week under its margin', st => st.maxWeek <= 95 + 1],
    ['uses nothing after the 07:00 reset', st => st.afterWeekReset === 0 && st.lastUse < fridayReset],
    noHits,
  ]],
  ['first run on a machine, the runs on record another machine\'s', { ...wed, week: 30, sessions: 20, machine: 'desk', history: [on('mac', HISTORY)], extraHistory: [on('mac', ranBattery('2026-10-14T08:00:00Z'))] }, [
    ['estimates from none of them', st => st.logs.some(l => /Estimating from 0 earlier runs/.test(l))],
    ['starts one piece of work and only when it is done the next, which the reading then measures', st => {
      const [first, second, third] = st.started.filter(work)
      return second.at >= first.at + 15 * 60000 && third.at > second.at && st.started.some(s => /^usage \d/.test(s.label) && s.at === second.at)
    }],
    ['then runs seven at a time', st => block(st, 'Agents').mostAtOnce.Recent >= 7],
    ['what the other machine read 10 hours ago still counts as read', (st, r) => !st.labels.battery && r.sources.notDue.includes('battery')],
    noHits,
  ]],
  ['a later run on that machine', { ...wed, week: 30, sessions: 20, machine: 'desk', history: [on('mac', HISTORY), on('desk', HISTORY)] }, [
    ['estimates from its own run alone', st => st.logs.some(l => /Estimating from 1 earlier runs/.test(l))],
    ['and starts seven pieces of work at once', st => { const starts = st.started.filter(work); return starts.filter(s => s.at === starts[0].at).length === 7 }],
  ]],
  ['weekly readings of two machines', { ...wed, week: 30, sessions: 4, weekLines: [on('desk', weekRow('final', '2026-10-09T05:00:00Z', '2026-10-09T04:50:00Z', 80, 0)), on('mac', weekRow('final', '2026-10-10T13:59:59Z', '2026-10-10T12:00:00Z', 70, 5))] }, [
    ['the recap counts this machine\'s weeks alone', (st, r) => r.weekly.lastWeek.endsAt === '2026-10-10T14:00:00.000Z' && r.weekly.month.weeks === 1 && r.weekly.loggedSince === '2026-10-10T14:00:00.000Z'],
  ]],
]

let failed = 0
for (const [name, sc, checks] of scenarios) {
  const { st, logs, result } = await simulate(wf, sc)
  st.logs = logs
  if (result.crash) { console.log(`CRASH ${name}\n${result.crash}`); failed++; continue }
  const lines = checks.map(([desc, ok]) => { const pass = Boolean(ok(st, result)); if (!pass) failed++; return `  ${pass ? 'PASS' : 'FAIL'}: ${desc}` })
  console.log(`== ${name}: weekly ${sc.week} to ${st.maxWeek.toFixed(1)}, agents failed at a limit ${st.hits}`)
  console.log(lines.join('\n'))
}
console.log(failed ? `${failed} checks failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
