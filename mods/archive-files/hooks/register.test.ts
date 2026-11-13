import { expect, mock, test } from 'claude-code/testing'

const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const
const NOW = 1792488000_000
const ROOT = '/me/Library/Application Support/Claude/claude-code-sessions'
const INDEX = `${ROOT}/org/account/archived-sessions.idx`

const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })
const ran = { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }

test('runs the script at the start and within seconds of each archive in the app', async ($, on) => {
  const argvs: string[][] = []
  let archivedAt = NOW - 600_000
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/me' })
  on('fs.list', ($, e) => {
    if (e.path === ROOT) return { value: [entry('org', 'dir')] }
    if (e.path === `${ROOT}/org`) return { value: [entry('account', 'dir'), entry('local_1.json', 'file')] }
    return { value: [] }
  })
  on('fs.stat', ($, e) =>
    e.path === INDEX ? { value: { kind: 'file', size: 4, mtimeMs: archivedAt, isLink: false } } : { deny: 'missing' },
  )
  on('process.run', ($, e) => {
    argvs.push([...e.argv])
    return ran
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await clock.advance(5_000)
  expect(argvs).toHaveLength(1)
  expect(argvs[0]?.[0]).toMatch(/\/archive-files\.sh$/)

  archivedAt = NOW + 6_000
  await clock.advance(5_000)
  expect(argvs).toHaveLength(2)

  await clock.advance(5_000)
  expect(argvs).toHaveLength(2)
})

test('tries the Chrome tab groups left once a minute until a run clears them', async ($, on) => {
  const STATE = '/me/Library/Application Support/claude-archive-files'
  const argvs: string[][] = []
  const files = new Map<string, number>([
    [STATE, NOW],
    [`${STATE}/groups-swept`, NOW - 600_000],
    [`${STATE}/groups-pending`, NOW],
    [INDEX, NOW - 600_000],
  ])
  let now = NOW
  const clock = mock.clock(on, { now: NOW })
  const wait = async (seconds: number) => {
    for (let s = 0; s < seconds; s += 5) {
      now += 5_000
      await clock.advance(5_000)
    }
  }
  mock.env(on, { HOME: '/me' })
  on('fs.list', ($, e) => {
    if (e.path === ROOT) return { value: [entry('org', 'dir')] }
    if (e.path === `${ROOT}/org`) return { value: [entry('account', 'dir')] }
    return { value: [] }
  })
  on('fs.stat', ($, e) => {
    const at = files.get(e.path.replace(/\/\.$/, ''))
    return at === undefined ? { deny: 'missing' } : { value: { kind: 'file', size: 0, mtimeMs: at, isLink: false } }
  })
  on('process.run', ($, e) => {
    argvs.push([...e.argv])
    if (e.argv[1] === '--groups') files.set(`${STATE}/groups-checked`, now)
    return ran
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await wait(5)
  expect(argvs.map(a => a.slice(1))).toEqual([[], ['--groups']])

  await wait(30)
  expect(argvs).toHaveLength(2)

  await wait(35)
  expect(argvs.map(a => a.slice(1))).toEqual([[], ['--groups'], ['--groups']])

  files.delete(`${STATE}/groups-pending`)
  await wait(120)
  expect(argvs).toHaveLength(3)
})

test('does nothing outside the desktop app', async ($, on) => {
  const argvs: string[][] = []
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/me' })
  on('fs.list', () => ({ value: [] }))
  on('process.run', ($, e) => {
    argvs.push([...e.argv])
    return ran
  })
  on('session.start', () => ({ cwd: '/' }))

  await $.session.start(START)
  await clock.advance(15_000)
  expect(argvs).toEqual([])
})
