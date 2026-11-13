// Runs sync.sh between a throwaway remote, checkout and configuration directory, in the states a second computer
// leaves them in when a file sync shares the configuration directory with it, and checks what a run pulls and copies.
// No real remote is touched: gh is a stub, and every repository lives in the throwaway home folder.
// Usage: node test/sync/checks.mjs [path to sync.sh]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const SYNC = path.resolve(process.argv[2] || path.join(ROOT, 'sync.sh'))
const FILE = 'CLAUDE.md'
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sync-checks-')))
const bin = path.join(home, 'bin')
const ENV = { PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: path.join(home, 'tmp'), LANG: 'en_US.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file }
const read = file => fs.readFileSync(file, 'utf8')
const q = s => `'${s.replace(/'/g, `'\\''`)}'`
function sh(cmd, cwd = home) {
  const r = spawnSync('bash', ['-c', cmd], { cwd, env: ENV, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`setup failed: ${cmd}\n${r.stderr}`)
  return r.stdout.trim()
}

// The identity is put together at run time, so the scan of sync.sh finds it in no file of the checkout.
fs.mkdirSync(ENV.TMPDIR, { recursive: true })
write(path.join(home, '.gitconfig'), `[user]\n\tname = ${['Qzvx', 'Wjkq'].join(' ')}\n\temail = ${['qzvx', ['wjkq', 'invalid'].join('.')].join('@')}\n[init]\n\tdefaultBranch = main\n[protocol "file"]\n\tallow = always\n[commit]\n\tgpgsign = false\n`)
write(path.join(bin, 'gh'), '#!/bin/sh\nexit 0\n')
fs.chmodSync(path.join(bin, 'gh'), 0o755)

const rule = n => `- Rule ${n} stands as first written.`
const text = lines => lines.join('\n') + '\n'
const base = Array.from({ length: 12 }, (_, i) => rule(i + 1))
const change = (lines, edits) => lines.flatMap((line, i) => (i + 1 in edits ? edits[i + 1] : [line]))
// What the other computer commits: rule 3 rewritten, a rule added after rule 8 and rule 11 removed.
const first = change(base, { 3: ['- Rule 3 as the other computer rewrote it.'] })
const pulled = change(first, { 8: [rule(8), '- A rule the other computer added.'], 11: [] })
// What a session adds on top without committing it: far from the pulled lines, and right beside them.
const apart = change(pulled, { 6: ['- Rule 6 as a session rewrote it.'] })
const beside = change(pulled, { 4: ['- Rule 4 as a session rewrote it.'], 9: ['- A rule the other computer added.', '- A rule a session added.'] })
const MESSAGE = 'Rewrite rule 6\n\nPrompts behind this commit, as given to Claude Code\n(model a-model, effort high):\n\n1.\n> rewrite rule 6\n'

// The seed holds the files of this work tree, with the sync.sh under test and a short rules file.
const seed = path.join(home, 'seed')
const listed = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
for (const file of listed.stdout.split('\0').filter(Boolean)) {
  if (file === 'PROMPTS.md' || !fs.existsSync(path.join(ROOT, file))) continue
  fs.mkdirSync(path.dirname(path.join(seed, file)), { recursive: true })
  fs.copyFileSync(path.join(ROOT, file), path.join(seed, file))
}
fs.copyFileSync(SYNC, path.join(seed, 'sync.sh'))
write(path.join(seed, FILE), text(base))
sh(`git init -q ${q(seed)} && cd ${q(seed)} && git add -A && git commit -q -m seed && git clone -q --bare ${q(seed)} ${q(seed + '.git')}`)

let scenes = 0
// A remote, this computer's checkout and configuration directory after a first run, and the other computer's checkout.
function scene() {
  const dir = path.join(home, `scene-${++scenes}`)
  const s = { remote: path.join(dir, 'remote.git'), checkout: path.join(dir, 'checkout'), other: path.join(dir, 'other'), config: path.join(dir, 'config') }
  sh(`git clone -q --bare ${q(seed + '.git')} ${q(s.remote)} && git clone -q ${q(s.remote)} ${q(s.checkout)} && git clone -q ${q(s.remote)} ${q(s.other)}`)
  s.local = path.join(s.config, FILE)
  s.copy = path.join(s.checkout, FILE)
  s.lock = path.join(s.checkout, '.git/sync.lock')
  s.first = sync(s)
  return s
}
function sync(s, args = [], env = {}) {
  const r = spawnSync('bash', [path.join(s.checkout, 'sync.sh'), ...args], { cwd: home, env: { ...ENV, CLAUDE_CONFIG_DIR: s.config, ...env }, encoding: 'utf8', timeout: 120000 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const git = (s, cmd, dir = s.checkout) => sh(`git -C ${q(dir)} ${cmd}`)
// The file sync brings the other computer's file into the configuration directory.
const arrives = (s, lines) => write(s.local, text(lines))
// The other computer commits and pushes.
const pushes = (s, lines, file = FILE) => { write(path.join(s.other, file), text(lines)); git(s, `commit -q -am ${q('a commit of the other computer')}`, s.other); git(s, 'push -q', s.other) }
const pulledAll = s => git(s, 'rev-parse HEAD') === git(s, 'rev-parse HEAD', s.remote)
const installs = s => read(path.join(s.checkout, '.git/sync-installed.log')).split('\n').filter(l => l.endsWith(` ${s.local}`)).length
const refusedPull = r => /pull refused/.test(r.err)
const changedBoth = r => /changed both locally and in the pulled commits/.test(r.err)
// The state the file sync leaves when the other computer commits first: its file arrives, a run copies it into the
// checkout as a local change, and only then does the commit reach the remote.
function ahead(s, local, commits = [pulled]) {
  arrives(s, local)
  const copied = sync(s)
  const before = installs(s)
  for (const lines of commits) pushes(s, lines)
  const r = sync(s)
  return { ...r, copied: !refusedPull(copied) && read(s.copy) === text(local), kept: read(s.local) === text(local) && installs(s) === before && !fs.existsSync(s.lock) }
}

const suites = [
  ['a first run', () => {
    const s = scene()
    return [
      ['fills the configuration directory from the checkout', () => read(s.local) === text(base) && !refusedPull(s.first) && !fs.existsSync(s.lock)],
      ['copies a local change into the checkout', () => { arrives(s, apart); sync(s); return read(s.copy) === text(apart) && git(s, `status --porcelain -- ${FILE}`) === `M ${FILE}` }],
    ]
  }],

  ['a pull that the checkout copy of a mirrored file stands in the way of', () => [
    ['runs when both copies hold the pulled version, and leaves the file clean', () => {
      const s = scene(), r = ahead(s, pulled)
      return r.copied && !refusedPull(r) && !changedBoth(r) && pulledAll(s) && git(s, 'status --porcelain') === '' && r.kept
    }],
    ['says which file it put back to HEAD', () => {
      const s = scene(), r = ahead(s, pulled)
      return r.out.includes(`sync: ${FILE} put back to HEAD for the pull`)
    }],
    ['copies back a hunk the local copy holds on top of the pulled commits', () => {
      const s = scene(), r = ahead(s, apart)
      return r.copied && !refusedPull(r) && !changedBoth(r) && pulledAll(s) && r.kept && read(s.copy) === text(apart) &&
        git(s, `diff --numstat HEAD -- ${FILE}`) === `1\t1\t${FILE}`
    }],
    ['copies back hunks that sit right beside the pulled lines', () => {
      const s = scene(), r = ahead(s, beside)
      return !refusedPull(r) && !changedBoth(r) && pulledAll(s) && r.kept && read(s.copy) === text(beside) &&
        git(s, `diff --numstat HEAD -- ${FILE}`) === `2\t1\t${FILE}`
    }],
    ['runs over two pulled commits', () => {
      const s = scene(), r = ahead(s, apart, [first, pulled])
      return !refusedPull(r) && !changedBoth(r) && pulledAll(s) && r.kept && read(s.copy) === text(apart)
    }],
    ['stops on a local copy that lacks the pulled change, and overwrites neither copy with the other', () => {
      const s = scene(), mine = change(base, { 6: ['- Rule 6 as a session rewrote it.'] }), r = ahead(s, mine)
      return r.code === 1 && changedBoth(r) && pulledAll(s) && r.kept && read(s.copy) === text(pulled)
    }],
    ['stops on a local copy that holds only the first of two pulled commits', () => {
      const s = scene(), r = ahead(s, change(first, { 6: ['- Rule 6 as a session rewrote it.'] }), [first, pulled])
      return r.code === 1 && changedBoth(r) && r.kept
    }],
    ['stops on a local copy that brings back a line the pull removed', () => {
      const s = scene(), r = ahead(s, change(pulled, { 12: [rule(11), rule(12)] }))
      return r.code === 1 && changedBoth(r) && r.kept
    }],
    ['stays refused when the two copies differ, and runs once a run has copied the local one', () => {
      const s = scene()
      arrives(s, first); sync(s); arrives(s, pulled); pushes(s, pulled)
      const head = git(s, 'rev-parse HEAD'), r = sync(s), stayed = git(s, 'rev-parse HEAD') === head, next = sync(s)
      return r.code === 1 && refusedPull(r) && stayed && read(s.local) === text(pulled) && !refusedPull(next) && pulledAll(s) && git(s, 'status --porcelain') === ''
    }],
    ['stays refused when a file that is not mirrored is in the way too, and puts nothing back', () => {
      const s = scene()
      arrives(s, pulled); sync(s)
      fs.appendFileSync(path.join(s.checkout, 'README.md'), '\nA line a session added here.\n')
      fs.appendFileSync(path.join(s.other, 'README.md'), '\nA line the other computer added.\n')
      pushes(s, pulled)
      const r = sync(s)
      return r.code === 1 && refusedPull(r) && !pulledAll(s) && read(s.copy) === text(pulled) && read(s.local) === text(pulled) &&
        git(s, 'status --porcelain') === `M ${FILE}\n M README.md` && !fs.existsSync(s.lock)
    }],
    ['stays refused when this checkout holds a commit the remote lacks', () => {
      const s = scene()
      arrives(s, pulled); sync(s)
      git(s, `commit -q --allow-empty -m ${q('a commit made here')}`)
      pushes(s, pulled)
      const r = sync(s)
      return r.code === 1 && refusedPull(r) && read(s.copy) === text(pulled) && read(s.local) === text(pulled)
    }],
    ['leaves out a mirrored file the remote deleted once the file sync removed it, and puts back one the remote kept', () => {
      const s = scene(), gone = 'hooks/calendar-free-busy-only.sh', kept = 'hooks/check-not-piped.sh'
      fs.appendFileSync(path.join(s.checkout, 'README.md'), '\nA line a session added here.\n')
      fs.appendFileSync(path.join(s.other, 'README.md'), '\nA line the other computer added.\n')
      git(s, `rm -q ${gone}`, s.other); pushes(s, pulled)
      for (const file of [gone, kept]) fs.rmSync(path.join(s.config, file))
      const r = sync(s)
      return r.code === 1 && refusedPull(r) && r.out.includes(`sync: ${gone} is gone upstream`) &&
        !fs.existsSync(path.join(s.config, gone)) && fs.existsSync(path.join(s.config, kept))
    }],
  ]],

  ['a pull that nothing stands in the way of', () => [
    ['copies in a local copy that holds the pulled change and a hunk on top of it', () => {
      const s = scene()
      pushes(s, pulled); arrives(s, beside)
      const r = sync(s)
      return !changedBoth(r) && pulledAll(s) && read(s.local) === text(beside) && read(s.copy) === text(beside)
    }],
    ['installs the pulled version over a local copy still as committed', () => {
      const s = scene()
      pushes(s, pulled)
      const r = sync(s)
      return !changedBoth(r) && pulledAll(s) && read(s.local) === text(pulled) && git(s, 'status --porcelain') === ''
    }],
    ['stops on a local copy that changed without the pulled change', () => {
      const s = scene(), mine = change(base, { 6: ['- Rule 6 as a session rewrote it.'] })
      pushes(s, pulled); arrives(s, mine)
      const r = sync(s)
      return r.code === 1 && changedBoth(r) && read(s.local) === text(mine) && read(s.copy) === text(pulled)
    }],
  ]],

  ['sync.sh --commit after such a pull', () => [
    ['commits the session\'s own hunk on top of the pulled commits and leaves another session\'s in the work tree', () => {
      const s = scene(), own = change(base, { 6: ['- Rule 6 as a session rewrote it.'] })
      const both = change(apart, { 11: ['- Rule 10 as another session rewrote it.'] })
      const blob = lines => git(s, `hash-object -w ${q(write(path.join(home, 'blob'), text(lines)))}`)
      const records = path.join(s.checkout, '.git/own-hunks/s1')
      write(records, `${blob(base)} ${blob(own)} ${FILE}\n`)
      arrives(s, both); sync(s); pushes(s, pulled)
      const message = write(path.join(home, 'message'), MESSAGE)
      const r = sync(s, ['--commit', message, FILE], { CLAUDE_CODE_SESSION_ID: 's1' })
      return !refusedPull(r) && !changedBoth(r) && /pushed/.test(r.out) && pulledAll(s) &&
        git(s, `show HEAD:${FILE}`, s.remote) === text(apart).trim() && git(s, 'log -1 --format=%s') === 'Rewrite rule 6' &&
        read(s.copy) === text(both) && read(s.local) === text(both) && git(s, `diff --numstat HEAD -- ${FILE}`) === `1\t1\t${FILE}` &&
        !fs.existsSync(records) && !fs.existsSync(s.lock)
    }],
  ]],

  ['sync.sh --commit with a message that has no prompts section', () => [
    ['stops before the sync, commits nothing and names the command that prints the section', () => {
      const s = scene()
      arrives(s, change(base, { 6: ['- Rule 6 as a session rewrote it.'] }))
      const r = sync(s, ['--commit', write(path.join(home, 'message'), 'Rewrite rule 6\n'), FILE])
      return r.code === 2 && /the message has no prompts section/.test(r.err) && /prompt-log\.sh print --commit/.test(r.err) &&
        git(s, `show HEAD:${FILE}`, s.remote) === text(base).trim() && read(s.copy) === text(base) && !fs.existsSync(s.lock)
    }],
  ]],

  ['sync.sh --commit beside another session\'s edits of the same file', () => {
    const own = change(base, { 6: ['- Rule 6 as a session rewrote it.'] })
    const theirs = change(base, { 10: ['- Rule 10 as another session rewrote it.'] })
    const both = change(own, { 10: ['- Rule 10 as another session rewrote it.'] })
    const blob = (s, lines) => git(s, `hash-object -w ${q(write(path.join(home, 'blob'), text(lines)))}`)
    const record = (s, session, from, to) => {
      const file = path.join(s.checkout, '.git/own-hunks', session)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, `${blob(s, from)} ${blob(s, to)} ${FILE}\n`)
    }
    // A tool call of session s2 that still runs and saw the file as it was at its start.
    const running = (s, seen) => write(path.join(s.checkout, '.git/own-hunks/pending/s2.toolu_x'),
      `${Math.floor(Date.now() / 1000)}\n${git(s, 'rev-parse HEAD')}\n${blob(s, seen)}\t${FILE}\t${s.local}\n`)
    const holding = lines => { const s = scene(); arrives(s, lines); sync(s); return s }
    const commit = s => sync(s, ['--commit', write(path.join(home, 'message'), MESSAGE), FILE], { CLAUDE_CODE_SESSION_ID: 's1' })
    const remote = s => git(s, `show HEAD:${FILE}`, s.remote)
    const refused = (s, r, named = 'session s2') => r.code === 1 && r.err.includes(named) && /nothing committed/.test(r.err) &&
      remote(s) === text(base).trim() && read(s.copy) === read(s.local) && !fs.existsSync(s.lock)
    return [
      ['commits its own edit and leaves the edit the other session recorded in the work tree', () => {
        const s = holding(both)
        record(s, 's1', base, own); record(s, 's2', base, theirs)
        const r = commit(s)
        return r.code === 0 && remote(s) === text(own).trim() && read(s.copy) === text(both)
      }],
      ['stops when a line of its own took the other session\'s edit, as one made while a long call of its own ran', () => {
        const s = holding(both)
        record(s, 's1', base, own); record(s, 's1', own, both); record(s, 's2', own, both)
        return refused(s, commit(s)) && fs.existsSync(path.join(s.checkout, '.git/own-hunks/s1'))
      }],
      ['stops on a file that goes in whole while the other session\'s edit of it waits uncommitted', () => {
        const s = holding(both)
        record(s, 's2', base, theirs)
        return refused(s, commit(s))
      }],
      ['takes a file whole once HEAD holds the edit the other session recorded', () => {
        const s = scene()
        pushes(s, theirs); sync(s); arrives(s, both); sync(s)
        record(s, 's2', base, theirs)
        const r = commit(s)
        return r.code === 0 && remote(s) === text(both).trim()
      }],
      ['stops on a file that goes in whole and changed since a running call of the other session began', () => {
        const s = holding(own)
        running(s, base)
        return refused(s, commit(s), '.git/own-hunks/pending/s2.toolu_x')
      }],
      ['takes a file whole while that call has seen it as it is', () => {
        const s = holding(own)
        running(s, own)
        const r = commit(s)
        return r.code === 0 && remote(s) === text(own).trim()
      }],
    ]
  }],

  ['a mirror in a clone that hooks/share-memories.sh commits in too', () => {
    // A scene whose checkout lists a folder of a second clone in sync-mirrors.txt, as the shared library is.
    const mirrored = () => {
      const s = scene(), dir = path.dirname(s.checkout)
      s.mirrorRemote = path.join(dir, 'mirror.git'); s.mirror = path.join(dir, 'mirror'); s.peer = path.join(dir, 'mirror-peer')
      sh(`git init -q --bare ${q(s.mirrorRemote)} && git clone -q ${q(s.mirrorRemote)} ${q(s.mirror)} 2>/dev/null && cd ${q(s.mirror)} && git commit -q --allow-empty -m seed && git push -q -u origin main && git clone -q ${q(s.mirrorRemote)} ${q(s.peer)}`)
      write(path.join(s.checkout, 'sync-mirrors.txt'), `${s.mirror}/me\n`)
      s.mirrored = path.join(s.mirror, 'me', FILE)
      fs.mkdirSync(path.dirname(s.mirrored))
      s.cloneLock = path.join(s.mirror, '.git/claude-clone.lock')
      return s
    }
    const message = () => write(path.join(home, 'message'), MESSAGE)
    const own = change(base, { 6: ['- Rule 6 as a session rewrote it.'] })
    return [
      ['copies into the mirror and lets the clone lock go', () => {
        const s = mirrored(), r = sync(s)
        return r.code === 0 && read(s.mirrored) === text(base) && !fs.existsSync(s.cloneLock) && !fs.existsSync(s.lock)
      }],
      ['waits while the hook holds the clone lock, then copies', () => {
        const s = mirrored()
        fs.mkdirSync(s.cloneLock)
        sh(`(sleep 2; rmdir ${q(s.cloneLock)}) > /dev/null 2>&1 &`)
        const start = Date.now(), r = sync(s)
        return r.code === 0 && Date.now() - start >= 1500 && read(s.mirrored) === text(base) && !fs.existsSync(s.cloneLock)
      }],
      ['stops on a rebase stopped halfway in the mirror, and copies nothing there', () => {
        const s = mirrored()
        sync(s)
        fs.mkdirSync(path.join(s.mirror, '.git/rebase-merge'))
        arrives(s, own)
        const r = sync(s)
        return r.code === 1 && /a rebase stopped halfway/.test(r.err) && read(s.mirrored) === text(base) && !fs.existsSync(s.cloneLock)
      }],
      ['under --commit, undoes a mirror rebase that stops, commits nothing there and lets the lock go', () => {
        const s = mirrored()
        sync(s)
        git(s, `add -A && git -C ${q(s.mirror)} commit -q -m ${q('the first copy')}`, s.mirror)
        write(path.join(s.mirror, 'me/notes.md'), 'a line committed here\n')
        git(s, `add -A && git -C ${q(s.mirror)} commit -q -m ${q('a commit made here')}`, s.mirror)
        write(path.join(s.peer, 'me/notes.md'), 'a line the hook pushed from elsewhere\n')
        git(s, `add -A && git -C ${q(s.peer)} commit -q -m ${q('a commit pushed meanwhile')} && git -C ${q(s.peer)} push -q`, s.peer)
        const head = git(s, 'rev-parse HEAD', s.mirror)
        arrives(s, own)
        const r = sync(s, ['--commit', message(), FILE])
        return r.code === 1 && /stopped in .* and is undone/.test(r.err) && git(s, `show HEAD:${FILE}`, s.remote) === text(own).trim() &&
          git(s, 'rev-parse HEAD', s.mirror) === head && !fs.existsSync(path.join(s.mirror, '.git/rebase-merge')) && !fs.existsSync(s.cloneLock)
      }],
    ]
  }],
]

let failed = 0
let total = 0
for (const [name, make] of suites) {
  console.log(`== ${name}`)
  let checks = []
  try { checks = make() } catch (e) { checks = [['sets up', () => { throw e }]] }
  for (const [desc, check] of checks) {
    let pass = false, note = ''
    try { pass = Boolean(check()) } catch (e) { note = `\n    ${String(e.message).split('\n').join('\n    ')}` }
    total++
    if (!pass) failed++
    console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${desc}${note}`)
  }
}
fs.rmSync(home, { recursive: true, force: true })
console.log(failed ? `${failed} of ${total} checks failed` : `all ${total} checks passed`)
process.exit(failed ? 1 : 0)
