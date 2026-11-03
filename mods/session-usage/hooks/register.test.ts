import { expect, mock, test } from 'claude-code/testing'

const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const FIGURES = '\u{1F9E0} 16%'
const FIRE = '\u{1F525}'
const ALARM = '\u23F0'
const ICE = '\u{1F9CA}'
const HOURGLASS = '\u23F3'
const KEY = '\u{1F511}'
const LATE = '\u{1F4B8}'
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
  expect(shown).toEqual([`${FIRE} 15 min, ${FIGURES}`])
})

test('counts down between turns, then names the day once it is past', async ($, on) => {
  const shown: (string | undefined)[] = []
  let runs = 0
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--next') return ran('')
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
    `${FIRE} 2 min, ${FIGURES}`,
    `${FIRE} 1 min, ${FIGURES}`,
    `${ALARM} <1 min, ${FIGURES}`,
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
    `${FIRE} 1 min, ${FIGURES}`,
    `${FIRE} 1 min ${LATE}, ${FIGURES}`,
    `${ALARM} <1 min ${LATE}, ${FIGURES}`,
    `${ICE} since 12:21, ${FIGURES}`,
  ])
})

test('reads the transcript on each tick while a main turn runs', async ($, on) => {
  let runs = 0
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'abc' }))
  on('process.run', ($, e) => {
    if (e.argv[1] === '--next') return ran('')
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
    `${FIRE} 59 min, ${FIGURES}, ${HOURGLASS} 1 min Store status`,
    `${FIRE} 58 min, ${FIGURES}, ${HOURGLASS} 1 min Store status`,
    `${FIRE} 58 min, ${FIGURES}, ${HOURGLASS} <1 min Store`,
    `${FIRE} 57 min, ${FIGURES}, ${HOURGLASS} <1 min Store`,
    `${FIRE} 57 min, ${FIGURES}, ${HOURGLASS} 16 min October`,
  ])
  // Each emoji counted as two columns
  expect(shown.every(text => [...(text ?? '')].length + 3 <= 40)).toBe(true)
})

test('ranks a Chrome sign-in that ends with the caches that go cold, under a key', async ($, on) => {
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

  expect(shown.at(0)).toBe(`${FIRE} 59 min, ${FIGURES}, ${KEY} 4 min Bank export`)
  expect(shown.at(-1)).toBe(`${FIRE} 55 min, ${FIGURES}, ${HOURGLASS} 14 min October`)
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
  expect(shown.at(-1)).toBe(`${FIRE} 58 min, ${FIGURES}, ${HOURGLASS} 17 min October`)

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
  expect(shown.at(-1)).toBe(`${FIRE} 58 min, ${FIGURES}, ${HOURGLASS} 17 min October`)

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
    `${HOURGLASS} 18 min October role at the office`,
    `${HOURGLASS} 17 min October role at the office`,
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
