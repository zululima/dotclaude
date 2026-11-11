// Runs the evals of this repository and prints their results. With --write it also writes them into docs/evals.md
// between the evals markers, unless only the dates would change. Exits 1 when a check failed or a suite did not run.
// Usage: node test/evals.mjs [--write]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const EVALS = path.join(ROOT, 'docs/evals.md')
const START = '<!-- evals:start -->'
const END = '<!-- evals:end -->'

const exec = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024 })
const firstLine = text => String(text || '').trim().split('\n')[0]

function checks(file) {
  const r = exec(process.execPath, [file])
  const pass = (r.stdout.match(/^ +PASS:/gm) || []).length
  const fail = (r.stdout.match(/^ +FAIL:/gm) || []).length + (r.stdout.match(/^CRASH /gm) || []).length
  return pass + fail ? { pass, fail } : { error: firstLine(r.stderr) || 'it printed no checks' }
}

function modTests(dir) {
  const r = exec(process.env.CLAUDE_CODE_EXECPATH || 'claude', ['plugin', 'test', dir])
  if (r.error) return { error: 'the claude command was not found' }
  const out = `${r.stdout}\n${r.stderr}`
  const pass = out.match(/^\s*(\d+) pass$/m), fail = out.match(/^\s*(\d+) fail$/m)
  return pass && fail ? { pass: Number(pass[1]), fail: Number(fail[1]) } : { error: firstLine(r.stderr) || 'it printed no results' }
}

const suites = [
  { name: 'Hook tests', link: 'test/hooks/checks.mjs', what: 'every hook, fed the input Claude Code sends it', ...checks('test/hooks/checks.mjs') },
  { name: 'Sync tests', link: 'test/sync/checks.mjs', what: 'what `sync.sh` pulls and copies between two computers, against a throwaway remote', ...checks('test/sync/checks.mjs') },
  { name: 'Dream simulation', link: 'test/dream-sim/checks.mjs', what: 'how `/dream` spends usage and when it stops', ...checks('test/dream-sim/checks.mjs') },
  { name: 'Usage mod tests', link: 'mods/session-usage/hooks/register.test.ts', what: 'the line under the prompt box', ...modTests('mods/session-usage') },
]
const counted = exec(process.execPath, ['test/rules/adherence.mjs', '--json'])
let rules = null
try { rules = JSON.parse(counted.stdout) } catch { rules = null }

const result = s => s.error ? `not run: ${s.error}` : `${s.pass} of ${s.pass + s.fail} pass`
const share = r => r.total ? `${Math.floor(100 * r.kept / r.total)}% (${r.kept} of ${r.total} ${r.unit})` : `no ${r.unit} to count`

const section = [
  START,
  '| Suite | What it checks | Result |',
  '| --- | --- | --- |',
  ...suites.map(s => `| [${s.name}](../${s.link}) | ${s.what} | ${result(s)} |`),
  '',
  ...(rules ? [
    `How often Claude kept rules from [\`CLAUDE.md\`](../CLAUDE.md) from ${rules.from} to ${rules.to}, in ${rules.sessions} of my own sessions and the commits of the ${rules.repos} repositories they worked in, counted by [\`test/rules/adherence.mjs\`](../test/rules/adherence.mjs):`,
    '',
    '| Rule | Kept |',
    '| --- | --- |',
    ...rules.rules.map(r => `| ${r.name} | ${share(r)} |`),
  ] : [`The rule counts could not be made: ${firstLine(counted.stderr) || 'no output'}.`]),
  END,
].join('\n')

for (const s of suites) console.log(`${s.name}: ${result(s)}`)
if (rules) for (const r of rules.rules) console.log(`${r.name}: ${share(r)}, ${rules.from} to ${rules.to}`)
else console.log('Rule counts: not made')

if (process.argv.includes('--write')) {
  const text = fs.readFileSync(EVALS, 'utf8')
  const a = text.indexOf(START), b = text.indexOf(END)
  if (a < 0 || b < a) {
    console.error(`docs/evals.md has no ${START} ... ${END} block`)
    process.exit(2)
  }
  const old = text.slice(a, b + END.length)
  const undated = s => s.replace(/\d{4}-\d\d-\d\d/g, '')
  if (undated(old) === undated(section)) {
    console.log('docs/evals.md: the numbers are unchanged, so the file stays as it is')
  } else {
    fs.writeFileSync(EVALS, text.slice(0, a) + section + text.slice(b + END.length))
    console.log('docs/evals.md: updated')
  }
}
process.exit(suites.some(s => s.error || s.fail) || !rules ? 1 : 0)
