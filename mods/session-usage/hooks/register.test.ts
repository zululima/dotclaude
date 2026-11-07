import { expect, mock, test, type TestBody } from 'claude-code/testing'

const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const FIGURES = '\u{1F9E0} 16%'
const FIRE = '\u{1F525}'
const ALARM = '\u23F0'
const ICE = '\u{1F9CA}'
const HOURGLASS = '\u23F3'
const COOKIE = '\u{1F36A}'
const LOCK = '\u{1F512}️'
const LATE = '\u{1F4B8}'
const GEAR = '⚙️'
// 12:20 on 20 Oct at UTC+3, and the next midnight there
const NOW = 1792488000_000
const MIDNIGHT = 1792530000_000

const ran = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

const warmFor = (minutes: number) => ran(`${FIGURES}\n${NOW / 1000 + minutes * 60}\n10800\n`)

test('pins the cache countdown and the figures after a main turn', async ($, on) => {
  const shown: (string | undefined)[] = []
  const argvs: string[][] = []
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    argvs.push([...e.argv])
    return warmFor(15)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete(TURN)

  expect(argvs).toHaveLength(1)
  expect(argvs[0]?.[0]).toMatch(/\/usage\.sh$/)
  expect(argvs[0]?.slice(1)).toEqual(['--status', 'abc'])
  expect(shown).toEqual([`${FIRE} 15m, ${FIGURES}`])
})

test('counts the context against the window the session compacts at', async ($, on) => {
  const shown: (string | undefined)[] = []
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', () => warmFor(15))
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context: {
        tokens: 354_400,
        window: 1_000_000,
        percent: 35,
        ...(e.breakdown === 'summary' && { breakdown: { rawMaxTokens: 400_000 } }),
      },
      rateLimits: [],
    },
  }))
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete(TURN)

  expect(shown).toEqual([`${FIRE} 15m, \u{1F9E0} 89%`])
})

test('counts down between turns, then names the day once it is past', async ($, on) => {
  const shown: (string | undefined)[] = []
  let runs = 0
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] !== '--status') return ran('')
    runs++
    return warmFor(2)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await clock.advance(60_000)
  await clock.advance(45_000)
  await clock.advance(15_000)
  await clock.advance(60_000)
  await clock.set(MIDNIGHT + 15_000)

  expect(runs).toBe(1)
  expect(shown).toEqual([
    `${FIRE} 2m, ${FIGURES}`,
    `${FIRE} 1m, ${FIGURES}`,
    `${ALARM} <1m, ${FIGURES}`,
    `${ICE} since 12:22, ${FIGURES}`,
    `${ICE} since 20 Oct, ${FIGURES}`,
  ])
})

test('marks a prompt sent too late and turns to the alarm and the ice between ticks', async ($, on) => {
  const shown: (string | undefined)[] = []
  let mark = ''
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--next') return ran('')
    return ran(`${FIGURES}\n${NOW / 1000 + 65}\n10800\n${mark}\n`)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start(START)
  mark = LATE
  await $.turn.complete(TURN)
  await clock.advance(5_001)
  await clock.advance(59_999)

  expect(shown).toEqual([
    `${FIRE} 1m, ${FIGURES}`,
    `${FIRE} 1m ${LATE}, ${FIGURES}`,
    `${ALARM} <1m ${LATE}, ${FIGURES}`,
    `${ICE} since 12:21, ${FIGURES}`,
  ])
})

test('reads the transcript on each tick while a main turn runs', async ($, on) => {
  let runs = 0
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] !== '--status') return ran('')
    runs++
    return warmFor(60)
  })
  on('ui.status', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1', agentId: 'sub' })
  await clock.advance(15_000)
  expect(runs).toBe(1)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(30_000)
  expect(runs).toBe(3)

  await $.turn.complete(TURN)
  await clock.advance(30_000)
  expect(runs).toBe(4)
})

test('names the other session that goes cold next, cut to fit, read once a minute', async ($, on) => {
  const shown: (string | undefined)[] = []
  let nextRuns = 0
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] !== '--next') return warmFor(59)
    expect(e.argv[2]).toBe('abc')
    nextRuns++
    return ran(`${NOW / 1000 + 90}\tStore status\n${NOW / 1000 + 18 * 60}\tOctober role at the office\n`)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await clock.advance(45_000)
  await clock.advance(45_000)

  expect(nextRuns).toBe(2)
  expect(shown).toEqual([
    `${FIRE} 59m, ${FIGURES}, ${HOURGLASS} 1m Store status`,
    `${FIRE} 58m, ${FIGURES}, ${HOURGLASS} 1m Store status`,
    `${FIRE} 58m, ${FIGURES}, ${HOURGLASS} <1m Store status`,
    `${FIRE} 57m, ${FIGURES}, ${HOURGLASS} <1m Store status`,
    `${FIRE} 57m, ${FIGURES}, ${HOURGLASS} 16m October role at`,
  ])
  // Each emoji counted as two columns
  expect(shown.every(text => [...(text ?? '')].length + 3 <= 40)).toBe(true)
})

test('names an untitled session by its last prompt and reads it each tick until titled', async ($, on) => {
  const shown: (string | undefined)[] = []
  let nextRuns = 0
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] !== '--next') return warmFor(59)
    nextRuns++
    return nextRuns === 1
      ? ran(`${NOW / 1000 + 300}\tdoes the app log mic use\tcold\t\tuntitled\n`)
      : ran(`${NOW / 1000 + 300}\tMic logging\tcold\t\t\n`)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await clock.advance(15_000)
  await clock.advance(15_000)

  expect(nextRuns).toBe(2)
  expect(shown[0]).toBe(`${FIRE} 59m, ${FIGURES}, ${HOURGLASS} 5m does the app log`)
  expect(shown.at(-1)).toBe(`${FIRE} 58m, ${FIGURES}, ${HOURGLASS} 4m Mic logging`)
})

test('shows its own Chrome sign-in in place of the cache while it ends first', async ($, on) => {
  const shown: (string | undefined)[] = []
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--next') return ran('')
    return ran(`${FIGURES}\n${NOW / 1000 + 10 * 60}\n10800\n\n${NOW / 1000 + 2 * 60}\n`)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await clock.advance(60_001)
  await clock.advance(59_999)

  expect(shown).toEqual([
    `${COOKIE} 2m, ${FIGURES}`,
    `${COOKIE} 1m, ${FIGURES}`,
    `${COOKIE} <1m, ${FIGURES}`,
    `${FIRE} 8m, ${FIGURES}`,
  ])
})

test('ranks a Chrome sign-in that ends with the caches that go cold, under a lock', async ($, on) => {
  const shown: (string | undefined)[] = []
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] !== '--next') return warmFor(59)
    return ran(`${NOW / 1000 + 4 * 60}\tBank export\tsign-in\n${NOW / 1000 + 18 * 60}\tOctober role\n`)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await clock.advance(4 * 60_000)

  expect(shown.at(0)).toBe(`${FIRE} 59m, ${FIGURES}, ${LOCK} 4m Bank export`)
  expect(shown.at(-1)).toBe(`${FIRE} 55m, ${FIGURES}, ${HOURGLASS} 14m October role`)
})

test('reads the other sessions again within seconds of a prompt in one of them', async ($, on) => {
  const shown: (string | undefined)[] = []
  const written: string[] = []
  let beaconAt = NOW - 600_000
  let nextRuns = 0
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/config' })
  on('session.id', () => ({ value: 'abc' }))
  on('fs.stat', ($, e) => {
    expect(e.path).toBe('/config/usage-beacon')
    return { value: { kind: 'file', size: 4, mtimeMs: beaconAt, isLink: false } }
  })
  on('fs.write', ($, e) => {
    written.push(e.path)
    beaconAt = NOW + 7_000
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    if (e.argv[1] !== '--next') return warmFor(59)
    nextRuns++
    return nextRuns === 1
      ? ran(`${NOW / 1000 + 90}\tStore status\n${NOW / 1000 + 18 * 60}\tOctober role\n`)
      : ran(`${NOW / 1000 + 18 * 60}\tOctober role\n`)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))

  await $.session.start(START)
  await clock.advance(5_000)
  expect(nextRuns).toBe(1)

  beaconAt = NOW + 6_000
  await clock.advance(5_000)
  expect(nextRuns).toBe(2)
  expect(shown.at(-1)).toBe(`${FIRE} 58m, ${FIGURES}, ${HOURGLASS} 17m October role`)

  // Its own prompt writes the beacon and reads nothing again.
  await $.turn.start({ text: 'go', turnId: 't1', agentId: 'sub' })
  expect(written).toEqual([])
  await $.turn.start({ text: 'go', turnId: 't2' })
  expect(written).toEqual(['/config/usage-beacon'])
  await clock.advance(5_000)
  expect(nextRuns).toBe(2)
})

test('reads the other sessions again within seconds of an archive in the app', async ($, on) => {
  const shown: (string | undefined)[] = []
  const stated = new Set<string>()
  const root = '/me/Library/Application Support/Claude/claude-code-sessions'
  const index = `${root}/org/account/archived-sessions.idx`
  const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })
  let archivedAt = NOW - 600_000
  let nextRuns = 0
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/me' })
  on('session.id', () => ({ value: 'abc' }))
  on('fs.list', ($, e) => {
    if (e.path === root) return { value: [entry('org', 'dir'), entry('notes.json', 'file')] }
    if (e.path === `${root}/org`) return { value: [entry('account', 'dir'), entry('local_1.json', 'file')] }
    return { value: [] }
  })
  on('fs.stat', ($, e) => {
    stated.add(e.path)
    if (e.path !== index) return { deny: 'missing' }
    return { value: { kind: 'file', size: 4, mtimeMs: archivedAt, isLink: false } }
  })
  on('process.run', ($, e) => {
    if (e.argv[1] !== '--next') return warmFor(59)
    nextRuns++
    return nextRuns === 1
      ? ran(`${NOW / 1000 + 90}\tStore status\n${NOW / 1000 + 18 * 60}\tOctober role\n`)
      : ran(`${NOW / 1000 + 18 * 60}\tOctober role\n`)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await clock.advance(5_000)
  expect(nextRuns).toBe(1)
  expect([...stated].sort()).toEqual(['/me/.claude/usage-beacon', index])

  archivedAt = NOW + 6_000
  await clock.advance(5_000)
  expect(nextRuns).toBe(2)
  expect(shown.at(-1)).toBe(`${FIRE} 58m, ${FIGURES}, ${HOURGLASS} 17m October role`)

  await clock.advance(5_000)
  expect(nextRuns).toBe(2)
})

test('names the other session that goes cold next before its own first answer', async ($, on) => {
  const shown: (string | undefined)[] = []
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] !== '--next') return ran('')
    return ran(`${NOW / 1000 + 18 * 60}\tOctober role at the office with a long title\n`)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await clock.advance(15_000)

  expect(shown).toEqual([
    `${HOURGLASS} 18m October role at the office with a`,
    `${HOURGLASS} 17m October role at the office with a`,
  ])
})

test('leaves a subagent turn alone and clears on no line', async ($, on) => {
  const shown: (string | undefined)[] = []
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', () => ran(''))
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete({ ...TURN, agentId: 'sub' })
  expect(shown).toEqual([])

  await $.turn.complete(TURN)
  expect(shown).toEqual([undefined])
})

const record = (id: string) => `/me/sessions/org/account/local_${id}.json`
const titleRow = (coldAt: number, title: string, kind: string, id: string, source = 'tool', sessionId = '') =>
  `${coldAt / 1000}\t${title}\t${kind}\t${record(id)}\t${source}\t${sessionId}`

const indexRow = (id: string, at: number, titles: string[], pr = '') => [record(id), at, pr, ...titles].join('\t')

// This session is "own", most recent of all and left out of its own Cmd+K;
// "store" goes cold next; "fix" is more recent and once had a title like it. The
// late mark leaves the name too little room for all three of its words.
const nextNamed = async (
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  old: string,
  fixedBefore = 'Store status fix',
) => {
  const shown: (string | undefined)[] = []
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--index')
      return ran(
        [
          indexRow('own', NOW, [`${FIRE} Page store notes`]),
          indexRow('store', NOW - 50 * 60_000, [`${FIRE} Store status page`, 'Store status']),
          indexRow('fix', NOW - 10 * 60_000, [`${FIRE} Fix login`, fixedBefore]),
          indexRow('old', NOW - 5 * 86_400_000, [old]),
        ].join('\n'),
      )
    if (e.argv[1] === '--next')
      return ran(
        `${titleRow(0, `${FIRE} Page store notes`, 'own', 'own')}\n` +
          `${NOW / 1000 + 120}\t${FIRE} Store status page\tcold\t${record('store')}\n`,
      )
    if (e.argv[1] === '--titles') return ran('')
    return ran(`${FIGURES}\n${NOW / 1000 + 59 * 60}\n10800\n${LATE}\n`)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  return shown.at(-1)
}

test('names the other session by its first word and the later ones Cmd+K lists it alone by', async ($, on) => {
  expect(await nextNamed($, on, `${ICE} Status report`)).toBe(`${FIRE} 59m ${LATE}, ${FIGURES}, ${HOURGLASS} 2m Store page`)
})

test('keeps the first word whole rather than name the session by a later word alone', async ($, on) => {
  const shown: (string | undefined)[] = []
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--index')
      return ran(
        [
          indexRow('own', NOW, [`${FIRE} Page store notes`]),
          indexRow('note', NOW - 50 * 60_000, [`${FIRE} Notebooks fixes`]),
          indexRow('import', NOW - 10 * 60_000, ['Notebooks import']),
          indexRow('tests', NOW - 5 * 86_400_000, [`${ICE} Test fixes`]),
        ].join('\n'),
      )
    if (e.argv[1] === '--next')
      return ran(
        `${titleRow(0, `${FIRE} Page store notes`, 'own', 'own')}\n` +
          `${NOW / 1000 + 59 * 60}\t${FIRE} Notebooks fixes\tcold\t${record('note')}\n`,
      )
    if (e.argv[1] === '--titles') return ran('')
    return ran(`${FIGURES}\n${NOW / 1000 + 59 * 60}\n10800\n${LATE}\n`)
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  expect(shown.at(-1)).toBe(`${FIRE} 59m ${LATE}, ${FIGURES}, ${HOURGLASS} 59m Notebooks`)
})

test('takes more words to have Cmd+K list the other session alone, not only first', async ($, on) => {
  expect(await nextNamed($, on, `${ICE} Status page report`)).toBe(
    `${FIRE} 59m ${LATE}, ${FIGURES}, ${HOURGLASS} 2m Store page`,
  )
})

test('settles for first when no choice of its words has Cmd+K list the other session alone', async ($, on) => {
  expect(await nextNamed($, on, `${ICE} Store status page work`)).toBe(
    `${FIRE} 59m ${LATE}, ${FIGURES}, ${HOURGLASS} 2m Store page`,
  )
})

test('puts an older title that starts with the words first, as Cmd+K does', async ($, on) => {
  expect(await nextNamed($, on, 'Page store status')).toBe(`${FIRE} 59m ${LATE}, ${FIGURES}, ${HOURGLASS} 2m Store page`)
})

test('keeps the title cut to fit when Cmd+K lists the other session alone by it', async ($, on) => {
  expect(await nextNamed($, on, `${ICE} Status report`, 'Store fix')).toBe(
    `${FIRE} 59m ${LATE}, ${FIGURES}, ${HOURGLASS} 2m Store status`,
  )
})

test('marks each title with a fire while its cache is warm and an ice cube once cold', async ($, on) => {
  const records = new Map([
    [record('own'), { title: 'This work', titleSource: 'auto' }],
    [record('store'), { title: 'Store status', titleSource: 'tool' }],
    [record('old'), { title: `${FIRE} Old work`, titleSource: 'tool' }],
    [record('mine'), { title: 'Named by hand', titleSource: 'user' }],
  ])
  const renamed: string[] = []
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--titles')
      return ran(
        `${titleRow(0, `${FIRE} Old work`, 'title', 'old')}\n${titleRow(0, 'Named by hand', 'title', 'mine', 'user')}\n`,
      )
    if (e.argv[1] === '--next')
      return ran(
        `${titleRow(0, 'This work', 'own', 'own', 'auto')}\n${NOW / 1000 + 120}\t${FIRE} Store status\n` +
          `${titleRow(NOW + 120_000, 'Store status', 'title', 'store')}\n`,
      )
    return warmFor(30)
  })
  const shown: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    const found = records.get(e.path)
    return found ? { value: JSON.stringify(found) } : { deny: 'missing' }
  })
  on('mcp.call', ($, e) => {
    expect([e.server, e.tool]).toEqual(['ccd_session_mgmt', 'set_session_title'])
    const { session_id: id, title } = e.args as { session_id: string; title: string }
    renamed.push(`${id}: ${title}`)
    const path = `/me/sessions/org/account/${id}.json`
    records.set(path, { ...records.get(path)!, title, titleSource: 'tool' })
    return { value: { content: [], isError: false } }
  })
  on('session.start', () => ({ cwd: '/' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))

  await $.session.start(START)
  await clock.advance(1)
  expect(renamed).toEqual([`local_own: ${FIRE} This work`, `local_store: ${FIRE} Store status`, `local_old: ${ICE} Old work`])
  expect(shown[0]).toBe(`${FIRE} 30m, ${FIGURES}, ${HOURGLASS} 2m Store status`)

  await clock.advance(135_000)
  expect(renamed.slice(3)).toEqual([`local_store: ${ICE} Store status`])

  await clock.advance(30 * 60_000)
  expect(renamed.slice(4)).toEqual([`local_own: ${ICE} This work`])

  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(1)
  expect(renamed.slice(5)).toEqual([`local_own: ${FIRE} This work`])
})

test('marks a title with a gear while its file under usage-waiting is fresh', async ($, on) => {
  const records = new Map([
    [record('own'), { title: 'This work', titleSource: 'auto' }],
    [record('store'), { title: 'Store status', titleSource: 'tool' }],
  ])
  const renamed: string[] = []
  const dir = '/config/usage-waiting'
  const own = `${dir}/abc`
  // A file an earlier process of this session left.
  const files = new Map([[own, { text: '1\n', at: NOW - 1_000 }]])
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/config' })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--next')
      return ran(
        `${titleRow(0, 'This work', 'own', 'own', 'auto', 'abc')}\n` +
          `${titleRow(NOW + 3_600_000, 'Store status', 'title', 'store', 'tool', 'def')}\n`,
      )
    if (e.argv[1] === '--status') return warmFor(30)
    return ran('')
  })
  on('ui.status', () => ({ value: undefined }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 4, mtimeMs: NOW - 600_000, isLink: false } }))
  on('fs.write', ($, e) => {
    files.set(e.path, { text: e.text, at: clock.now() })
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    expect(e.path).toBe(dir)
    const entries = [...files].filter(([path]) => path.startsWith(`${dir}/`))
    return {
      value: entries.map(([path, { text, at }]) => ({
        name: path.slice(dir.length + 1),
        kind: 'file' as const,
        size: text.length,
        mtimeMs: at,
        isLink: false,
      })),
    }
  })
  on('fs.read', ($, e) => {
    const found = records.get(e.path)
    return found ? { value: JSON.stringify(found) } : { deny: 'missing' }
  })
  on('mcp.call', ($, e) => {
    const { session_id: id, title } = e.args as { session_id: string; title: string }
    renamed.push(`${id}: ${title}`)
    const path = `/me/sessions/org/account/${id}.json`
    records.set(path, { ...records.get(path)!, title, titleSource: 'tool' })
    return { value: { content: [], isError: false } }
  })
  on('session.start', () => ({ cwd: '/' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  // The Stop hook writes the file when a run is left in flight.
  const turn = async (turnId: string, isRunLeft: boolean) => {
    await $.turn.start({ text: 'go', turnId })
    if (isRunLeft) files.set(own, { text: `${NOW / 1000}\n`, at: clock.now() })
    await $.turn.complete({ ...TURN, turnId })
    await clock.advance(1)
  }

  await $.session.start(START)
  await clock.advance(1)
  expect(renamed).toEqual([`local_own: ${FIRE} This work`, `local_store: ${FIRE} Store status`])

  await turn('t1', true)
  expect(renamed.slice(2)).toEqual([`local_own: ${GEAR} This work`])

  // Kept fresh on each tick, and the other session's file read on each pass.
  files.set(`${dir}/def`, { text: '1\n', at: clock.now() })
  await clock.advance(15_000)
  expect(files.get(own)?.at).toBe(NOW + 15_000)
  expect(renamed.slice(3)).toEqual([`local_store: ${GEAR} Store status`])

  // Its file goes stale once its process ends.
  await clock.advance(60_000)
  expect(renamed.slice(4)).toEqual([`local_store: ${FIRE} Store status`])

  // The wake-up turn ends with nothing in flight.
  await turn('t2', false)
  await clock.advance(30_000)
  expect(renamed.slice(5)).toEqual([`local_own: ${FIRE} This work`])
  expect(files.get(own)?.text).toBe('')
})

test('tries a rename the app declines again ten minutes later', async ($, on) => {
  let calls = 0
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--titles') return ran(`${titleRow(0, 'Old work', 'title', 'old')}\n`)
    if (e.argv[1] === '--next') return ran('')
    return warmFor(30)
  })
  on('ui.status', () => ({ value: undefined }))
  on('fs.read', () => ({ value: JSON.stringify({ title: 'Old work', titleSource: 'tool' }) }))
  on('mcp.call', () => {
    calls++
    return { value: { content: [], isError: true } }
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await clock.advance(9 * 60_000)
  expect(calls).toBe(1)

  await clock.advance(60_000)
  expect(calls).toBe(2)
})

test('keeps the mark on a rename Claude makes', async ($, on) => {
  const asked: string[] = []
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--next') return ran(`${titleRow(NOW - 60_000, `${ICE} Old work`, 'title', 'old')}\n`)
    if (e.argv[1] === '--titles') return ran('')
    return warmFor(30)
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', { tool: 'mcp__ccd_session_mgmt__set_session_title' }, ($, e) => {
    asked.push(`${e.session_id}: ${e.title}`)
    return { result: {} }
  })
  on('session.start', () => ({ cwd: '/' }))

  const rename = (session_id: string, title: string) =>
    $.tool.call({ tool: 'mcp__ccd_session_mgmt__set_session_title', session_id, title })

  await $.session.start(START)
  await rename('self', `${ICE} Mod titles`)
  await rename('local_old', 'Older work')
  await rename('local_other', 'Other')

  expect(asked).toEqual([`self: ${FIRE} Mod titles`, `local_old: ${ICE} Older work`, 'local_other: Other'])
})

test('refuses a title over 16 characters, the emoji not counted', async ($, on) => {
  const asked: string[] = []
  on('tool.call', { tool: 'mcp__ccd_session_mgmt__set_session_title' }, ($, e) => {
    asked.push(e.title)
    return { result: {} }
  })

  const rename = (title: string) =>
    $.tool.call({ tool: 'mcp__ccd_session_mgmt__set_session_title', session_id: 'local_other', title })

  expect((await rename('Pizza ja säännöt!')).deny).toBe('The title is 17 characters. Keep it within 16, the emoji not counted.')
  expect((await rename(`${ICE} Pizza ja sääntöä`)).deny).toBeUndefined()
  expect(asked).toEqual([`${ICE} Pizza ja sääntöä`])
})

test('refuses a title that another session title holds, or that holds one', async ($, on) => {
  const asked: string[] = []
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--index')
      return ran(
        [
          indexRow('own', NOW, [`${FIRE} This work`]),
          indexRow('pizza', NOW - 60_000, [`${FIRE} Mentoripizza`, 'Mentoripizza ja retry-sääntö']),
          indexRow('store', NOW - 86_400_000, [`${ICE} Store status`]),
        ].join('\n'),
      )
    if (e.argv[1] === '--next') return ran(`${titleRow(0, `${FIRE} This work`, 'own', 'own')}\n`)
    if (e.argv[1] === '--titles') return ran('')
    return warmFor(30)
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', { tool: 'mcp__ccd_session_mgmt__set_session_title' }, ($, e) => {
    asked.push(`${e.session_id}: ${e.title}`)
    return { result: {} }
  })
  on('session.start', () => ({ cwd: '/' }))

  const rename = (session_id: string, title: string) =>
    $.tool.call({ tool: 'mcp__ccd_session_mgmt__set_session_title', session_id, title })

  await $.session.start(START)
  expect((await rename('self', 'Retry sääntö')).deny).toBe(
    'Another session was titled "Mentoripizza ja retry-sääntö", which holds every word of this title, so Cmd+K would list both for it. Pick a word it lacks.',
  )
  expect((await rename('self', 'Store')).deny).toBe(
    'Another session is titled "Store status", which holds every word of this title, so Cmd+K would list both for it. Pick a word it lacks.',
  )
  expect((await rename('self', 'Store status fix')).deny).toBe(
    'This title holds every word of another session\'s title, "Store status", so Cmd+K would list both for that one. Pick other words.',
  )
  expect((await rename('self', 'Retry rule')).deny).toBeUndefined()
  expect((await rename('self', 'This work, part')).deny).toBeUndefined()
  expect((await rename('local_store', 'Store status 2')).deny).toBeUndefined()
  expect(asked).toEqual([`self: ${FIRE} Retry rule`, `self: ${FIRE} This work, part`, 'local_store: Store status 2'])
})

const layoutOf = (isOnScreen: boolean, panes: string[] = []) => ({
  value: {
    content: [{ type: 'text', text: JSON.stringify({ views: isOnScreen ? [{ placement: 'primary' }] : [], open_panes: panes }) }],
    isError: false,
  },
})

test('shows the tasks pane each time a window starts showing the session', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let isOnScreen = false
  const shown: unknown[] = []
  on('mcp.call', ($, e) => {
    if (e.tool !== 'show_pane') return layoutOf(isOnScreen)
    shown.push(e.args.pane)
    return { value: { content: [], isError: false } }
  })
  on('tool.call', { tool: 'mcp__ccd_view__show_pane' }, () => ({ result: {} }))
  on('tool.call', { tool: 'mcp__ccd_view__close_pane' }, () => ({ result: {} }))
  const reopen = async () => {
    isOnScreen = false
    await clock.advance(5_000)
    isOnScreen = true
    await clock.advance(5_000)
    await clock.advance(5_000)
  }

  await $.tool.call({ tool: 'mcp__ccd_view__show_pane', pane: 'tasks' })
  await clock.advance(5_000)
  expect(shown).toEqual([])

  await reopen()
  expect(shown).toEqual(['tasks'])
  await reopen()
  expect(shown).toEqual(['tasks', 'tasks'])

  await $.tool.call({ tool: 'mcp__ccd_view__close_pane', pane: 'tasks' })
  await reopen()
  expect(shown).toEqual(['tasks', 'tasks'])
})

test('leaves the tasks pane alone while it is open or another pane was asked for', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let isOnScreen = false
  const shown: unknown[] = []
  on('mcp.call', ($, e) => {
    if (e.tool !== 'show_pane') return layoutOf(isOnScreen, ['tasks'])
    shown.push(e.args.pane)
    return { value: { content: [], isError: false } }
  })
  on('tool.call', { tool: 'mcp__ccd_view__show_pane' }, () => ({ result: {} }))
  on('tool.call', { tool: 'mcp__ccd_view__close_pane' }, () => ({ result: {} }))

  await $.tool.call({ tool: 'mcp__ccd_view__show_pane', pane: 'diff' })
  isOnScreen = true
  await clock.advance(5_000)
  expect(shown).toEqual([])

  isOnScreen = false
  await $.tool.call({ tool: 'mcp__ccd_view__show_pane', pane: 'tasks' })
  isOnScreen = true
  await clock.advance(5_000)
  expect(shown).toEqual([])
  await $.tool.call({ tool: 'mcp__ccd_view__close_pane', pane: 'tasks' })
})

test('closes the tasks pane once a window shows the session, when none did at the close', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let isOnScreen = false
  const asked: string[] = []
  on('mcp.call', ($, e) => {
    if (e.tool === 'get_layout') return layoutOf(isOnScreen, ['tasks'])
    asked.push(`${e.tool} ${String(e.args.pane)}`)
    return { value: { content: [], isError: false } }
  })
  on('tool.call', { tool: 'mcp__ccd_view__show_pane' }, () => ({ result: {} }))
  on('tool.call', { tool: 'mcp__ccd_view__close_pane' }, () => ({ result: {} }))

  await $.tool.call({ tool: 'mcp__ccd_view__close_pane', pane: 'tasks' })
  await clock.advance(10_000)
  expect(asked).toEqual([])

  isOnScreen = true
  await clock.advance(5_000)
  await clock.advance(10_000)
  expect(asked).toEqual(['close_pane tasks'])

  // A show of the pane drops a close still waiting, and one made on screen
  // needs none.
  isOnScreen = false
  await $.tool.call({ tool: 'mcp__ccd_view__close_pane', pane: 'tasks' })
  await $.tool.call({ tool: 'mcp__ccd_view__show_pane', pane: 'tasks' })
  isOnScreen = true
  await clock.advance(10_000)
  await $.tool.call({ tool: 'mcp__ccd_view__close_pane', pane: 'tasks' })
  await clock.advance(10_000)
  expect(asked).toEqual(['close_pane tasks'])
})

test('marks the tasks pane shown for the Stop hook until Claude closes it', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/config' })
  const written: [string, string][] = []
  on('session.id', () => ({ value: 'abc' }))
  on('fs.write', ($, e) => {
    written.push([e.path, e.text])
    return { value: undefined }
  })
  on('mcp.call', () => layoutOf(true, ['tasks']))
  on('tool.call', { tool: 'mcp__ccd_view__show_pane' }, () => ({ result: {} }))
  on('tool.call', { tool: 'mcp__ccd_view__close_pane' }, () => ({ result: {} }))

  await $.tool.call({ tool: 'mcp__ccd_view__show_pane', pane: 'tasks' })
  await $.tool.call({ tool: 'mcp__ccd_view__show_pane', pane: 'diff' })
  expect(written).toEqual([['/config/usage-tasks/abc', `${NOW}\n`]])

  await $.tool.call({ tool: 'mcp__ccd_view__close_pane', pane: 'tasks' })
  expect(written).toEqual([
    ['/config/usage-tasks/abc', `${NOW}\n`],
    ['/config/usage-tasks/abc', ''],
  ])
})
