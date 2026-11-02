// Feeds each hook in hooks/ the JSON Claude Code would send it, inside a throwaway home folder, and checks what it does.
// Usage: node test/hooks/checks.mjs [path to hooks/]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const HOOKS = path.resolve(process.argv[2] || path.join(ROOT, 'hooks'))
const USAGE_SH = path.join(ROOT, 'mods/session-usage/usage.sh')
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-checks-')))
const config = path.join(home, '.claude')
// Addresses and home paths are put together at run time, so the sync.sh scan does not take them for real ones.
const address = (name, domain = 'example.com') => [name, domain].join('@')
const otherHome = ['', 'Users', 'someone'].join('/')
const linuxHome = ['', 'home', 'someone'].join('/')
const ENV = { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: config, TMPDIR: path.join(home, 'tmp'), LANG: 'en_US.UTF-8', GIT_CONFIG_NOSYSTEM: '1' }

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file }
const jsonl = (file, records) => write(file, records.map(r => JSON.stringify(r)).join('\n') + '\n')
const q = s => `'${s.replace(/'/g, `'\\''`)}'`
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
fs.mkdirSync(ENV.TMPDIR, { recursive: true })
write(path.join(home, '.gitconfig'), `[user]\n\tname = Test\n\temail = ${address('test')}\n[init]\n\tdefaultBranch = main\n[protocol "file"]\n\tallow = always\n[commit]\n\tgpgsign = false\n`)

function sh(cmd, cwd = home) {
  const r = spawnSync('bash', ['-c', cmd], { cwd, env: ENV, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`setup failed: ${cmd}\n${r.stderr}`)
  return r.stdout
}
function run(hook, input, { args = [], env = {}, cwd = home } = {}) {
  const r = spawnSync('bash', [path.join(HOOKS, hook), ...args], {
    cwd, env: { ...ENV, ...env }, encoding: 'utf8', timeout: 30000,
    input: typeof input === 'string' ? input : JSON.stringify(input),
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const quiet = r => r.code === 0 && r.out === '' && r.err === ''
const refused = r => r.code === 2 && r.err !== ''
const output = r => { try { return JSON.parse(r.out) } catch { return {} } }
const decision = r => output(r).hookSpecificOutput?.permissionDecision || ''
const context = r => output(r).hookSpecificOutput?.additionalContext || ''
const bash = (command, cwd = home) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd, session_id: 's1' })
const human = content => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content } })
const says = text => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const uses = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
const toolResult = content => ({ type: 'user', message: { content: [{ type: 'tool_result', content }] } })

const suites = [
  ['calendar-free-busy-only.sh', run => [
    ['lets the user\'s own calendar through', () => quiet(run({ tool_input: { calendarId: 'primary' } }))],
    ['lets a shared group calendar through', () => quiet(run({ tool_input: { calendarId: address('team', 'group.calendar.google.com') } }))],
    ['denies another person\'s calendar', () => decision(run({ tool_input: { calendarId: address('someone') } })) === 'deny'],
  ]],

  ['push-only-when-locked.sh', run => {
    const push = { hook_event_name: 'PreToolUse', tool_name: 'PushNotification', tool_input: { message: 'Sign-in waits', status: 'proactive' } }
    const marker = path.join(home, 'present')
    return [
      ['lets a push through with no marker set', () => quiet(run(push))],
      ['lets a push through while the screen is locked', () => quiet(run(push, { env: { CLAUDE_CLIENT_PRESENCE_FILE: marker } }))],
      ['denies a push while the screen is unlocked', () => {
        write(marker, '')
        return decision(run(push, { env: { CLAUDE_CLIENT_PRESENCE_FILE: marker } })) === 'deny'
      }],
    ]
  }],

  ['check-not-piped.sh', run => [
    ['refuses a test run piped into tail', () => refused(run(bash('npm test | tail -5')))],
    ['refuses vitest piped into grep', () => refused(run(bash('npx vitest run 2>&1 | grep FAIL')))],
    ['refuses make test piped after a cd', () => refused(run(bash('cd app && make test | tee log')))],
    ['lets it through with pipefail set', () => quiet(run(bash('set -o pipefail; npm test | tail -5')))],
    ['lets output sent to a file through', () => quiet(run(bash('npm test > /tmp/test.log 2>&1; echo exit=$?')))],
    ['ignores the words inside quotes', () => quiet(run(bash("echo 'npm test | tail'")))],
    ['ignores a pipe that holds no check', () => quiet(run(bash('git log --oneline | head')))],
  ]],

  ['no-github-posts.sh', run => [
    ['refuses gh pr comment', () => refused(run(bash('gh pr comment 12 --body hi')))],
    ['refuses gh issue comment', () => refused(run(bash('gh issue comment 3 -b hi')))],
    ['refuses gh pr review', () => refused(run(bash('gh pr review 12 --approve')))],
    ['refuses a close with a comment', () => refused(run(bash('gh issue close 3 --comment done')))],
    ['lets a close without a comment through', () => quiet(run(bash('gh issue close 3')))],
    ['refuses a gh api post to a comments path', () => refused(run(bash('gh api repos/o/r/issues/3/comments -f body=hi')))],
    ['lets a gh api read of comments with -X GET through', () => quiet(run(bash('gh api -X GET repos/o/r/pulls/3/comments -f per_page=100')))],
    ['refuses a GraphQL mutation that resolves a thread', () => refused(run(bash(`gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "x"}) { thread { id } } }'`)))],
    ['lets reading a PR through', () => quiet(run(bash('gh pr view 12 --comments')))],
    ['ignores a gh command named in a grep', () => quiet(run(bash("grep 'gh pr comment' notes.md")))],
    ['lets a PR body edit through', () => quiet(run(bash('gh pr edit 12 --body-file body.md')))],
  ]],

  ['one-draft-pr-per-repo.sh', run => {
    const fake = path.join(home, 'fake-gh'), args = path.join(home, 'gh-args')
    fs.chmodSync(write(path.join(fake, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$*" > ${q(args)}\n[ -n "$FAKE_GH" ] && printf '%s\\n' "$FAKE_GH"\nexit \${FAKE_GH_CODE:-0}\n`), 0o755)
    const env = (drafts, code = 0) => ({ env: { PATH: `${fake}:${ENV.PATH}`, FAKE_GH: drafts, FAKE_GH_CODE: String(code) } })
    const draft = '  #132 (feat/report) https://github.com/o/r/pull/132'
    const create = 'gh pr create --repo o/r --draft --base dev --head docs/fix --body-file body.md'
    return [
      ['refuses gh pr create while a draft is open', () => { const r = run(bash(create), env(draft)); return refused(r) && r.err.includes('#132 (feat/report)') }],
      ['asks gh for the user\'s open drafts in the named repository', () => /--draft/.test(fs.readFileSync(args, 'utf8')) && / --repo o\/r$/.test(fs.readFileSync(args, 'utf8').trim())],
      ['lets the same command through the second time', () => quiet(run(bash(create), env(draft)))],
      ['refuses again for another set of drafts', () => refused(run(bash(create), env(`${draft}\n  #140 (feat/next) https://github.com/o/r/pull/140`)))],
      ['lets it through with no draft open', () => quiet(run(bash('gh pr create -R o/s --draft'), env('')))],
      ['lets it through when gh fails', () => quiet(run(bash('gh pr create -R o/t --draft'), env(draft, 1)))],
      ['ignores gh pr list and gh pr edit', () => quiet(run(bash('gh pr list --author @me && gh pr edit 3 --body-file b.md'), env(draft)))],
      ['ignores a gh pr create named in quotes', () => quiet(run(bash("echo 'gh pr create --draft'"), env(draft)))],
    ]
  }],

  ['no-home-search.sh', run => [
    ['refuses find in the home folder', () => refused(run(bash('find ~ -name x')))],
    ['refuses find in $HOME', () => refused(run(bash('find "$HOME" -name x')))],
    ['refuses grep -r from the root', () => refused(run(bash('grep -r secret /')))],
    ['refuses mdfind without -onlyin', () => refused(run(bash('mdfind kMDItemDisplayName=x')))],
    ['refuses find . after a cd to the home folder', () => refused(run(bash('cd ~ && find . -name x', path.join(home, 'Projects'))))],
    ['refuses find . after a cd to "$HOME"', () => refused(run(bash('cd "$HOME" && find . -name x', path.join(home, 'Projects'))))],
    ['refuses find . run from the home folder', () => refused(run(bash('find . -name x')))],
    ['refuses another user\'s home folder', () => refused(run(bash(`du -sh ${otherHome}`)))],
    ['lets mdfind -onlyin through', () => quiet(run(bash('mdfind -onlyin ~/Projects x')))],
    ['lets find in a project folder through', () => quiet(run(bash('find ~/Projects/app -name x')))],
    ['lets find . in a project folder through', () => quiet(run(bash('find . -name x', path.join(home, 'Projects'))))],
    ['lets find . after a cd to a quoted path through', () => quiet(run(bash(`cd "${home}/Library/Application Support/x" && find . -name x`)))],
    ['lets grep -r . after cd "$D" through', () => quiet(run(bash('D=/tmp/x && cd "$D" || exit 1; grep -rn foo .')))],
    ['lets a plain grep of one file through', () => quiet(run(bash('grep secret /etc/hosts')))],
  ]],

  ['cd-fall-through.sh', run => [
    ['refuses a part after ; when the cd can fail', () => refused(run(bash('cd /nonexistent-dir; rm -rf build')))],
    ['refuses it on the next line too', () => refused(run(bash('cd /nonexistent-dir\nmake clean')))],
    ['refuses it inside a subshell', () => refused(run(bash('(cd /nonexistent-dir; ls)')))],
    ['resolves a variable set in the command', () => refused(run(bash('D=/nonexistent-dir; cd $D; ls')))],
    ['lets && after the cd through', () => quiet(run(bash('(cd /nonexistent-dir && ls)')))],
    ['lets a cd guarded with || exit through', () => quiet(run(bash('cd /nonexistent-dir || exit 1; ls')))],
    ['lets a cd after set -e through', () => quiet(run(bash('set -e; cd /nonexistent-dir; ls')))],
    ['lets a cd into a folder that exists through', () => quiet(run(bash('cd /tmp; ls')))],
    ['lets a cd with nothing after it through', () => quiet(run(bash('cd /nonexistent-dir')))],
    ['ignores a cd inside quotes', () => quiet(run(bash("echo 'cd /nonexistent-dir; ls'")))],
  ]],

  ['no-foreground-wait.sh', run => {
    const task = '/tmp/claude/p/s1/tasks/b1a2c3.output'
    const wait = (command, extra = {}) => ({ ...bash(command), tool_input: { command, timeout: 600000, ...extra } })
    return [
      ['refuses an until-loop on a task output file', () => refused(run(wait(`until grep -q '^NAME' ${task}; do sleep 3; done`)))],
      ['refuses a while-loop on it at the default timeout', () => refused(run(bash(`while ! grep -q ok "${task}"; do sleep 5; done`)))],
      ['refuses a loop that reads it through a variable', () => refused(run(wait(`F=${task}; for i in $(seq 1 54); do grep -q ok "$F" && break; sleep 10; done`)))],
      ['lets the same loop through in the background', () => quiet(run(wait(`until grep -q ok ${task}; do sleep 3; done`, { run_in_background: true })))],
      ['lets it through with a timeout of a minute or less', () => quiet(run(wait(`until grep -q ok ${task}; do sleep 1; done`, { timeout: 60000 })))],
      ['lets a loop on a server through', () => quiet(run(wait('until curl -s localhost:11434/api/version; do sleep 0.5; done; ollama list')))],
      ['lets a loop that never reads the file through', () => quiet(run(wait(`tail -2 ${task}; for tab in map me; do sleep 14; done`)))],
      ['ignores a loop inside quotes', () => quiet(run(wait(`echo 'until grep -q ok ${task}; do sleep 3; done'`)))],
    ]
  }],

  ['no-slow-binary-grep.sh', run => [
    ['refuses grep -a with a window before the name', () => refused(run(bash(`B=./claude; grep -a -o '.\\{600\\}NAME.\\{600\\}' "$B" | head -3`)))],
    ['refuses /usr/bin/grep -E with a {0,n} window', () => refused(run(bash(`LC_ALL=C /usr/bin/grep -a -o -E '.{0,120}Some label' ./claude | head -2`)))],
    ['refuses a bracket window in double quotes', () => refused(run(bash('LC_ALL=C grep -ao "[^;]\\{0,400\\}NAME" "$CLAUDE_CODE_EXECPATH"')))],
    ['names the byte offset recipe', () => run(bash(`grep -ao '.{0,9}x' f`)).err.includes('grep -a -b -o -F')],
    ['lets the name first through', () => quiet(run(bash(`LC_ALL=C grep -a -o 'NAME[^;]\\{0,400\\}' ./claude`)))],
    ['lets a fixed-string offset search through', () => quiet(run(bash('LC_ALL=C grep -a -b -o -F NAME ./claude | cut -d: -f1')))],
    ['lets a window through without -a', () => quiet(run(bash(`grep -o '.{0,40}error' build.log`)))],
    ['ignores the words inside quotes', () => quiet(run(bash(`echo 'grep -a .{0,9}x'`)))],
  ]],

  ['no-identity-override.sh', run => [
    ['refuses git -c user.email=', () => refused(run(bash(`git -c user.email=${address('bot')} commit -m fix`)))],
    ['refuses git -c user.name= among other -c options', () => refused(run(bash('git -c core.editor=true -c user.name=Bot commit -m fix')))],
    ['refuses GIT_AUTHOR_EMAIL= before git commit', () => refused(run(bash(`GIT_AUTHOR_EMAIL=${address('bot')} git commit -m fix`)))],
    ['refuses an exported GIT_COMMITTER_NAME', () => refused(run(bash('export GIT_COMMITTER_NAME=Bot && git commit -m fix')))],
    ['refuses git commit --author', () => refused(run(bash(`git -C repo commit -q --author="Bot <${address('bot')}>" -m fix`)))],
    ['names the Signed-off-by trailer for a second person', () => run(bash('git commit --author=Bot -m fix')).err.includes('Signed-off-by:')],
    ['asks before git config user.email <address>', () => decision(run(bash(`git config user.email ${address('me')}`))) === 'ask'],
    ['asks before git config --global --unset user.name', () => decision(run(bash('git config --global --unset user.name'))) === 'ask'],
    ['lets a read of git config user.email through', () => quiet(run(bash('git config user.email')))],
    ['lets a plain git commit through', () => quiet(run(bash("git add a.txt && git commit -m 'fix the parser'")))],
    ['lets git log --author through', () => quiet(run(bash('git log --author=someone --oneline')))],
    ['ignores the words inside quotes', () => quiet(run(bash(`echo 'git -c user.email=x commit --author=y' && git commit -m "never set GIT_AUTHOR_EMAIL=x"`)))],
    ['ignores the words inside a heredoc body', () => quiet(run(bash(`cat > notes.md <<'EOF'\ngit -c user.email=x commit --author="Bot <b>"\nGIT_AUTHOR_EMAIL=x git config user.name Bot\nEOF\ngit add notes.md`)))],
  ]],

  ['no-git-checkout.sh', run => [
    ['refuses a branch change with git checkout', () => refused(run(bash('git checkout main')))],
    ['refuses a file restore with git checkout', () => refused(run(bash('git checkout HEAD~1 -- src/a.ts')))],
    ['names git restore --source for a file from a commit', () => run(bash('git checkout HEAD~1 -- src/a.ts')).err.includes('git restore --source')],
    ['lets gh pr checkout through', () => quiet(run(bash('gh pr checkout 12')))],
    ['lets git switch through', () => quiet(run(bash('git switch main')))],
    ['ignores the word in an echo', () => quiet(run(bash('echo git checkout is old')))],
  ]],

  ['claude-md-changed.sh', run => {
    const rules = path.join(config, 'CLAUDE.md')
    const event = (hook_event_name, extra = {}) => ({ hook_event_name, session_id: 'md1', transcript_path: '', ...extra })
    const commit = event('PreToolUse', { tool_input: { command: 'git commit -F msg.txt' } })
    const skill = path.join(config, 'skills/pull-requests/SKILL.md')
    const prEdit = event('PreToolUse', { session_id: 'md2', tool_input: { command: 'gh pr edit 7 --body-file body.md' } })
    const installs = path.join(home, 'Projects/dotclaude/.git/sync-installed.log')
    const lines = (word, count) => Array.from({ length: count }, (_, i) => `- ${word} rule ${i + 1}, ${'x'.repeat(40)}\n`).join('')
    return [
      ['takes a copy at session start and says nothing', () => { write(rules, '- one\n'); return quiet(run(event('SessionStart'))) }],
      ['adds nothing to a prompt while the file is unchanged', () => quiet(run(event('UserPromptSubmit')))],
      ['adds the diff to the next prompt after an edit, with nothing on stderr', () => {
        write(rules, '- one\n- two\n')
        const r = run(event('UserPromptSubmit'))
        return r.code === 0 && context(r).includes('+- two') && r.err === ''
      }],
      ['adds that diff only once', () => quiet(run(event('UserPromptSubmit')))],
      ['lets other commands through after an edit', () => { write(rules, '- one\n- two\n- three\n'); return quiet(run(event('PreToolUse', { tool_input: { command: 'ls' } }))) }],
      ['blocks the next commit once with the diff', () => { const r = run(commit); return refused(r) && r.err.includes('+- three') }],
      ['then lets the commit through', () => quiet(run(commit))],
      ['lets git commit-tree and commit-graph through after an edit', () => {
        write(rules, '- one\n- two\n- three\n- four\n')
        return quiet(run(event('PreToolUse', { tool_input: { command: 'git commit-graph write && c=$(git commit-tree "$tree" -m pictures)' } })))
      }],
      ['still blocks git -C <dir> commit after that edit', () => refused(run(event('PreToolUse', { tool_input: { command: 'git -C repo commit -F msg.txt' } })))],
      ['blocks sync.sh --commit once after an edit', () => {
        write(rules, '- one\n- two\n- three\n- four\n- five\n')
        return refused(run(event('PreToolUse', { tool_input: { command: 'cd ~/Projects/dotclaude && ./sync.sh --commit msg.txt' } })))
      }],
      ['takes a subagent\'s first look as its copy', () => quiet(run({ ...commit, agent_id: 'a1' }))],
      ['takes a copy of the pull-requests skill at session start', () => { write(skill, '- body\n'); return quiet(run(event('SessionStart', { session_id: 'md2' }))) }],
      ['lets a commit through after an edit of the skill alone', () => { write(skill, '- body\n- pictures\n'); return quiet(run({ ...commit, session_id: 'md2' })) }],
      ['blocks the next gh pr edit once with the skill diff', () => { const r = run(prEdit); return refused(r) && r.err.includes('SKILL.md changed') && r.err.includes('+- pictures') }],
      ['then lets gh pr edit through', () => quiet(run(prEdit))],
      ['adds the next edit of the skill to the next prompt', () => {
        write(skill, '- body\n- pictures\n- verify\n')
        const r = run(event('UserPromptSubmit', { session_id: 'md2' }))
        return r.code === 0 && context(r).includes('+- verify') && r.err === ''
      }],
      ['blocks the next commit once after an edit of the commit-messages skill', () => {
        const rules = path.join(config, 'skills/commit-messages/SKILL.md')
        write(rules, '- subject\n'); run(event('SessionStart', { session_id: 'md4' }))
        write(rules, '- subject\n- prompts\n')
        const r = run({ ...commit, session_id: 'md4' })
        return refused(r) && r.err.includes('commit-messages/SKILL.md changed') && r.err.includes('+- prompts') && quiet(run({ ...commit, session_id: 'md4' }))
      }],
      ['takes the session\'s own Edit of CLAUDE.md as seen', () => {
        const edit = event('PreToolUse', { session_id: 'md3', tool_name: 'Edit', tool_use_id: 'toolu_1', tool_input: { file_path: rules } })
        write(rules, '- one\n'); run(event('SessionStart', { session_id: 'md3' }))
        const pre = run(edit)
        write(rules, '- one\n- own\n')
        return quiet(pre) && quiet(run({ ...edit, hook_event_name: 'PostToolUse' })) && quiet(run({ ...commit, session_id: 'md3' }))
      }],
      ['still blocks for a peer\'s edit made before the session\'s own', () => {
        const edit = event('PreToolUse', { session_id: 'md3', tool_name: 'Edit', tool_use_id: 'toolu_2', tool_input: { file_path: rules } })
        write(rules, '- one\n- own\n- peer\n')
        run(edit); write(rules, '- one\n- own\n- peer\n- own again\n'); run({ ...edit, hook_event_name: 'PostToolUse' })
        const r = run({ ...commit, session_id: 'md3' })
        return refused(r) && r.err.includes('+- peer')
      }],
      ['takes a quick Bash call that changed the file as the session\'s own', () => {
        const fix = event('PreToolUse', { session_id: 'md3', tool_name: 'Bash', tool_use_id: 'toolu_3', tool_input: { command: 'bash fix.sh' } })
        run(fix); write(rules, '- fixed\n'); run({ ...fix, hook_event_name: 'PostToolUse' })
        return quiet(run({ ...commit, session_id: 'md3' }))
      }],
      ['still blocks when a sync.sh run that keeps no log changed the file', () => {
        const sync = event('PreToolUse', { session_id: 'md3', tool_name: 'Bash', tool_use_id: 'toolu_4', tool_input: { command: '~/Projects/dotclaude/sync.sh' } })
        run(sync); write(rules, '- pulled\n'); run({ ...sync, hook_event_name: 'PostToolUse' })
        const r = run({ ...commit, session_id: 'md3' })
        return refused(r) && r.err.includes('+- pulled')
      }],
      ['takes an edit in a sync.sh call that installed nothing as the session\'s own', () => {
        write(installs, '')
        const sync = event('PreToolUse', { session_id: 'md3', tool_name: 'Bash', tool_use_id: 'toolu_8', tool_input: { command: 'bash fix.sh && ./sync.sh' } })
        run(sync); write(rules, '- own, then synced\n'); run({ ...sync, hook_event_name: 'PostToolUse' })
        return quiet(run({ ...commit, session_id: 'md3' }))
      }],
      ['still blocks when a sync.sh run installed the file from the checkout', () => {
        const sync = event('PreToolUse', { session_id: 'md3', tool_name: 'Bash', tool_use_id: 'toolu_9', tool_input: { command: '~/Projects/dotclaude/sync.sh' } })
        run(sync); write(rules, '- from the checkout\n'); fs.appendFileSync(installs, `${Math.floor(Date.now() / 1000)} ${rules}\n`)
        run({ ...sync, hook_event_name: 'PostToolUse' })
        const r = run({ ...commit, session_id: 'md3' })
        return refused(r) && r.err.includes('+- from the checkout')
      }],
      ['still blocks when another session\'s sync installed the file during a Bash call', () => {
        const call = event('PreToolUse', { session_id: 'md3', tool_name: 'Bash', tool_use_id: 'toolu_10', tool_input: { command: 'npm test' } })
        run(call); write(rules, '- from a peer\'s prompt\n'); fs.appendFileSync(installs, `${Math.floor(Date.now() / 1000)} ${rules}\n`)
        run({ ...call, hook_event_name: 'PostToolUse' })
        const r = run({ ...commit, session_id: 'md3' })
        return refused(r) && r.err.includes('+- from a peer\'s prompt')
      }],
      ['still blocks when the Bash call that changed the file took over a minute', () => {
        const slow = event('PreToolUse', { session_id: 'md3', tool_name: 'Bash', tool_use_id: 'toolu_5', tool_input: { command: 'npm test' } })
        run(slow); write(path.join(ENV.TMPDIR, 'claude-md-snapshots/md3.pre.toolu_5'), '0\n')
        write(rules, '- slow\n'); run({ ...slow, hook_event_name: 'PostToolUse' })
        const r = run({ ...commit, session_id: 'md3' })
        return refused(r) && r.err.includes('+- slow')
      }],
      ['takes the session\'s own Edit of the skill as seen', () => {
        const edit = event('PreToolUse', { session_id: 'md3', tool_name: 'Edit', tool_use_id: 'toolu_6', tool_input: { file_path: skill } })
        run(edit); write(skill, '- body\n- own\n'); run({ ...edit, hook_event_name: 'PostToolUse' })
        return quiet(run({ ...prEdit, session_id: 'md3' }))
      }],
      ['still blocks for a peer\'s CLAUDE.md edit made while the session edits the skill', () => {
        const edit = event('PreToolUse', { session_id: 'md3', tool_name: 'Edit', tool_use_id: 'toolu_7', tool_input: { file_path: skill } })
        run(edit); write(rules, '- peer again\n'); write(skill, '- body\n- own\n- more\n'); run({ ...edit, hook_event_name: 'PostToolUse' })
        const r = run({ ...commit, session_id: 'md3' })
        return refused(r) && r.err.includes('+- peer again') && !r.err.includes('SKILL.md')
      }],
      ['lets a commit through with the diff as context when only Running things changed', () => {
        write(rules, '# Rules\n\n## Commit messages\n\n- wrap\n\n## Running things\n\n- stop the stack\n'); run(event('SessionStart', { session_id: 'md4' }))
        write(rules, '# Rules\n\n## Commit messages\n\n- wrap\n\n## Running things\n\n- stop the stack\n- probe first\n')
        const r = run({ ...commit, session_id: 'md4' })
        return r.code === 0 && r.err === '' && context(r).includes('+- probe first')
      }],
      ['then lets the next commit through', () => quiet(run({ ...commit, session_id: 'md4' }))],
      ['blocks a commit once when Commit messages changed', () => {
        write(rules, '# Rules\n\n## Commit messages\n\n- wrap at 72\n\n## Running things\n\n- stop the stack\n- probe first\n')
        const r = run({ ...commit, session_id: 'md4' })
        return refused(r) && r.err.includes('+- wrap at 72')
      }],
      ['blocks a commit when one of several changes lies outside the context-only sections', () => {
        write(rules, '# Rules\n\n## Commit messages\n\n- wrap at 80\n\n## Running things\n\n- stop the stack\n- probe once\n')
        const r = run({ ...commit, session_id: 'md4' })
        return refused(r) && r.err.includes('+- probe once') && r.err.includes('+- wrap at 80')
      }],
      ['blocks a commit when a heading changed', () => {
        write(rules, '# Rules\n\n## Commit messages\n\n- wrap at 80\n\n## Running things\n\n- stop the stack\n- probe once\n\n## Releases\n\n- tag\n')
        return refused(run({ ...commit, session_id: 'md4' }))
      }],
      ['blocks a commit when the text above the first heading changed', () => {
        write(rules, '# Rules for all\n\n## Commit messages\n\n- wrap at 80\n\n## Running things\n\n- stop the stack\n- probe once\n\n## Releases\n\n- tag\n')
        return refused(run({ ...commit, session_id: 'md4' }))
      }],
      ['still blocks gh pr edit for a skill change beside a Running things change', () => {
        write(rules, '# Rules for all\n\n## Commit messages\n\n- wrap at 80\n\n## Running things\n\n- stop the stack\n- probe twice\n\n## Releases\n\n- tag\n')
        write(skill, '- body\n- n6\n')
        const r = run({ ...prEdit, session_id: 'md4' })
        return refused(r) && r.err.includes('+- n6') && r.err.includes('+- probe twice')
      }],
      ['shows a 250-line diff as the new text of each change, up to its last line', () => {
        write(rules, `## Rules\n\n${lines('old', 125)}`); run(event('SessionStart', { session_id: 'md5' }))
        write(rules, `## Rules\n\n${lines('new', 125)}`)
        const r = run(event('UserPromptSubmit', { session_id: 'md5' })), c = context(r)
        return r.code === 0 && r.err === '' && c.length < 9000 && c.includes('[Rules, line 3]\n- new rule 1,')
          && c.endsWith(`- new rule 125, ${'x'.repeat(40)}`) && !c.includes('- old rule')
      }],
      ['adds nothing to the prompt after it', () => quiet(run(event('UserPromptSubmit', { session_id: 'md5' })))],
      ['brings the rest of a 580-line diff with the next Bash call, then nothing', () => {
        const ls = event('PreToolUse', { session_id: 'md6', tool_name: 'Bash', tool_use_id: 'toolu_11', tool_input: { command: 'ls' } })
        write(rules, `## Rules\n\n${lines('old', 290)}`); run(event('SessionStart', { session_id: 'md6' }))
        write(rules, `## Rules\n\n${lines('new', 290)}`)
        const first = context(run(event('UserPromptSubmit', { session_id: 'md6' }))), rest = run(ls)
        return first.length < 9000 && first.includes('[The changes after line ') && !first.includes('- new rule 290,')
          && rest.code === 0 && rest.err === '' && context(rest).includes('- new rule 290,') && quiet(run({ ...ls, tool_use_id: 'toolu_12' }))
      }],
    ]
  }],

  ['claude-md-memory-index.sh', run => {
    const rules = path.join(config, 'CLAUDE.md'), index = path.join(config, 'projects/-mi/memory/MEMORY.md')
    const edit = (file_path, session_id) => ({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path }, session_id })
    const bashCall = (hook_event_name, session_id, command) => ({ hook_event_name, tool_name: 'Bash', tool_use_id: `toolu_${session_id}`, tool_input: { command }, session_id })
    const listed = r => r.err.split('the build runs with make').length - 1
    return [
      ['lists every memory index after an edit of CLAUDE.md', () => {
        write(rules, '- one\n')
        write(index, '- [Build](build.md): the build runs with make\n')
        const r = run(edit(rules, 'mi1'))
        return r.code === 2 && listed(r) === 1
      }],
      ['says it once in five minutes per session', () => quiet(run(edit(rules, 'mi1')))],
      ['leaves an edit of another file alone', () => quiet(run(edit(path.join(home, 'notes.md'), 'mi2')))],
      ['lists a symlinked project folder once', () => {
        fs.symlinkSync('-mi', path.join(config, 'projects/-mi-old'))
        return listed(run(edit(rules, 'mi3'))) === 1
      }],
      ['stays quiet on a Bash read of CLAUDE.md just after another session changed it', () => {
        const read = `sed -n 1,5p ${rules}`
        write(rules, '- one\n- from a peer\n')
        return quiet(run(bashCall('PreToolUse', 'mi4', read))) && quiet(run(bashCall('PostToolUse', 'mi4', read)))
      }],
      ['lists every memory index after a Bash command that changed CLAUDE.md', () => {
        const fix = `sed -i '' 's/one/two/' ${rules}`
        const pre = run(bashCall('PreToolUse', 'mi5', fix))
        write(rules, '- two\n- from a peer\n')
        const r = run(bashCall('PostToolUse', 'mi5', fix))
        return quiet(pre) && r.code === 2 && listed(r) === 1
      }],
    ]
  }],

  ['dotclaude-sync.sh', run => {
    const checkout = path.join(home, 'Projects/dotclaude')
    const sync = path.join(checkout, 'sync.sh'), lock = path.join(checkout, '.git/sync.lock'), ran = path.join(home, 'sync-ran')
    const stub = body => { write(sync, `#!/usr/bin/env bash\n${body}\n`); fs.chmodSync(sync, 0o755) }
    const report = (session_id = 'ds1') => run({ hook_event_name: 'UserPromptSubmit', session_id }, { args: ['--report'] })
    return [
      ['does nothing without a checkout', () => { fs.rmSync(sync, { force: true }); return quiet(run({})) && quiet(report()) }],
      ['runs sync.sh with credential prompts off and prints nothing', () => {
        stub(`echo "$GIT_TERMINAL_PROMPT" > ${q(ran)}; echo stdout`)
        return quiet(run({})) && fs.readFileSync(ran, 'utf8') === '0\n'
      }],
      ['skips its turn while another run holds the lock', () => {
        fs.rmSync(ran); write(lock, '1\n')
        const skipped = quiet(run({})) && !fs.existsSync(ran)
        fs.rmSync(lock)
        return skipped
      }],
      ['says nothing after a clean run', () => quiet(report())],
      ['stays silent when the run only could not reach GitHub', () => {
        stub('echo "sync: fetch failed, reconciling against the local HEAD only" >&2')
        return quiet(run({})) && quiet(report())
      }],
      ['reports what stopped a run in the next prompt, without printing it in the run', () => {
        stub('echo "sync: pull refused" >&2; echo status; exit 1')
        const r = run({})
        return quiet(r) && context(report()).includes('sync: pull refused') && !context(report('ds2')).includes('status')
      }],
      ['reports each failure once per session', () => quiet(report())],
      ['reports it to another session', () => context(report('ds3')).includes('sync: pull refused')],
      ['reports a new failure again', () => {
        stub('echo "sync: settings.json changed both locally and in the pulled commits" >&2; exit 1')
        run({})
        return context(report()).includes('settings.json changed both')
      }],
      ['stops reporting after a clean run', () => {
        stub('exit 0'); run({})
        const r = quiet(report('ds4'))
        fs.rmSync(sync)
        return r
      }],
    ]
  }],

  ['git-fetch-prune.sh', run => {
    const origin = path.join(home, 'fetch-origin.git'), other = path.join(home, 'fetch-other'), work = path.join(home, 'fetch-work')
    const env = { CLAUDE_PROJECT_DIR: work }
    const remoteBranches = () => sh(`git -C ${q(work)} branch -r`)
    return [
      ['fetches a new remote branch and prints nothing', () => {
        sh(`git init -q --bare ${q(origin)} && git clone -q ${q(origin)} ${q(other)} 2>/dev/null && git -C ${q(other)} commit -q --allow-empty -m one && git -C ${q(other)} push -q origin main && git clone -q ${q(origin)} ${q(work)} && git -C ${q(other)} push -q origin main:feature`)
        return quiet(run({}, { env })) && remoteBranches().includes('origin/feature')
      }],
      ['waits out the interval before fetching again', () => {
        sh(`git -C ${q(other)} push -q origin main:later`)
        return quiet(run({}, { env })) && !remoteBranches().includes('origin/later')
      }],
      ['does nothing outside a repository', () => quiet(run({}, { env: { CLAUDE_PROJECT_DIR: path.join(home, 'tmp') } }))],
    ]
  }],

  ['git-fetch-before-remote-base.sh', run => {
    const origin = path.join(home, 'base-origin.git'), other = path.join(home, 'base-other'), work = path.join(home, 'base-work')
    const remoteBranches = () => sh(`git -C ${q(work)} branch -r`)
    return [
      ['fetches before a rebase onto an origin ref', () => {
        sh(`git init -q --bare ${q(origin)} && git clone -q ${q(origin)} ${q(other)} 2>/dev/null && git -C ${q(other)} commit -q --allow-empty -m one && git -C ${q(other)} push -q origin main && git clone -q ${q(origin)} ${q(work)} && git -C ${q(other)} push -q origin main:feature`)
        return quiet(run(bash('git rebase origin/main', work))) && remoteBranches().includes('origin/feature')
      }],
      ['skips the fetch when the repository fetched in the last 2 minutes', () => {
        sh(`git -C ${q(other)} push -q origin main:later`)
        return quiet(run(bash('git switch -c topic origin/main', work))) && !remoteBranches().includes('origin/later')
      }],
      ['leaves a command without a remote ref alone', () => quiet(run(bash('git status', work)))],
    ]
  }],

  ['git-prune-gone-branches.sh', run => {
    const origin = path.join(home, 'prune-origin.git'), work = path.join(home, 'prune-work')
    const env = { CLAUDE_PROJECT_DIR: work }
    const notice = r => output(r).systemMessage || ''
    const exists = name => sh(`git -C ${q(work)} branch --list ${name}`) !== ''
    const change = name => `echo ${name} > ${name} && git add ${name} && git commit -q -m ${name}`
    let first = {}
    return [
      ['deletes a gone branch whose commits are on the default branch', () => {
        sh(`git init -q --bare ${q(origin)} && git clone -q ${q(origin)} ${q(work)} 2>/dev/null && cd ${q(work)} && ${change('one')} && git push -q -u origin main && git remote set-head origin main && git switch -q -c merged && ${change('two')} && git push -q -u origin merged && git switch -q main && git merge -q --ff-only merged && git push -q origin main && git switch -q -c unmerged && ${change('three')} && git push -q -u origin unmerged && git switch -q main && git push -q origin --delete merged unmerged`)
        first = run('', { env })
        return first.code === 0 && /^Deleted 1 local branch .*merged \(on origin\/main\)/.test(notice(first)) && !exists('merged')
      }],
      ['keeps a gone branch with commits found nowhere else, and says why', () => /Kept 1 local branch .*unmerged \(not on GitHub\)/.test(notice(first)) && exists('unmerged')],
      ['logs the deleted branch with its hash', () => /\tmerged\t[0-9a-f]{40}\t/.test(fs.readFileSync(path.join(work, '.git/claude-code-deleted-branches.log'), 'utf8'))],
      ['names the kept set only once', () => quiet(run('', { env }))],
      ['reports without deleting under --dry-run', () => { const r = run('', { env, args: ['--dry-run'] }); return r.code === 0 && /^Kept 1 local branch/.test(r.out) && exists('unmerged') }],
    ]
  }],

  ['git-submodule-update-after-switch.sh', run => {
    const sub = path.join(home, 'sm-sub'), top = path.join(home, 'sm-top'), plain = path.join(home, 'sm-plain')
    const post = (command, cwd) => ({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, cwd })
    const restored = () => fs.existsSync(path.join(top, 'lib/a'))
    return [
      ['updates the submodules after a switch and hands their status over', () => {
        sh(`git init -q ${q(sub)} && cd ${q(sub)} && echo a > a && git add a && git commit -q -m a && git init -q ${q(top)} && cd ${q(top)} && git submodule add -q ${q(sub)} lib 2>/dev/null && git commit -q -m lib && git submodule deinit -q -f lib`)
        const r = run(post('git switch main', top))
        return r.code === 0 && context(r).startsWith('Ran git submodule update --init') && context(r).includes('git submodule status') && restored()
      }],
      ['finds the repository from git -C', () => {
        sh(`git -C ${q(top)} submodule deinit -q -f lib`)
        return context(run(post(`git -C ${top} switch main`, home))).startsWith('Ran git submodule update') && restored()
      }],
      ['counts gh pr checkout as a switch', () => { sh(`git -C ${q(top)} submodule deinit -q -f lib`); return context(run(post('gh pr checkout 12', top))) !== '' && restored() }],
      ['stays quiet for a command that switches nothing', () => quiet(run(post('git status', top)))],
      ['stays quiet in a repository without submodules', () => { sh(`git init -q ${q(plain)}`); return quiet(run(post('git switch main', plain))) }],
    ]
  }],

  ['memory-plain-characters.sh', run => {
    const memory = path.join(config, 'projects/-plain/memory')
    return [
      ['stays quiet when memory notes use plain characters', () => { write(path.join(memory, 'MEMORY.md'), '- [Note](note.md): a hook\n'); return quiet(run({})) }],
      ['names a note with a long dash and its line', () => {
        write(path.join(memory, 'note.md'), 'line one\nfacts — more\n')
        const r = run({})
        return refused(r) && r.err.includes('note.md:2')
      }],
    ]
  }],

  ['no-meta-prompts.sh', run => {
    const work = path.join(home, 'meta-work'), checkout = path.join(home, 'Projects/dotclaude')
    const message = (dir, name, prompt) => write(path.join(dir, name),
      `Fix the parser\n\nPrompts behind this commit, as given to Claude Code\n(model m, effort e):\n\n1.\n${prompt.split('\n').map(l => `> ${l}`).join('\n')}\n`)
    return [
      ['blocks a commit once when a quoted prompt opens with dotclaude', () => {
        sh(`git init -q ${q(work)} && git init -q ${q(checkout)}`)
        message(work, 'm1.txt', 'dotclaude, add a rule for this')
        return refused(run(bash('git commit -F m1.txt', work)))
      }],
      ['lets the same commit through the second time', () => quiet(run(bash('git commit -F m1.txt', work)))],
      ['finds the words at a sentence start across a wrapped line', () => { message(work, 'm2.txt', 'fix the parser. global\nmemory: keep tabs'); return refused(run(bash('git commit -F m2.txt', work))) }],
      ['lets a prompt through that names dotclaude mid-sentence', () => { message(work, 'm3.txt', 'fix the parser the dotclaude way'); return quiet(run(bash('git commit -F m3.txt', work))) }],
      ['reads a PR body from --body-file', () => { message(work, 'b.md', 'memory: note this'); return refused(run(bash('gh pr create --draft --body-file b.md', work))) }],
      ['lets the configuration checkout through', () => { message(checkout, 'm4.txt', 'dotclaude, add a rule'); return quiet(run(bash('git commit -F m4.txt', checkout))) }],
    ]
  }],

  ['abbreviations-listed.sh', run => {
    const work = path.join(home, 'abbr-work'), checkout = path.join(home, 'Projects/dotclaude')
    const message = (dir, name, prompt, abbreviations = '') => write(path.join(dir, name),
      `Fix the parser\n\nIt parses.\n\nPrompts behind this commit, as given to Claude Code\n(model m, effort e):\n\n1.\n> ${prompt}\n${abbreviations && `\nAbbreviations:\n${abbreviations}\n`}`)
    const earlier = (dir, name, abbreviations) => sh(`git init -q ${q(dir)} && git -C ${q(dir)} commit -q --allow-empty -F ${q(message(home, name, 'open it', abbreviations))}`)
    return [
      ['refuses a commit whose prompt uses an abbreviation an earlier commit expanded, naming the line to add', () => {
        earlier(work, 'abbr-0.txt', 'pr: pull request\nmd: Markdown')
        message(work, 'm1.txt', 'push the pr again')
        const r = run(bash('git commit -F m1.txt', work))
        return refused(r) && r.err.includes('\npr: pull request\n') && !r.err.includes('md: Markdown')
      }],
      ['lets the same command through the second time', () => quiet(run(bash('git commit -F m1.txt', work)))],
      ['lets a message through that lists it', () => { message(work, 'm2.txt', 'merge the pr', 'pr: pull request'); return quiet(run(bash('git commit -F m2.txt', work))) }],
      ['ignores the word inside a longer word or as a file extension', () => { message(work, 'm3.txt', 'fix the prompts in readme.md'); return quiet(run(bash('git commit -F m3.txt', work))) }],
      ['ignores a commit with no prompts section', () => { write(path.join(work, 'm4.txt'), 'Fix the reader\n\nThe review said:\n> the pr breaks the reader\n'); return quiet(run(bash('git commit -F m4.txt', work))) }],
      ['ignores a command that makes no commit', () => { message(work, 'b.md', 'close the pr'); return quiet(run(bash('gh pr create --draft --body-file b.md', work))) }],
      ['counts an abbreviation the configuration checkout expanded', () => {
        earlier(checkout, 'abbr-1.txt', 'wip: work in progress')
        message(work, 'm5.txt', 'keep the wip label')
        const r = run(bash('git commit -F m5.txt', work))
        return refused(r) && r.err.includes('\nwip: work in progress\n')
      }],
      ['reads the message file of a sync.sh --commit', () => { message(checkout, 'c1.txt', 'squash the wip commits'); return refused(run(bash('./sync.sh --commit c1.txt', checkout))) }],
    ]
  }],

  ['prompt-feedback-box.sh', run => {
    const t = path.join(home, 'feedback.jsonl')
    const box = actions => uses('mcp__ccd_turn__wrap_up', { recap: 'r', ask: 'Commit it?', actions })
    const stop = last => ({ hook_event_name: 'Stop', transcript_path: t, stop_hook_active: false, ...(last === undefined ? {} : { last_assistant_message: last }) })
    const feedback = 'Fixed it.\n\n**Prompt feedback**\nIt was fine.'
    const notification = { type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: 'done' } }
    return [
      ['sends back a turn whose last message has no Prompt feedback', () => { jsonl(t, [human('fix the bug'), says('Fixed it.')]); return refused(run(stop('Fixed it.'))) }],
      ['lets the turn end once its last message has the section', () => { jsonl(t, [human('fix the bug'), says(feedback)]); return quiet(run(stop(feedback))) }],
      ['sends it back when the section came before the box and a stub after it', () => {
        jsonl(t, [human('fix the bug'), says(feedback), box([]), toolResult('Shown in the next-step box.'), says('The full answer is above.')])
        return refused(run(stop('The full answer is above.')))
      }],
      ['sends back a turn that wrote nothing after the box', () => { jsonl(t, [human('fix the bug'), says(feedback), box([])]); return refused(run(stop(''))) }],
      ['reads the transcript when the input has no last message', () => { jsonl(t, [human('fix the bug'), says(feedback)]); return quiet(run(stop())) }],
      ['still sends back a transcript turn without the section', () => { jsonl(t, [human('fix the bug'), says('Fixed it.')]); return refused(run(stop())) }],
      ['lets the second stop of a turn through', () => { jsonl(t, [human('fix the bug'), says('Fixed it.')]); return quiet(run({ ...stop('Fixed it.'), stop_hook_active: true })) }],
      ['lets a turn through that a reply button opened', () => {
        jsonl(t, [human('fix the bug'), says(feedback), box([{ label: 'Commit', message: 'commit it' }]), human('commit it'), says('Committed.')])
        return quiet(run(stop('Committed.')))
      }],
      ['lets a turn through that a task notification opened', () => { jsonl(t, [human('fix the bug'), says(feedback), notification, says('The build passed.')]); return quiet(run(stop('The build passed.'))) }],
      ['lets a turn through that a button opened by its label', () => {
        jsonl(t, [human('fix the bug'), says(feedback), box([{ label: 'Commit', message: 'commit it' }]), human('Commit'), says('Committed.')])
        return quiet(run(stop('Committed.')))
      }],
      ['lets a turn through that a button opened after a system reminder', () => {
        jsonl(t, [human('fix the bug'), says(feedback), box([{ label: 'Commit' }]), human([{ type: 'text', text: '<\system-reminder>\nThe folder changed.\n<\/system-reminder>' }, { type: 'text', text: 'Commit' }]), says('Committed.')])
        return quiet(run(stop('Committed.')))
      }],
      ['no longer refuses a box with a question', () => {
        jsonl(t, [human('fix the bug'), says('Fixed it.')])
        return quiet(run({ hook_event_name: 'PreToolUse', transcript_path: t, tool_use_id: 'toolu_box', tool_input: { recap: 'r', ask: 'Commit it?' } }))
      }],
      ['tells Claude when a prompt repeats a reply button', () => {
        jsonl(t, [human('fix the bug'), says('Fixed it.'), box([{ label: 'Commit', message: 'commit it' }])])
        return /repeats a reply button/.test(context(run({ hook_event_name: 'UserPromptSubmit', transcript_path: t, prompt: 'commit it' })))
      }],
      ['says nothing about a prompt the user typed', () => quiet(run({ hook_event_name: 'UserPromptSubmit', transcript_path: t, prompt: 'now push it' }))],
      ['tells Claude when a prompt repeats a button label after a system reminder', () => {
        jsonl(t, [human('fix the bug'), says('Fixed it.'), box([{ label: 'Commit', message: 'commit it' }])])
        return /repeats a reply button/.test(context(run({ hook_event_name: 'UserPromptSubmit', transcript_path: t, prompt: '<\system-reminder>\nThe folder changed.\n<\/system-reminder>\n\n\nCommit\n' })))
      }],
    ]
  }],

  ['permission-mode-changed.sh', run => {
    const prompt = (session_id, permission_mode) => ({ hook_event_name: 'UserPromptSubmit', session_id, permission_mode, prompt: 'go on' })
    return [
      ['stays quiet on the first prompt of a session', () => quiet(run(prompt('pm1', 'bypassPermissions')))],
      ['stays quiet while the mode stays the same', () => quiet(run(prompt('pm1', 'bypassPermissions')))],
      ['names both modes when the mode changed', () => context(run(prompt('pm1', 'auto'))).includes('changed from bypassPermissions to auto')],
      ['calls default Manual, as the app does', () => context(run(prompt('pm1', 'default'))).includes('from auto to default (Manual in the app)')],
      ['keeps each session apart', () => quiet(run(prompt('pm2', 'auto')))],
      ['lets input it cannot read through without a word', () => quiet(run('not json'))],
    ]
  }],

  ['prompt-log.sh', run => {
    const log = prompt => run({ session_id: 'p1', cwd: '/x', prompt })
    const print = (...args) => run('', { args: ['print', ...args], env: { PROMPT_LOG_SESSION: 'p1' } }).out
    const compacted = 'The context window filled up while you were working, so the conversation was compacted. Please continue from where you left off.'
    return [
      ['logs a prompt and prints nothing', () => quiet(log(`fix the bug in https://example.com/a and tell ${address('bob')}`)) && fs.readFileSync(path.join(config, 'prompt-log/p1.jsonl'), 'utf8').trim().split('\n').length === 1],
      ['prints it for a commit with the addresses replaced', () => print('--commit') === '1.\n> fix the bug in [pasted: an address] and tell [pasted: an address]\n\n'],
      ['leaves out reminders and a prompt sent twice', () => { log('<system-reminder>ignore</system-reminder>'); log('push it'); log('push it'); const out = print(); return out.endsWith('**2.**\n> push it\n\n') && !out.includes('**3.**') }],
      ['replaces a pasted block with its line count', () => { log('look at this <pasted_content id="1">a\nb\nc</pasted_content>'); return print('--from', '3') === '**3.**\n> look at this [pasted: 3 lines]\n\n' }],
      ['wraps long prompts at 72 columns for a commit', () => { log('word '.repeat(40).trim()); const out = print('--commit', '--from', '4'); return out.startsWith('4.\n') && out.split('\n').length > 3 && out.split('\n').every(l => l.length <= 72) }],
      ['redacts a token and writes a macOS or Linux home path with ~', () => { log(`use TOKEN=abc123 in ${otherHome}/Projects/x and ${linuxHome}/y`); return print('--from', '5').includes('TOKEN=[redacted] in ~/Projects/x and ~/y') }],
      ['gives no number to a cross-session notice or the compaction note', () => {
        log('[Cross-session delivery notice] Your message to another session was held by that session.')
        log('[Cross-session idle notice] "a", which you asked to be notified about, is idle now.')
        log(compacted)
        log('go on')
        return print('--from', '6') === '**6.**\n> go on\n\n'
      }],
      ['counts no compaction note among the prompts from before the log began', () => {
        jsonl(path.join(config, 'projects/x/p2.jsonl'), [
          { type: 'user', timestamp: '2020-01-01T00:00:00Z', message: { content: 'first' } },
          { type: 'user', timestamp: '2020-01-01T00:00:01Z', message: { content: compacted } },
        ])
        run({ session_id: 'p2', cwd: '/x', prompt: 'second' })
        return run('', { args: ['print'], env: { PROMPT_LOG_SESSION: 'p2' } }).out === '**2.**\n> second\n\n'
      }],
      ['fails without a log for the session', () => run('', { args: ['print'], env: { PROMPT_LOG_SESSION: 'none' } }).code === 1],
      ['prints the earlier prompts of a fork from the log it was forked from', () => {
        jsonl(path.join(config, 'prompt-log/p3.jsonl'), [
          { timestamp: '2020-01-01T00:00:00Z', prompt: 'start' },
          { timestamp: '2020-01-01T00:00:05Z', prompt: 'queued' },
          { timestamp: '2020-01-01T00:01:00Z', prompt: 'after the fork' },
        ])
        jsonl(path.join(config, 'projects/x/p4.jsonl'), [
          { type: 'user', sessionId: 'p3', timestamp: '2020-01-01T00:00:00.100Z', message: { content: 'start' } },
          { type: 'queue-operation', sessionId: 'p3', timestamp: '2020-01-01T00:00:10.500Z' },
        ])
        run({ session_id: 'p4', cwd: '/x', prompt: 'forked' })
        return run('', { args: ['print'], env: { PROMPT_LOG_SESSION: 'p4' } }).out === '**1.**\n> start\n\n**2.**\n> queued\n\n**3.**\n> forked\n\n'
      }],
      ['keeps the same answer given again minutes later', () => {
        jsonl(path.join(config, 'prompt-log/p5.jsonl'), [
          { timestamp: '2020-01-01T00:00:00Z', prompt: 'a' },
          { timestamp: '2020-01-01T00:00:02Z', prompt: 'a' },
          { timestamp: '2020-01-01T00:10:00Z', prompt: 'a' },
        ])
        return run('', { args: ['print'], env: { PROMPT_LOG_SESSION: 'p5' } }).out === '**1.**\n> a\n\n**2.**\n> a\n\n'
      }],
      ['names on stderr the abbreviations earlier commits expanded', () => {
        const repo = path.join(home, 'pl-work'), plain = path.join(home, 'pl-plain'), msg = path.join(home, 'pl-msg.txt')
        sh(`git init -q ${q(repo)} && mkdir -p ${q(plain)}`)
        for (const lines of ['html: an older expansion\nmd: Markdown', 'HTML: HyperText Markup Language'])
          sh(`git -C ${q(repo)} commit -q --allow-empty -F ${q(write(msg, `Add a page\n\nAbbreviations:\n${lines}\n`))}`)
        run({ session_id: 'p6', cwd: repo, prompt: 'give me the html of readme.md' })
        const printIn = (args, cwd) => run('', { args: ['print', '--commit', '--model', 'm', '--effort', 'high', ...args], cwd, env: { PROMPT_LOG_SESSION: 'p6' } })
        const named = printIn(['-C', repo]), here = printIn([], repo), none = printIn(['-C', plain])
        return named.code === 0 && named.out.endsWith('\n1.\n> give me the html of readme.md\n\n') && named.out === none.out && none.err === ''
          && named.err === 'prompt-log: earlier commits gave these Abbreviations: lines for words of the prompts; add each whose word stays in the message and means the same here:\nHTML: HyperText Markup Language\n'
          && here.err === named.err
      }],
    ]
  }],

  ['prompts-md.sh', run => {
    const work = path.join(home, 'pm-work'), file = path.join(work, 'PROMPTS.md')
    const body = (subject, prompt, effort = 'high') => `${subject}\n\nIt does it.\n\nPrompts behind this commit, as given to Claude Code\n(model m, effort ${effort}):\n\n1.\n> ${prompt}\n`
    return [
      ['writes PROMPTS.md from the prompts of the commits', () => {
        write(path.join(home, 'pm-1.txt'), body('Add the parser', 'add a parser'))
        sh(`git init -q ${q(work)} && cd ${q(work)} && echo a > a && git add a && git commit -q -F ${q(path.join(home, 'pm-1.txt'))} && echo b > b && git add b && git commit -q -m 'No prompts here'`)
        const r = run('', { cwd: work })
        const text = fs.readFileSync(file, 'utf8')
        return r.code === 0 && /## Add the parser\n\n\d{4}-\d\d-\d\d, commit [0-9a-f]{7}, model m, effort high\.\n\n\*\*1\.\*\*\n> add a parser/.test(text) && !text.includes('No prompts here')
      }],
      ['masks an old prompt and leaves out an effort that is not a level', () => {
        write(path.join(home, 'pm-3.txt'), body('Add the reader', `read ${otherHome}/notes.txt`, 'default'))
        sh(`cd ${q(work)} && echo c > c && git add c && git commit -q -F ${q(path.join(home, 'pm-3.txt'))}`)
        const text = (run('', { cwd: work }), fs.readFileSync(file, 'utf8'))
        return text.includes('> read ~/notes.txt') && !text.includes(otherHome) && !text.includes('effort default') && /commit [0-9a-f]{7}, model m\.\n/.test(text)
      }],
      ['keeps each question and its answer under the prompt', () => {
        write(path.join(home, 'pm-4.txt'), body('Add the asker', 'ask me first') + '\n(p1: keep the old\nparser?)\n> Keep it (Recommended)\n\n(p2: rename it?)\n> no\n')
        sh(`cd ${q(work)} && echo d > d && git add d && git commit -q -F ${q(path.join(home, 'pm-4.txt'))}`)
        const text = (run('', { cwd: work }), fs.readFileSync(file, 'utf8'))
        return text.includes('> ask me first\n\n(p1: keep the old\nparser?)\n> Keep it (Recommended)\n\n(p2: rename it?)\n> no\n')
      }],
      ['keeps the case variant of an abbreviation that comes first in byte order', () => {
        write(path.join(home, 'pm-5.txt'), body('Add the model', 'add an llm') + '\nAbbreviations:\n- llm: large language model\n- md: markdown\n')
        write(path.join(home, 'pm-6.txt'), body('Add the docs', 'add the md') + '\nAbbreviations:\n- LLM: large language model\n- md: Markdown\n')
        sh(`cd ${q(work)} && echo e > e && git add e && git commit -q -F ${q(path.join(home, 'pm-5.txt'))} && echo f > f && git add f && git commit -q -F ${q(path.join(home, 'pm-6.txt'))}`)
        const text = (run('', { cwd: work }), fs.readFileSync(file, 'utf8'))
        return text.includes('\n- LLM: large language model\n') && text.includes('\n- md: Markdown\n') && !/^- (llm|md: markdown)/m.test(text)
      }],
      ['lists the commit about to be made first', () => {
        run('', { cwd: work, args: ['--message', write(path.join(home, 'pm-2.txt'), body('Add the printer', 'add a printer'))] })
        const text = fs.readFileSync(file, 'utf8')
        return text.includes('add a printer') && text.indexOf('add a printer') < text.indexOf('add a parser')
      }],
      ['stops on a missing message file', () => run('', { cwd: work, args: ['--message', path.join(home, 'none.txt')] }).code === 2],
    ]
  }],

  ['prompts-md-current.sh', run => {
    const repo = path.join(home, 'Projects/pmc'), plain = path.join(home, 'pmc-plain')
    return [
      ['refuses a commit once when the command leaves PROMPTS.md behind', () => {
        sh(`git init -q ${q(repo)} && git init -q ${q(plain)} && cd ${q(repo)} && printf '# Prompts\\n\\nThe prompts behind the commits of this repository, as given to Claude Code.\\n' > PROMPTS.md && git add PROMPTS.md && git commit -q -m init`)
        return refused(run(bash('git commit -F m.txt', repo)))
      }],
      ['lets the same command through the second time', () => quiet(run(bash('git commit -F m.txt', repo)))],
      ['finds the checkout from a git -C variable the command assigns', () => refused(run(bash('R=~/Projects && W=$R/pmc\ngit -C $W add a && git -C $W commit -q -F m.txt')))],
      ['finds the checkout from a cd', () => refused(run(bash('cd ~/Projects/pmc && git commit -m one')))],
      ['lets a commit through that rebuilds the file', () => quiet(run(bash('~/.claude/hooks/prompts-md.sh --message m.txt && git add PROMPTS.md && git commit -F m.txt', repo)))],
      ['lets an amend through', () => quiet(run(bash('git commit --amend -F m.txt', repo)))],
      ['lets a commit through once the file has a change waiting', () => { fs.appendFileSync(path.join(repo, 'PROMPTS.md'), '\n'); return quiet(run(bash('git commit -a -F m.txt', repo))) }],
      ['leaves a checkout without the file alone', () => quiet(run(bash('git commit -m two', plain)))],
    ]
  }],

  ['share-memories.sh', run => {
    const shared = path.join(home, 'shared'), proj = path.join(home, 'Projects/proj')
    const env = { CLAUDE_PROJECT_DIR: proj }
    const memory = path.join(config, 'projects', proj.replace(/[^A-Za-z0-9]/g, '-'), 'memory')
    const dest = path.join(shared, 'proj/me')
    const lock = path.join(config, 'shared-memories-state', `${proj.replace(/[^A-Za-z0-9]/g, '-')}.lock`)
    const note = (name, text) => { const f = write(path.join(memory, name), text); const later = Date.now() / 1000 + 5; fs.utimesSync(f, later, later) }
    const settle = () => { for (let i = 0; i < 50 && fs.existsSync(lock); i++) sleep(100) }
    return [
      ['does nothing without its conf file', () => {
        sh(`git init -q ${q(proj)} && git -C ${q(proj)} remote add origin https://github.com/acme/proj.git && git init -q ${q(shared)}`)
        note('MEMORY.md', '- [Open](open.md): shared\n- [Mine](mine.md): private\n')
        return quiet(run({}, { env })) && !fs.existsSync(dest)
      }],
      ['shares the notes but leaves out one marked share: no', () => {
        write(path.join(config, 'shared-memories.conf'), `dir=${shared}\nowners=acme\nhandle=me\n`)
        note('open.md', '---\nname: open\n---\nThe build runs with make.\n')
        note('mine.md', '---\nname: mine\nmetadata:\n  share: "no"\n---\nMy own habit.\n')
        const r = run({}, { env })
        settle()
        return quiet(r) && fs.existsSync(path.join(dest, 'open.md')) && !fs.existsSync(path.join(dest, 'mine.md')) &&
          fs.readFileSync(path.join(dest, 'MEMORY.md'), 'utf8') === '- [Open](open.md): shared\n'
      }],
      ['holds back a note that looks like it holds a password, and names it', () => {
        note('login.md', 'The test password is "hunter2hunter2".\n')
        const r = run({}, { env })
        settle()
        return r.code === 2 && r.err.includes('login.md') && !fs.existsSync(path.join(dest, 'login.md'))
      }],
      ['leaves repositories of other owners alone', () => {
        sh(`git -C ${q(proj)} remote set-url origin https://github.com/other/proj.git`)
        note('later.md', 'A later note.\n')
        return quiet(run({}, { env })) && !fs.existsSync(path.join(dest, 'later.md'))
      }],
    ]
  }],

  ['slack-user-search-own-workspace.sh', run => {
    const search = { hook_event_name: 'PostToolUse', tool_name: 'mcp__slack__slack_search_users', tool_input: { query: 'Ville' }, tool_response: 'No results found' }
    return [
      ['adds the note on shared channels to the search result', () => {
        const r = run(search)
        return r.code === 0 && r.err === '' && context(r).includes('Slack Connect') && context(r).includes('slack_read_channel')
      }],
      ['answers as a PostToolUse hook', () => output(run(search)).hookSpecificOutput?.hookEventName === 'PostToolUse'],
    ]
  }],

  ['stack-held-by-peer.sh', run => {
    const work = path.join(home, 'stack-work'), marker = path.join(work, '.git/claude-stack-holder')
    const holder = path.join(home, 'holder.jsonl'), peer = path.join(home, 'peer.jsonl')
    const env = { CLAUDE_PROJECT_DIR: work }
    const as = (session_id, transcript_path, command) => ({ ...bash(command, work), session_id, transcript_path })
    const active = (file, ago = 0) => jsonl(file, [{ ...says('working'), timestamp: new Date(Date.now() - ago).toISOString() }])
    return [
      ['notes which session started the stack, and the start for the Stop hook', () => {
        sh(`git init -q ${q(work)}`)
        active(holder)
        active(peer)
        return quiet(run(as('s1', holder, 'docker compose up -d'), { env })) && fs.readFileSync(marker, 'utf8') === `s1\t${holder}\n` &&
          fs.existsSync(path.join(work, '.git/claude-stack-started-s1'))
      }],
      ['refuses another session stopping it while the holder is active', () => refused(run(as('s2', peer, 'docker compose down'), { env }))],
      ['refuses another session restarting it', () => refused(run(as('s2', peer, 'npm run start:local'), { env }))],
      ['leaves other docker commands alone', () => quiet(run(as('s2', peer, 'docker ps'), { env }))],
      ['takes the holder as idle when its last reply is old, however fresh the file', () => {
        active(holder, 60 * 60 * 1000)
        fs.appendFileSync(holder, '{"type":"mode","timestamp":null}\n')
        const r = run(as('s2', peer, 'docker compose restart'), { env })
        active(holder)
        sh(`printf 's1\\t%s\\n' ${q(holder)} > ${q(marker)}`)
        return !refused(r)
      }],
      ['lets the holder stop it and clears the note', () => quiet(run(as('s1', holder, 'docker compose down'), { env })) && !fs.existsSync(marker)],
    ]
  }],

  ['stop-running-stack.sh', run => {
    const work = path.join(home, 'stop-work'), t = path.join(home, 'stop.jsonl'), fake = path.join(home, 'fake-docker')
    const env = up => ({ CLAUDE_PROJECT_DIR: work, PATH: `${fake}:${ENV.PATH}`, FAKE_PS: up ? `web\t${work}` : '' })
    const stop = { session_id: 's1', transcript_path: t, stop_hook_active: false }
    const started = () => write(path.join(work, '.git/claude-stack-started-s1'), '')
    return [
      ['sends back a turn that started a stack and left it up', () => {
        sh(`git init -q ${q(work)}`)
        fs.chmodSync(write(path.join(fake, 'docker'), '#!/bin/sh\n[ -n "$FAKE_PS" ] && printf \'%s\\n\' "$FAKE_PS"\nexit 0\n'), 0o755)
        started()
        const r = run(stop, { env: env(true) })
        return refused(r) && r.err.includes('compose project web')
      }],
      ['sends it back only once', () => quiet(run(stop, { env: env(true) }))],
      ['lets it through once the stack is down', () => { started(); return quiet(run(stop, { env: env(false) })) }],
      ['lets the second stop of a turn through', () => { started(); return quiet(run({ ...stop, stop_hook_active: true }, { env: env(true) })) }],
      ['lets a turn through that started nothing', () => quiet(run(stop, { env: env(true) }))],
      ['leaves a stack another session holds to that session', () => {
        started()
        write(path.join(work, '.git/claude-stack-holder'), 's9\t/x\n')
        return quiet(run(stop, { env: env(true) }))
      }],
    ]
  }],

  ['stop-unreachable-claim.sh', run => {
    const t = path.join(home, 'unreachable.jsonl')
    const pane = { type: 'attachment', attachment: { type: 'deferred_tools', names: ['mcp__Claude_Browser__navigate'] } }
    const claim = "I couldn't open the attached PDF. The connector returns file not found."
    const stop = (last, active = false) => ({ session_id: 's1', transcript_path: t, stop_hook_active: active, last_assistant_message: last })
    return [
      ['sends back a claim made without trying the pane', () => {
        jsonl(t, [pane, human('read the pdf'), says(claim)])
        const r = run(stop(claim))
        return refused(r) && r.err.includes('browser pane')
      }],
      ['lets the second stop of a turn through', () => quiet(run(stop(claim, true)))],
      ['reads the reply from the transcript when the input has none', () => refused(run({ session_id: 's1', transcript_path: t, stop_hook_active: false }))],
      ['lets a claim through once the pane ran this turn', () => {
        jsonl(t, [pane, human('read the pdf'), uses('mcp__Claude_Browser__navigate', { url: 'https://example.com' }), says(claim)])
        return quiet(run(stop(claim)))
      }],
      ['does not count a pane call from an earlier turn', () => {
        jsonl(t, [pane, human('open it'), uses('mcp__Claude_Browser__navigate', { url: 'https://example.com' }), says('Done.'), human('read the pdf'), says(claim)])
        return refused(run(stop(claim)))
      }],
      ['lets a reply through that claims nothing', () => {
        jsonl(t, [pane, human('read the pdf'), says('Here is what it says.')])
        return quiet(run(stop('Here is what it says.')))
      }],
      ['lets a reply through about what someone else cannot open', () => {
        const s = "Your colleague probably can't open the links, since the repository is private."
        jsonl(t, [pane, human('draft it'), says(s)])
        return quiet(run(stop(s)))
      }],
      ['sends back a claim that something could not be found', () => {
        const s = "I couldn't find the invoice in your mail, so the total is missing."
        jsonl(t, [pane, human('add up the invoices'), says(s)])
        return refused(run(stop(s)))
      }],
      ['lets a claim through about what Claude cannot see', () => {
        const s = "I can't see the status line in the app, so check it there."
        jsonl(t, [pane, human('does it fit now'), says(s)])
        return quiet(run(stop(s)))
      }],
      ['lets a session without the pane through', () => {
        jsonl(t, [human('read the pdf'), says(claim)])
        return quiet(run(stop(claim)))
      }],
    ]
  }],

  ['usage-log.sh', run => {
    const t = path.join(config, 'projects/-usage/s.jsonl'), out = path.join(config, 'usage-log/2026-10.jsonl')
    const user = { type: 'user', uuid: 'u1', timestamp: '2026-10-20T10:00:00.000Z', message: { content: 'hi' } }
    const reply = (id, timestamp) => ({ type: 'assistant', uuid: `a-${id}`, parentUuid: 'u1', timestamp, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } } })
    const logged = () => fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l).id) : []
    return [
      ['does nothing while the usage mod is missing', () => { jsonl(t, [user, reply('msg_1', '2026-10-20T10:00:05.000Z')]); return quiet(run({ transcript_path: t })) && logged().length === 0 }],
      ['logs each response of the transcript', () => {
        const target = path.join(home, '.claude/mods/session-usage/usage.sh')
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(USAGE_SH, target)
        fs.chmodSync(target, 0o755)
        return quiet(run({ transcript_path: t })) && logged().join() === 'msg_1'
      }],
      ['logs nothing twice', () => quiet(run({ transcript_path: t })) && logged().join() === 'msg_1'],
      ['adds only the responses after the last one logged', () => {
        fs.appendFileSync(t, JSON.stringify(reply('msg_2', '2026-10-20T10:01:00.000Z')) + '\n')
        return quiet(run({ transcript_path: t })) && logged().join() === 'msg_1,msg_2'
      }],
    ]
  }],

  ['own-hunks.sh', run => {
    const checkout = path.join(home, 'Projects/dotclaude'), records = path.join(checkout, '.git/own-hunks')
    const rules = path.join(config, 'CLAUDE.md'), readme = path.join(checkout, 'README.md')
    const call = (tool_name, tool_input, tool_use_id, session_id = 'oh1') => hook_event_name =>
      ({ hook_event_name, session_id, tool_name, tool_input, tool_use_id })
    const around = (input, change, after = 'PostToolUse') => {
      const pre = run(input('PreToolUse'))
      change()
      return quiet(pre) && quiet(run(input(after)))
    }
    const recorded = (session = 'oh1') => {
      const file = path.join(records, session)
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(l => l.split(' ')) : []
    }
    const paths = session => recorded(session).map(r => r[2]).join()
    const blob = id => sh(`git -C ${q(checkout)} cat-file blob ${id}`)
    return [
      ['does nothing without a checkout', () => {
        fs.rmSync(checkout, { recursive: true, force: true })
        return around(call('Edit', { file_path: rules }, 'toolu_o0'), () => write(rules, '- one\n')) && !fs.existsSync(records)
      }],
      ['records an Edit of a published file with its text before and after', () => {
        sh(`git init -q ${q(checkout)} && cd ${q(checkout)} && printf 'mirrored=(\\n  CLAUDE.md\\n)\\n' > sync.sh && printf '# Readme\\n' > README.md && cp ${q(rules)} CLAUDE.md && git add -A && git commit -q -m start`)
        const ok = around(call('Edit', { file_path: rules }, 'toolu_o1'), () => write(rules, '- one\n- two\n'))
        const [[before, after]] = recorded()
        return ok && paths() === 'CLAUDE.md' && blob(before) === '- one\n' && blob(after) === '- one\n- two\n'
      }],
      ['records what reflow.sh rewrapped, after a failed call too', () => {
        const ok = around(call('Bash', { command: '~/Projects/dotclaude/reflow.sh' }, 'toolu_o2'),
          () => { write(rules, '- one\n- two\n- three\n'); write(readme, '# Readme\n\nText.\n') }, 'PostToolUseFailure')
        return ok && paths() === 'CLAUDE.md,CLAUDE.md,README.md'
      }],
      ['records nothing for a command that runs sync.sh', () => {
        const ok = around(call('Bash', { command: 'cd ~/Projects/dotclaude && ./sync.sh --commit msg.txt CLAUDE.md' }, 'toolu_o3'),
          () => write(rules, '- one\n- two\n- three\n- four\n'))
        return ok && recorded().length === 3
      }],
      ['records nothing for a file sync.sh installed during the call', () => {
        const ok = around(call('Edit', { file_path: rules }, 'toolu_o4'), () => {
          write(rules, '- pulled\n')
          fs.appendFileSync(path.join(checkout, '.git/sync-installed.log'), `${Math.floor(Date.now() / 1000)} ${rules}\n`)
        })
        return ok && recorded().length === 3
      }],
      ['records what a script changed under the session that ran it', () => {
        const ok = around(call('Bash', { command: 'bash fix.sh' }, 'toolu_o5', 'oh2'), () => write(readme, '# Readme\n\nFixed.\n'))
        return ok && paths('oh2') === 'README.md' && recorded().length === 3
      }],
      ['records nothing for a file the checkout does not publish', () => {
        const notes = path.join(config, 'notes.md')
        const ok = around(call('Edit', { file_path: notes }, 'toolu_o6'), () => write(notes, 'x\n'))
        return ok && recorded().length === 3 && fs.readdirSync(path.join(records, 'pending')).length === 0
      }],
    ]
  }],
]

const hooks = fs.readdirSync(HOOKS).filter(f => f.endsWith('.sh')).sort()
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'))
const wired = Object.values(settings.hooks || {}).flat().flatMap(m => m.hooks || []).map(h => (h.command || '').match(/hooks\/([\w.-]+\.sh)/)?.[1]).filter(Boolean)
suites.push(['every hook', () => [
  ['parses with bash -n', () => hooks.every(h => spawnSync('bash', ['-n', path.join(HOOKS, h)]).status === 0)],
  ['has checks in this file', () => hooks.every(h => suites.some(([name]) => name === h))],
  ['settings.json runs only hooks that exist', () => wired.every(h => hooks.includes(h))],
]])

let failed = 0
let total = 0
for (const [hook, make] of suites) {
  console.log(`== ${hook}`)
  for (const [desc, check] of make((input, opts) => run(hook, input, opts))) {
    let pass = false, note = ''
    try { pass = Boolean(check()) } catch (e) { note = `\n    ${String(e.message).split('\n').join('\n    ')}` }
    total++
    if (!pass) failed++
    console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${desc}${note}`)
  }
}
const missing = hooks.filter(h => !suites.some(([name]) => name === h))
if (missing.length) console.log(`no checks for ${missing.join(', ')}`)
fs.rmSync(home, { recursive: true, force: true })
console.log(failed ? `${failed} of ${total} checks failed` : `all ${total} checks passed`)
process.exit(failed ? 1 : 0)
