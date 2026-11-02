// Discrete-event simulation of a dream run: fake agents with durations and costs, a simulated
// clock, a 5-hour window where an agent that reaches the limit fails, and a weekly window.
import fs from 'node:fs'

const H = 3600000, M = 60000
const HISTORY = '{"date":"2026-10-14","model":"claude-opus-5-5","effort":"xhigh","margin":5,"proposals":30,"checked":30,"unchecked":0,"skippedSources":0,"start":[],"end":[],"ledger":{"gather":{"5-hour limit":{"units":18,"delta":23},"Weekly · all models":{"units":18,"delta":4}},"merge":{"5-hour limit":{"units":1,"delta":1},"Weekly · all models":{"units":1,"delta":0}},"verify":{"5-hour limit":{"units":30,"delta":36},"Weekly · all models":{"units":30,"delta":6}},"report":{"5-hour limit":{"units":1,"delta":5},"Weekly · all models":{"units":1,"delta":1}}}}'

export async function loadWorkflow(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/^export const meta/m, 'const meta')
  const body = `export default async function wf(args, agent, parallel, pipeline, phase, log) {\n${src}\n}`
  return (await import(`data:text/javascript,${encodeURIComponent(body)}`)).default
}

export async function simulate(wf, sc) {
  const st = {
    now: Date.parse(sc.now), five: sc.five, fiveReset: Date.parse(sc.fiveReset), week: sc.week, weekReset: Date.parse(sc.weekReset),
    windowStart: Date.parse(sc.fiveReset) - 5 * H, windows: [], hits: 0, afterWeekReset: 0, maxWeek: sc.week, lastUse: 0, labels: {}, prompts: {}, started: [],
  }
  const RATIO = 1 / 5.9
  const timers = []
  const waiting = []
  let running = 0

  function use(cost) {
    if (st.now >= st.weekReset) { st.week = 0; st.weekReset += 7 * 24 * H; st.weekResetHappened = true }
    if (st.weekResetHappened) st.afterWeekReset += cost * RATIO
    if (st.now >= st.fiveReset) { st.windows.push([st.windowStart, st.fiveReset]); st.five = 0; st.windowStart = st.now; st.fiveReset = st.now + 5 * H }
    if (st.five + cost > 100 || st.week + cost * RATIO > 100) { st.hits++; st.five = Math.min(100, st.five + cost); return false }
    st.five += cost
    st.week += cost * RATIO
    if (sc.weekJumpAt && st.now >= Date.parse(sc.weekJumpAt) && !st.jumped) { st.jumped = true; st.week = 0; st.weekReset = st.now + 7 * 24 * H; st.weekResetHappened = true }
    st.maxWeek = Math.max(st.maxWeek, st.week)
    st.lastUse = st.now
    return true
  }

  function usageCard() {
    if (sc.unreadable) return { available: false, windows: [], now: new Date(st.now).toISOString() }
    const active = st.now < st.fiveReset
    const weekDone = st.now >= st.weekReset
    return {
      available: true, now: new Date(st.now).toISOString(), windows: [
        { label: '5-hour limit', percentUsed: active ? Math.floor(st.five) : 0, resetsAt: new Date(active ? st.fiveReset : st.now + 5 * H).toISOString() },
        { label: 'Weekly · all models', percentUsed: weekDone ? 0 : Math.floor(st.week), resetsAt: new Date(weekDone ? st.weekReset + 7 * 24 * H : st.weekReset).toISOString() },
        { label: 'Weekly · Fable', percentUsed: 49, resetsAt: new Date(st.weekReset).toISOString() },
      ],
    }
  }

  // With dupes, a symlinked project folder shows the first three files of each list a second time, and the last run carried one over under that path.
  const linked = list => list.concat(sc.dupes ? list.slice(0, 3).map(s => ({ ...s, path: s.path.replace(/^\/(\w+)\//, '/$1/link/'), project: 'link' })) : [])
  const history = sc.dupes ? JSON.stringify({ ...JSON.parse(HISTORY), pending: [{ path: '/t/link/s5.jsonl', project: 'link', bytes: 1e6, mtime: sc.since, from: '2026-10-12T00:00:00Z' }] }) : HISTORY
  const fit = { verdict: 'keep', reason: 'ok', finalProposal: '', script: 'echo', exactChange: 'a line', exampleWrong: 'it broke', exampleFixed: 'it works' }
  function respond(label, prompt) {
    st.prompts[label] = prompt
    if (label === 'review setup') return { today: sc.now.slice(0, 10), report: '~/.claude/dream/2026-10-17.md', backlog: sc.backlog || { valid: true, open: [], closed: [], unchecked: [] } }
    if (label === 'scout') return {
      now: sc.now, today: sc.now.slice(0, 10), utcOffset: sc.utcOffset || '+0300', runId: sc.now.slice(0, 10), since: sc.since, lookbackFrom: new Date(Date.parse(sc.since) - 7 * 24 * H).toISOString(),
      oldestTranscript: '2026-09-21T08:00:00Z', installedVersion: '2.1.299', previousReports: [],
      sessions: linked(Array.from({ length: sc.sessions }, (_, i) => ({ path: `/t/s${i}.jsonl`, project: `p${i % 5}`, bytes: 1e6 + i, mtime: new Date(Date.parse(sc.now) - i * H).toISOString(), lastActivity: new Date(Date.parse(sc.now) - i * H).toISOString() }))),
      skillRepos: [], model: 'claude-opus-5-5', effort: 'xhigh', usage: usageCard(), historyLines: [history].concat(sc.extraHistory || []), weekLines: sc.weekLines || [],
      backlog: sc.backlog || { valid: true, open: [], closed: [], unchecked: [] },
      ruleSections: ['Git', 'Remote', 'Commands', 'Commits', 'PRs', 'Prose', 'Feedback', 'Comments', 'Running', 'Permissions', 'Public', 'Memory'],
      repos: [1, 2, 3, 4, 5].map(i => ({ path: `~/Projects/r${i}`, projectDirs: [`-r${i}`] })),
      upstreams: sc.upstreams || [],
      prs: [1, 2, 3, 4].map(i => ({ url: `https://github.com/o/r/pull/${i}`, repo: 'o/r', number: i, title: `pr ${i}`, isDraft: true, updatedAt: `2026-10-1${i}T00:00:00Z` })),
    }
    if (label.startsWith('usage')) return usageCard()
    if (label.startsWith('timer')) return { now: new Date(st.now).toISOString() }
    if (label === 'backlog check') return { items: [] }
    if (label === 'list older') return {
      older: linked(Array.from({ length: 12 }, (_, i) => ({ path: `/old/o${i}.jsonl`, project: 'p', bytes: 2e6, mtime: new Date(Date.parse('2026-10-06T00:00:00Z') - i * 30 * H).toISOString() }))),
      subagents: linked(Array.from({ length: 40 }, (_, i) => ({ path: `/sub/a${i}.jsonl`, project: 'p', bytes: 3e5, mtime: new Date(Date.parse(sc.now) - i * 5 * H).toISOString() }))),
    }
    if (label.startsWith('merge')) {
      const findings = JSON.parse(prompt.split('Findings, as JSON:\n')[1].split('\n')[0])
      const prefix = /starts with (\w+),/.exec(prompt)[1]
      return { proposals: findings.filter((_, i) => i % 2 === 0).slice(0, 50).map((f, i) => ({ ...f, id: `${prefix}${i + 1}`, sources: [f.source] })), updates: [], dropped: [] }
    }
    if (label.startsWith('evidence')) return { holds: true, recurring: true, notes: '' }
    if (label.startsWith('fit')) return fit
    if (label.startsWith('review')) return { findings: [{ file: 'a.js', line: 1, severity: 'high', summary: 's', scenario: 'x', fix: 'y' }], coverage: 'c' }
    if (label.startsWith('check')) return { verdicts: [{ index: 0, real: true, note: '' }] }
    if (label === 'monday brief') return { brief: '- pr 1: draft' }
    if (/^scripts \d/.test(label)) {
      const items = JSON.parse(prompt.split('Proposals, as JSON:\n')[1].split('\n')[0])
      return { steps: items.map(i => ({ id: i.id, key: i.key, status: 'runs', command: `bash ~/.claude/dream/x/${i.id}.sh`, file: `~/.claude/dream/x/${i.id}.sh`, note: '' })) }
    }
    if (label === 'report') return { path: '/tmp/r.md', summary: 's' }
    if (label === 'record run') { st.historyLine = prompt.split('\n').find(x => x.startsWith('{')); return { ok: true } }
    if (/^(backlog patch|backlog items|write backlog)/.test(label)) return { ok: true }
    return { findings: [{ kind: 'hook', title: `${label} a`, problem: 'p', proposal: 'q', target: '~/x', evidence: [], impact: 'low' }, { kind: 'hook', title: `${label} b`, problem: 'p', proposal: 'q', target: '~/x', evidence: [], impact: 'low' }], coverage: 'c' }
  }

  const COST = { scout: [3, 0.5], usage: [0.05, 1], timer: [0.05, 1], 'backlog check': [1, 4], 'list older': [0.3, 2], merge: [1, 6], evidence: [0.6, 8], fit: [0.6, 10], review: [2.6, 20], check: [1, 8], report: [2, 10] }
  const agent = (prompt, o = {}) => new Promise(resolve => {
    const go = () => {
      running++
      const label = o.label || 'x'
      const kind = label.split(' ')[0]
      st.labels[kind] = (st.labels[kind] || 0) + 1
      let [cost, minutes] = COST[label] || COST[kind] || [1.3, 15]
      // A scenario can set how long agents run, by label or by kind, such as one check far slower than the others.
      minutes = (sc.minutes || {})[label] || (sc.minutes || {})[kind] || minutes
      if (/^scripts \d/.test(label)) { const n = (prompt.match(/"id":"p\d+"/g) || []).length; cost = 1.5 * n; minutes = 3 * n }
      if (o.model === 'haiku') cost = Math.min(cost, 0.1)
      // A usage reading told to wait until a time returns once that time has come, and a timer after nine minutes at most.
      const until = /^Wait until (\S+),/.exec(prompt)
      const most = /nine minutes at most/.test(prompt) ? st.now + 9 * M : Infinity
      st.started.push({ label, at: st.now })
      timers.push({ at: Math.max(st.now + minutes * M, until ? Math.min(Date.parse(until[1]), most) : 0), fire: () => {
        const ok = use(cost)
        running--
        if (waiting.length) waiting.shift()()
        resolve(ok ? respond(label, prompt) : null)
      } })
    }
    if (running < 8) go()
    else waiting.push(go)
  })
  const parallel = t => Promise.all(t.map(x => x().catch(() => null)))
  const pipeline = (items, ...stages) => Promise.all(items.map(async (it, i) => { let v = it; for (const s of stages) v = await s(v, it, i); return v }))
  const logs = []
  let done = false, result
  wf(sc.args || {}, agent, parallel, pipeline, () => {}, m => logs.push(m)).then(r => { result = r; done = true }, e => { result = { crash: String(e.stack) }; done = true })
  for (let guard = 0; !done && guard < 200000; guard++) {
    await new Promise(r => setImmediate(r))
    if (timers.length) {
      timers.sort((a, b) => a.at - b.at)
      const t = timers.shift()
      st.now = Math.max(st.now, t.at)
      t.fire()
    }
  }
  st.windows.push([st.windowStart, st.fiveReset])
  return { st, logs, result }
}
