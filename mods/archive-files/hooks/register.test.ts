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
