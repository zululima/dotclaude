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
// Addresses, home paths and secrets are put together at run time, so the sync.sh scan does not take them for real ones.
const address = (name, domain = 'example.com') => [name, domain].join('@')
const otherHome = ['', 'Users', 'someone'].join('/')
const linuxHome = ['', 'home', 'someone'].join('/')
const fakeSecret = ['s3cr', 'etValue9'].join('')
const publicHost = ['db', 'example', 'com'].join('.')
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
  ['no-session-cards.sh', run => {
    const start = tool_input => run({ hook_event_name: 'PreToolUse', tool_name: 'mcp__ccd_session__start_session', tool_input })
    return [
      ['refuses a proposal card', () => refused(start({ initiation: 'own_initiative', title: 'Fix it', prompt: 'Fix it.' }))],
      ['refuses an offer card', () => refused(start({ initiation: 'offer', title: 'Fix it' }))],
      ['lets a session the user asked for start', () => quiet(start({ initiation: 'user_asked', title: 'Fix it', prompt: 'Fix it.' }))],
      ['lets a proposal the user started go through', () => quiet(start({ proposal_id: 'task_1' }))],
    ]
  }],

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

  ['no-github-posts.sh', run => {
    jsonl(path.join(config, 'prompt-log', 'gp1.jsonl'), [
      { session_id: 'gp1', prompt: 'merge with approved comment lgtm   looks\nfine to me' },
      { session_id: 'gp1', prompt: '<task-notification>\nship it\n</task-notification>' },
    ])
    const asUser = command => ({ ...bash(command), session_id: 'gp1' })
    return [
    ['lets a review through whose body a prompt holds', () => quiet(run(asUser("gh pr review 12 --approve --body 'lgtm looks fine to me'")))],
    ['lets an approval with no body through', () => quiet(run(asUser('gh pr review 12 --approve')))],
    ['refuses a review whose body no prompt holds', () => refused(run(asUser("gh pr review 12 --approve --body 'lgtm, merged'")))],
    ['refuses words only a task notification holds', () => refused(run(asUser("gh pr comment 12 --body 'ship it'")))],
    ['refuses a comment review whose body no prompt holds', () => refused(run(asUser("gh pr review 12 -c -b 'other words'")))],
    ['lets a body file through whose text a prompt holds', () => { write(path.join(home, 'body.md'), 'looks fine\nto me\n'); return quiet(run(asUser('gh pr comment 12 --body-file body.md'))) }],
    ['refuses a comment read from stdin', () => refused(run(asUser("gh pr comment 12 --body-file - <<'EOF'\nlgtm\nEOF")))],
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
    ]
  }],

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

  ['no-secrets-in-commands.sh', run => {
    // A key is put together at run time too, and a variable is written as '$' + name so JavaScript leaves it alone.
    const key = ['sk', 'ant', 'api03', 'a'.repeat(30)].join('-')
    const variable = name => '$' + name
    const refusedFor = (r, what) => refused(r) && r.err.includes(what) && !r.err.includes(fakeSecret) && !r.err.includes(key)
    return [
      ['refuses a password in PGPASSWORD for a public host', () => refusedFor(run(bash(`PGPASSWORD=${fakeSecret} psql -h ${publicHost} -U app`)), 'PGPASSWORD')],
      ['refuses a password after sshpass -p', () => refusedFor(run(bash(`sshpass -p '${fakeSecret}' ssh deploy@203.0.113.5`)), 'sshpass -p')],
      ['refuses a password after mysql -p', () => refusedFor(run(bash(`mysql -h ${publicHost} -uapp -p${fakeSecret} app`)), 'after -p')],
      ['refuses a password after --password and curl -u', () =>
        refusedFor(run(bash(`docker login -u me --password ${fakeSecret} registry.example.org`)), '--password') &&
        refusedFor(run(bash(`curl -u me:${fakeSecret} https://api.example.org`)), 'after -u')],
      ['refuses a token in an Authorization header', () => refusedFor(run(bash(`curl -H "Authorization: Bearer ${fakeSecret}${fakeSecret}" https://api.example.org`)), 'a header')],
      ['refuses a password in an address on a public host', () => refusedFor(run(bash(`psql postgres://app:${fakeSecret}@${publicHost}/app`)), `address on ${publicHost}`)],
      ['refuses a key in a provider\'s format and shows only its start', () => refusedFor(run(bash(`curl -H "x-api-key: ${key}" https://api.example.org`)), 'provider')],
      ['lets a value read from a variable or a command through', () =>
        quiet(run(bash(`PGPASSWORD="${variable('DB_PASSWORD')}" psql -h ${publicHost}`))) &&
        quiet(run(bash(`psql "postgres://app:${variable('{PW}')}@${publicHost}/app"`))) &&
        quiet(run(bash('curl -H "Authorization: Bearer $(gh auth token)" https://api.github.com/user')))],
      ['lets a local default and a password for a local host through', () =>
        quiet(run(bash('docker compose exec -T db mysql -uroot -proot app'))) &&
        quiet(run(bash(`PGPASSWORD=${fakeSecret} psql -h localhost -U app`))) &&
        quiet(run(bash(`psql postgres://app:${fakeSecret}@localhost:5432/app`)))],
      ['lets a placeholder and --password-stdin through', () =>
        quiet(run(bash(`PGPASSWORD=${['PASTE', 'VALUE', 'HERE'].join('_')} psql -h ${publicHost}`))) &&
        quiet(run(bash(`echo "${variable('T')}" | docker login -u me --password-stdin registry.example.org`)))],
      ['ignores a search for the patterns themselves', () => quiet(run(bash("grep -E 'PGPASSWORD=[^$ ]|sk-ant-|Bearer [A-Za-z]' notes.md")))],
    ]
  }],

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

  ['sync-conflicts.sh', run => {
    const prompt = (session_id = 'sc1') => run({ hook_event_name: 'UserPromptSubmit', session_id })
    const memory = path.join(config, 'projects/-sync/memory/MEMORY.sync-conflict-20261109-090000-ABCDEFG.md')
    const rules = path.join(config, 'rules/a.sync-conflict-20261109-090100-ABCDEFG.md')
    return [
      ['says nothing while no copy exists', () => quiet(prompt())],
      ['skips folders that hold one machine\'s runtime state', () => {
        write(path.join(config, 'telemetry/t.sync-conflict-20261109-090000-ABCDEFG.json'), '{}')
        const r = quiet(prompt())
        fs.rmSync(path.join(config, 'telemetry'), { recursive: true })
        return r
      }],
      ['names a copy with a home path shortened to ~', () => {
        write(memory, '- a\n')
        return context(prompt()).includes('~/.claude/projects/-sync/memory/MEMORY.sync-conflict-')
      }],
      ['names the same copies once per session', () => quiet(prompt())],
      ['names them to another session', () => context(prompt('sc2')).includes('MEMORY.sync-conflict-')],
      ['names a new set again', () => { write(rules, '- b\n'); return context(prompt()).includes('a.sync-conflict-') }],
      ['ignores a session id that is not a plain name', () => quiet(prompt('../sc3'))],
      ['says nothing once the copies are merged away', () => {
        fs.rmSync(memory); fs.rmSync(rules)
        return quiet(prompt('sc4'))
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

  ['archive-when-done.sh', run => {
    const t = path.join(home, 'archive.jsonl')
    const repo = path.join(home, 'archive-repo')
    const box = input => uses('mcp__ccd_turn__wrap_up', { recap: 'r', ...input })
    const stop = (last, extra = {}) => ({ hook_event_name: 'Stop', transcript_path: t, cwd: home, stop_hook_active: false, background_tasks: [], last_assistant_message: last, ...extra })
    return [
      ['sends back a turn whose box asked nothing and whose reply names no archive', () => { jsonl(t, [human('fix it'), box({}), says('Fixed.')]); return refused(run(stop('Fixed.'))) }],
      ['lets the turn end once the reply says the session can be archived', () => { jsonl(t, [human('fix it'), box({})]); return quiet(run(stop('Fixed. You can archive this session.'))) }],
      ['lets a turn through whose box asked a question', () => { jsonl(t, [human('fix it'), box({ ask: 'Commit it?', actions: [{ label: 'Yes' }] })]); return quiet(run(stop('Fixed.'))) }],
      ['lets a turn through that called no box', () => { jsonl(t, [human('what is x'), says('x is y.')]); return quiet(run(stop('x is y.'))) }],
      ['reads only the box of the current turn', () => { jsonl(t, [human('fix it'), box({}), human('and why'), says('Because.')]); return quiet(run(stop('Because.'))) }],
      ['lets a turn through with background work in flight', () => { jsonl(t, [human('fix it'), box({})]); return quiet(run(stop('Fixed.', { background_tasks: [{ id: 'b1' }] }))) }],
      ['lets the second stop of a turn through', () => { jsonl(t, [human('fix it'), box({})]); return quiet(run(stop('Fixed.', { stop_hook_active: true }))) }],
      ['lets a turn through on a branch other than the default one', () => {
        sh(`git init -q ${q(repo)} && git -C ${q(repo)} commit -q --allow-empty -m one && git -C ${q(repo)} update-ref refs/remotes/origin/main HEAD && git -C ${q(repo)} symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main && git -C ${q(repo)} switch -q -c feature`)
        jsonl(t, [human('fix it'), box({})])
        return quiet(run(stop('Fixed.', { cwd: repo })))
      }],
      ['still sends it back on the default branch', () => { sh(`git -C ${q(repo)} switch -q main`); return refused(run(stop('Fixed.', { cwd: repo }))) }],
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

  ['energy-session-pid.sh', run => {
    const pids = path.join(home, 'Library/Logs/claude-energy/pids')
    const mine = path.join(pids, String(process.pid))
    const prompt = session_id => ({ hook_event_name: 'UserPromptSubmit', session_id, prompt: 'go on' })
    return [
      ['does nothing while the sampler is not installed', () => quiet(run(prompt('e1'))) && !fs.existsSync(pids)],
      ['writes the session id under the pid of the process that ran the hook', () => { fs.mkdirSync(pids, { recursive: true }); return quiet(run(prompt('e1'))) && fs.readFileSync(mine, 'utf8') === 'e1\n' }],
      ['takes the new id after a /clear in the same process', () => quiet(run(prompt('e2'))) && fs.readFileSync(mine, 'utf8') === 'e2\n'],
      ['writes no id that is not a plain session id', () => quiet(run(prompt('../e3'))) && fs.readFileSync(mine, 'utf8') === 'e2\n'],
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
      ['gives each prompt the recap and the last message of its turn', () => {
        jsonl(path.join(config, 'prompt-log/p7.jsonl'), [
          { timestamp: '2020-01-01T00:00:00Z', prompt: 'build it' },
          { timestamp: '2020-01-01T00:01:00Z', prompt: 'and test it' },
        ])
        const said = (t, id, content) => ({ type: 'assistant', timestamp: `2020-01-01T00:${t}Z`, message: { id, model: 'm', content } })
        jsonl(path.join(config, 'projects/x/p7.jsonl'), [
          { type: 'user', timestamp: '2020-01-01T00:00:00.100Z', message: { content: 'build it' } },
          said('00:10', 'm1', [{ type: 'text', text: 'Building.' }]),
          said('00:20', 'm2', [{ type: 'tool_use', name: 'mcp__ccd_turn__wrap_up', input: { recap: 'It is built.' } }]),
          said('00:21', 'm3', [{ type: 'text', text: 'Built it.' }]),
          said('00:21.500', 'm3', [{ type: 'text', text: 'Nothing else.' }]),
          { type: 'user', timestamp: '2020-01-01T00:01:00.100Z', message: { content: 'and test it' } },
          said('01:10', 'm4', [{ type: 'text', text: '## Done\n\nTests pass, see [the log](https://example.com/log)\nfor **all** of it.\n\nMore.' }]),
        ])
        const r = run('', { args: ['turns'], env: { PROMPT_LOG_SESSION: 'p7' } })
        const [one, two, more] = r.out.trim().split('\n').map(line => JSON.parse(line))
        return r.code === 0 && !more && one.n === 1 && one.prompt === 'build it' && one.recap === 'It is built.'
          && one.reply === 'Built it.\n\nNothing else.' && one.end === two.start
          && two.n === 2 && two.recap === null && two.reply.startsWith('## Done') && two.end === null
      }],
      ['puts the recap, or else the first paragraph of the last message, under each prompt', () => {
        const printed = (env, ...args) => run('', { args: ['print', '--model', 'm', '--effort', 'high', ...args], env: { PROMPT_LOG_SESSION: 'p7', ...env } }).out
        const commit = printed({}, '--commit'), pr = printed({}), live = printed({ CLAUDE_CODE_SESSION_ID: 'p7' }, '--commit')
        return commit.endsWith('\n1.\n> build it\nReply: It is built.\n\n2.\n> and test it\nReply: Tests pass, see the log for all of it.\n\n')
          && pr.endsWith('\n**1.**\n> build it\n\nReply: It is built.\n\n**2.**\n> and test it\n\nReply: Tests pass, see the log for all of it.\n\n')
          && live.endsWith('\n1.\n> build it\nReply: It is built.\n\n2.\n> and test it\n\n')
      }],
      ['masks the lines outside a quote but keeps their links', () => {
        const r = run(`> see https://example.com/a and ${address('bob')}\nsee https://example.com/a and ${address('bob')} in ${otherHome}/p, TOKEN=abc\n`, { args: ['mask', '--unquoted-links'] })
        return r.out === `> see https://example.com/a and ${address('bob')}\nsee https://example.com/a and [an address] in ~/p, TOKEN=[redacted]\n`
      }],
      ['cuts a long reply at 300 characters and wraps it at 72 columns for a commit', () => {
        jsonl(path.join(config, 'prompt-log/p8.jsonl'), [{ timestamp: '2020-01-01T00:00:00Z', prompt: 'explain' }])
        jsonl(path.join(config, 'projects/x/p8.jsonl'), [
          { type: 'assistant', timestamp: '2020-01-01T00:00:10Z', message: { id: 'm1', model: 'm', content: [{ type: 'text', text: `${'word '.repeat(80)}in ${otherHome}/x.` }] } },
        ])
        const out = run('', { args: ['print', '--commit', '--model', 'm', '--effort', 'high'], env: { PROMPT_LOG_SESSION: 'p8' } }).out
        const reply = out.slice(out.indexOf('Reply: '))
        return reply.split('\n').every(l => l.length <= 72) && reply.trim().endsWith('word...') && reply.replace(/\n/g, ' ').trim().length <= 300 + 7
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
      ['puts the reply under its prompt, and under a prompt quoted again only when it changed', () => {
        write(path.join(home, 'pm-7.txt'), body('Add the summary', 'sum it up') + 'Reply: It is summed up, from\n2. the start.\n\n2.\n> and push\n')
        write(path.join(home, 'pm-8.txt'), body('Fix the summary', 'sum it up') + 'Reply: It is summed up, from\n2. the start.\n')
        write(path.join(home, 'pm-9.txt'), body('Fix it again', 'sum it up') + 'Reply: Fixed twice.\n')
        sh(`cd ${q(work)} && for n in 7 8 9; do echo $n > r$n && git add r$n && git commit -q -F ${q(home)}/pm-$n.txt; done`)
        const text = (run('', { cwd: work }), fs.readFileSync(file, 'utf8'))
        const entry = subject => text.slice(text.indexOf(`## ${subject}`)).split('\n## ')[0]
        return entry('Add the summary').includes('> sum it up\n\nReply: It is summed up, from 2. the start.\n\n**2.**\n> and push\n')
          && /\*\*1\.\*\* Quoted under \[?[0-9a-f]{7}.*\.\n$/.test(entry('Fix the summary'))
          && entry('Fix it again').includes('.\n\nReply: Fixed twice.\n')
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
      ['lists the commits a merge in progress brings in, as the merge commit will', () => {
        const merge = path.join(home, 'pm-merge'), mergeFile = path.join(merge, 'PROMPTS.md')
        const [base, side, main, msg] = [body('Add the base', 'add a base'), body('Add the side', 'add a side'), body('Add the main', 'add a main'), 'Merge branch side\n']
          .map((text, i) => write(path.join(home, `pm-merge-${i}.txt`), text))
        sh(`git init -q ${q(merge)} && cd ${q(merge)} && echo base > PROMPTS.md && git add PROMPTS.md && git commit -q -F ${q(base)} && git switch -q -c side && echo side > PROMPTS.md && git commit -q -a -F ${q(side)} && git switch -q main && echo main > PROMPTS.md && git commit -q -a -F ${q(main)} && { git merge -q --no-commit side >/dev/null 2>&1 || true; }`)
        const r = run('', { cwd: merge, args: ['--message', msg] })
        const during = fs.readFileSync(mergeFile, 'utf8')
        sh(`cd ${q(merge)} && git add PROMPTS.md && git commit -q -F ${q(msg)}`)
        run('', { cwd: merge })
        return r.code === 0 && during.includes('> add a side') && during === fs.readFileSync(mergeFile, 'utf8')
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
      ['holds back a note with a password inside a command, but not a local default', () => {
        fs.rmSync(path.join(memory, 'login.md'))
        note('db.md', `Connect with PGPASSWORD=${fakeSecret} psql -h ${publicHost}.\n`)
        note('local.md', 'Local: docker compose exec -T db mysql -uroot -proot app\n')
        const r = run({}, { env })
        settle()
        return r.code === 2 && r.err.includes('db.md') && !r.err.includes('local.md') &&
          !fs.existsSync(path.join(dest, 'db.md')) && fs.existsSync(path.join(dest, 'local.md'))
      }],
      ['leaves repositories of other owners alone', () => {
        sh(`git -C ${q(proj)} remote set-url origin https://github.com/other/proj.git`)
        note('later.md', 'A later note.\n')
        return quiet(run({}, { env })) && !fs.existsSync(path.join(dest, 'later.md'))
      }],
    ]
  }],

  ['no-own-email-in-requests.sh', run => {
    const own = address('test')
    // The hook refuses an edit that names the setting or variable an address comes from, so these are put together too.
    const gitKey = ['user', 'email'].join('.')
    const envKey = ['CLAUDE', 'CODE', 'USER', 'EMAIL'].join('_')
    const tool = (tool_name, tool_input) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: home, session_id: 's1' })
    const refusedFor = (r, place) => refused(r) && r.err.includes(place)
    const listed = path.join(config, 'own-addresses.txt')
    return [
      ['lets a request with no address through', () => quiet(run(bash('curl -A "tool/1.0" https://api.example.org')))],
      ['refuses the git address in a curl User-Agent', () => refusedFor(run(bash(`curl -A "tool/1.0 (${own})" https://api.example.org`)), 'a User-Agent')],
      ['refuses a User-Agent that reads git config', () => refusedFor(run(bash(`curl -A "tool ($(git config ${gitKey}))" https://api.example.org`)), 'a User-Agent')],
      ['refuses the address in a fetched URL, percent-encoded too', () => refusedFor(run(tool('WebFetch', { url: `https://api.example.org/?e=${own}` })), 'a URL')
        && refusedFor(run(tool('WebFetch', { url: `https://api.example.org/?e=${own.replace('@', '%40')}` })), 'a URL')],
      ['refuses a web search for the address', () => refusedFor(run(tool('WebSearch', { query: own })), 'a web search')],
      ['refuses a From header in a written script', () => refusedFor(run(tool('Write', { file_path: path.join(home, 'x.py'), content: `requests.get(url, headers={'From': '${own}'})\n` })), 'a From header')],
      ['refuses a mailto contact in an edit', () => refusedFor(run(tool('Edit', { file_path: path.join(home, 'x.js'), old_string: 'a', new_string: `const agent = { mailto: '${own}' }` })), 'a mailto contact')],
      ['lets a mailto link in a page through', () => quiet(run(tool('Write', { file_path: path.join(home, 'x.html'), content: `<a href="mailto:${own}">mail</a>\n` })))],
      ['lets the address through where it reaches no website', () => quiet(run(bash(`git log --author=${own}`)))],
      ['lets another person\'s address through', () => quiet(run(bash(`curl -A "tool (${address('someone')})" https://api.example.org`)))],
      ['takes addresses from own-addresses.txt and the environment', () => {
        write(listed, `# work\n${address('work', 'example.org')}\n`)
        const fromFile = refusedFor(run(tool('WebFetch', { url: `https://x.example.net/?e=${address('work', 'example.org')}` })), 'a URL')
        fs.rmSync(listed)
        return fromFile && refusedFor(run(tool('WebSearch', { query: address('env') }), { env: { [envKey]: address('env') } }), 'a web search')
      }],
      ['leaves edits of the hook itself alone', () => quiet(run(tool('Edit', { file_path: path.join(config, 'hooks/no-own-email-in-requests.sh'), old_string: 'a', new_string: `curl -A "x (${own})" https://api.example.org` })))],
      ['leaves other tools alone', () => quiet(run(tool('Read', { file_path: path.join(home, own) })))],
    ]
  }],

  ['chrome-background.sh', run => {
    const bin = path.join(home, 'chrome-stubs')
    const browser = path.join(home, 'chrome-browser')
    const calls = path.join(home, 'chrome-calls')
    const started = path.join(home, 'chrome-started')
    const stub = (dir, name, body) => { write(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`); fs.chmodSync(path.join(dir, name), 0o755) }
    stub(bin, 'uname', 'echo "$FAKE_OS"')
    stub(bin, 'open', `echo "open $*" >> ${q(calls)}`)
    stub(bin, 'osascript', `case "$*" in
  *'"front"'*) echo "$CHROME_STATE" ;;
  *'chrome().hide;'*) echo hide >> ${q(calls)} ;;
  *) echo keep-hidden >> ${q(calls)} ;;
esac`)
    stub(bin, 'setsid', `echo "setsid $*" >> ${q(calls)}; touch ${q(started)}`)
    stub(bin, 'busctl', `case "$*" in
  *WindowsRunner*) if [ "$WINDOWS" = 1 ] || [ -e ${q(started)} ]; then echo '{"data":[[["1","Page - Chromium","",100,1,{}]]]}'; else echo '{"data":[[]]}'; fi ;;
  *unloadScript*) echo unload >> ${q(calls)} ;;
  *loadScript*) echo load >> ${q(calls)}; [ "$KWIN" = up ] && echo 'i 7' ;;
  *Script7*) echo run-script >> ${q(calls)} ;;
esac`)
    stub(browser, 'chromium', 'exit 0')
    fs.symlinkSync(spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim(), path.join(bin, 'jq'))
    const go = (env, withBrowser = true) => {
      fs.rmSync(calls, { force: true })
      fs.rmSync(started, { force: true })
      const r = run({}, { env: { PATH: `${withBrowser ? `${browser}:` : ''}${bin}:/usr/bin:/bin`, CHROME_STATE: '', WINDOWS: '0', KWIN: 'up', ...env } })
      return { ...r, calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [] }
    }
    const mac = state => go({ FAKE_OS: 'Darwin', CHROME_STATE: state })
    const linux = (env = {}, withBrowser) => go({ FAKE_OS: 'Linux', ...env }, withBrowser)
    const opens = (line, flags) => line.startsWith(`open ${flags} -a Google Chrome `) && line.endsWith('/chrome-anchor.html')
    return [
      ['leaves a Chrome that has a window alone', () => { const r = mac('window'); return r.code === 0 && r.out.includes('already has a window') && !r.calls.length }],
      ['opens the anchor in the background when Chrome is not running, then keeps it hidden', () => { const r = mac('none'); return r.code === 0 && opens(r.calls[0], '-g -j') && r.calls[1] === 'keep-hidden' }],
      ['hides a windowless Chrome before it opens the anchor', () => { const r = mac('back'); return r.code === 0 && r.calls[0] === 'hide' && opens(r.calls[1], '-g') && r.calls[2] === 'keep-hidden' }],
      ['leaves Chrome in view when it was the app in front', () => { const r = mac('front'); return r.code === 0 && r.calls.length === 1 && opens(r.calls[0], '-g') }],
      ['on Linux, stops when neither Chromium nor Chrome is installed', () => { const r = linux({}, false); return r.code === 1 && r.out.includes('Neither Chromium nor Chrome') }],
      ['on Linux, leaves a browser that has a window alone', () => { const r = linux({ WINDOWS: '1' }); return r.code === 0 && r.out.includes('already has a window') && !r.calls.some(c => c.startsWith('setsid')) }],
      ['on Linux, runs the KWin script before it starts the browser on the anchor', () => {
        const r = linux()
        const s = r.calls.findIndex(c => c.startsWith('setsid'))
        return r.code === 0 && r.out.includes('hidden window') && r.calls.indexOf('run-script') > -1 && r.calls.indexOf('run-script') < s
          && /chromium file:\/\/.*\/chrome-anchor\.html$/.test(r.calls[s]) && r.calls[r.calls.length - 1] === 'unload'
      }],
      ['on Linux, says the window stays in view when KWin does not answer', () => { const r = linux({ KWIN: 'down' }); return r.code === 0 && r.out.includes('KWin did not answer') && r.calls.some(c => c.startsWith('setsid')) }],
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
    const browser = { type: 'attachment', attachment: { type: 'deferred_tools', names: ['mcp__claude-in-chrome__navigate'] } }
    const claim = "I couldn't open the attached PDF. The connector returns file not found."
    const stop = (last, active = false) => ({ session_id: 's1', transcript_path: t, stop_hook_active: active, last_assistant_message: last })
    return [
      ['sends back a claim made without trying Chrome', () => {
        jsonl(t, [browser, human('read the pdf'), says(claim)])
        const r = run(stop(claim))
        return refused(r) && r.err.includes('Claude in Chrome')
      }],
      ['lets the second stop of a turn through', () => quiet(run(stop(claim, true)))],
      ['reads the reply from the transcript when the input has none', () => refused(run({ session_id: 's1', transcript_path: t, stop_hook_active: false }))],
      ['lets a claim through once Chrome ran this turn', () => {
        jsonl(t, [browser, human('read the pdf'), uses('mcp__claude-in-chrome__navigate', { url: 'https://example.com' }), says(claim)])
        return quiet(run(stop(claim)))
      }],
      ['does not count a Chrome call from an earlier turn', () => {
        jsonl(t, [browser, human('open it'), uses('mcp__claude-in-chrome__navigate', { url: 'https://example.com' }), says('Done.'), human('read the pdf'), says(claim)])
        return refused(run(stop(claim)))
      }],
      ['lets a reply through that claims nothing', () => {
        jsonl(t, [browser, human('read the pdf'), says('Here is what it says.')])
        return quiet(run(stop('Here is what it says.')))
      }],
      ['lets a reply through about what someone else cannot open', () => {
        const s = "Your colleague probably can't open the links, since the repository is private."
        jsonl(t, [browser, human('draft it'), says(s)])
        return quiet(run(stop(s)))
      }],
      ['sends back a claim that something could not be found', () => {
        const s = "I couldn't find the invoice in your mail, so the total is missing."
        jsonl(t, [browser, human('add up the invoices'), says(s)])
        return refused(run(stop(s)))
      }],
      ['sends back a claim made in Finnish', () => {
        const s = 'Liite jäi lukematta, koska palvelin antoi virheen.'
        jsonl(t, [browser, human('lue liite'), says(s)])
        return refused(run(stop(s)))
      }],
      ['sends back a Finnish claim whose verb comes later', () => {
        const s = 'En saanut sivua auki, joten hinta puuttuu.'
        jsonl(t, [browser, human('hae hinta'), says(s)])
        return refused(run(stop(s)))
      }],
      ['lets a Finnish reply through that only names what it left unchecked', () => {
        const s = 'En tarkistanut hintaa, koska et pyytänyt sitä.'
        jsonl(t, [browser, human('hae hinta'), says(s)])
        return quiet(run(stop(s)))
      }],
      ['lets a claim through about what Claude cannot see', () => {
        const s = "I can't see the status line in the app, so check it there."
        jsonl(t, [browser, human('does it fit now'), says(s)])
        return quiet(run(stop(s)))
      }],
      ['lets a session without Chrome through', () => {
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

  ['usage-waiting.sh', run => {
    const file = path.join(config, 'usage-waiting/s1'), beacon = path.join(config, 'usage-beacon')
    const stop = tasks => ({ hook_event_name: 'Stop', session_id: 's1', stop_hook_active: false, background_tasks: tasks })
    const watch = { id: 'b1', type: 'shell', status: 'running', description: 'gh run watch', command: 'gh run watch 1' }
    const text = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null
    return [
      ['writes nothing for a turn that leaves no run', () => {
        fs.rmSync(beacon, { force: true })
        return quiet(run(stop([]))) && text(file) === null && text(beacon) === null
      }],
      ['writes the time and the beacon when a run is left in flight', () => quiet(run(stop([watch]))) && /^\d+\n$/.test(text(file)) && text(beacon) === 's1\n'],
      ['empties the file when a later turn leaves none', () => quiet(run(stop([]))) && text(file) === ''],
      ['takes a missing list for none', () => quiet(run({ hook_event_name: 'Stop', session_id: 's1' })) && text(file) === ''],
      ['ignores a session id that is not a plain name', () => quiet(run({ ...stop([watch]), session_id: '../s2' })) && text(path.join(config, 's2')) === null],
      ['sends a turn back once when it leaves no run and the tasks pane shown', () => {
        write(path.join(config, 'usage-tasks/s1'), '1\n')
        return refused(run(stop([]))) && quiet(run({ ...stop([]), stop_hook_active: true }))
      }],
      ['lets the pane stay while a run is in flight', () => quiet(run(stop([watch])))],
      ['lets a turn end once the pane is closed', () => {
        write(path.join(config, 'usage-tasks/s1'), '')
        return quiet(run(stop([])))
      }],
    ]
  }],

  ['usage.sh --status', () => {
    const t = path.join(config, 'projects/-signin/s.jsonl'), fake = path.join(home, 'fake-pgrep')
    fs.chmodSync(write(path.join(fake, 'pgrep'), '#!/bin/sh\nexit 0\n'), 0o755)
    const start = Date.UTC(2026, 10, 3, 14, 0)
    let n = 0
    // A Claude in Chrome call s seconds after the start, and its result listing the group's tabs.
    const chrome = (s, name, input, tabs, on = Object.keys(tabs)[0]) => {
      const id = `toolu_${++n}`, list = Object.entries(tabs).map(([tab, url]) => `  • tabId ${tab}: "Page" ("${url}")`)
      return [
        { type: 'assistant', uuid: `a${n}`, timestamp: new Date(start + s * 1000 - 1000).toISOString(), message: { id: `msg_${n}`, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id, name: `mcp__claude-in-chrome__${name}`, input }] } },
        { type: 'user', uuid: `u${n}`, timestamp: new Date(start + s * 1000).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: `Done\n\nTab Context:\n- Executed on tabId: ${on}\n- Available tabs:\n${list.join('\n')}` }] }] } },
      ]
    }
    // The seconds after the start that the sign-in ends, or 0 for none.
    const ends = records => {
      jsonl(t, records.flat())
      const r = spawnSync('bash', [USAGE_SH, '--status', t], { env: { ...ENV, PATH: `${fake}:${ENV.PATH}` }, encoding: 'utf8' })
      const at = Number(r.stdout.split('\n')[4])
      return at ? at - start / 1000 : 0
    }
    const site = 'https://tyomarkkinatori.fi/henkiloasiakkaat/asiointi', bank = 'https://online.s-pankki.fi/'
    const signIn = [
      chrome(10, 'navigate', { url: site }, { 1: 'https://tyomarkkinatori.fi/kirjaudu?redirecturi=%2Fhenkiloasiakkaat' }),
      chrome(20, 'computer', { action: 'left_click' }, { 1: 'https://tunnistautuminen.suomi.fi/sivut/discovery-page/?timeout=295' }),
      chrome(300, 'computer', { action: 'screenshot' }, { 1: site }),
    ]
    return [
      ['counts no Työmarkkinatori sign-in on its sign-in page', () => ends(signIn.slice(0, 1)) === 0],
      ['counts it 60 minutes from the first result back on the site', () => ends(signIn) === 300 + 3600],
      ['moves it on no acting call after that', () => ends([...signIn, chrome(900, 'javascript_tool', { action: 'javascript_exec' }, { 1: site })]) === 300 + 3600],
      ['holds it in a new tab on the site', () => ends([...signIn, chrome(900, 'navigate', { url: site }, { 2: site })]) === 300 + 3600],
      ['ends it once a tab is back on the sign-in page', () => ends([...signIn, chrome(900, 'navigate', { url: site }, { 1: 'https://tyomarkkinatori.fi/kirjaudu' })]) === 0],
      ['counts none on the site without a sign-in seen', () => ends([chrome(10, 'navigate', { url: site }, { 1: site })]) === 0],
      ['counts a bank from the last acting call on its tab', () => ends([
        chrome(10, 'navigate', { url: bank }, { 1: bank }),
        chrome(60, 'computer', { action: 'screenshot' }, { 1: bank }),
      ]) === 10 + 15 * 60],
      ['counts the suomi.fi portal at 30 minutes, not the identification\'s 32', () => ends([
        chrome(10, 'navigate', { url: 'https://www.suomi.fi/viestit' }, { 1: 'https://www.suomi.fi/viestit' }),
      ]) === 10 + 30 * 60],
    ]
  }],

  ['usage.sh --next', () => {
    const records = path.join(home, 'Library/Application Support/Claude/claude-code-sessions/account/org')
    const at = new Date(Date.now() - 10_000).toISOString()
    // A session that answered a prompt ten seconds ago, so its cache is warm, and the desktop app's record of it.
    const session = (id, record, stop = 'end_turn', after = []) => {
      jsonl(path.join(config, `projects/-next/${id}.jsonl`), [
        { ...human('go'), uuid: `${id}-u`, timestamp: at },
        { type: 'assistant', uuid: `${id}-a`, parentUuid: `${id}-u`, timestamp: at, message: { id: `msg_${id}`, model: 'claude-opus-5-5', stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } } },
        ...after,
      ])
      if (record) write(path.join(records, `local_${id}.json`), JSON.stringify({ cliSessionId: id, isArchived: false, title: `Session ${id}`, titleSource: 'tool', lastAssistantUuid: `${id}-a`, ...record }))
      return id
    }
    const rows = kind => spawnSync('bash', [USAGE_SH, '--next', 'self'], { env: ENV, encoding: 'utf8' }).stdout
      .split('\n').map(row => row.split('\t')).filter(row => row[2] === kind).map(row => row[1])
    const goesCold = id => rows('cold').some(title => title === `Session ${id}` || title === id)
    const wrapped = session('wrapped', { turnWrapUp: { description: 'Done.' } })
    const asking = session('asking', { turnWrapUp: { description: 'Done.', needsUser: 'Shall I push?' } })
    const summed = session('summed', { postTurnSummary: { status_category: 'completed' }, postTurnSummaryFor: 'summed-a' })
    const stale = session('stale', { postTurnSummary: { status_category: 'completed' }, postTurnSummaryFor: 'earlier-a' })
    const blocked = session('blocked', { postTurnSummary: { status_category: 'blocked' }, postTurnSummaryFor: 'blocked-a' })
    const terminal = session('terminal')
    const working = session('working', {}, 'tool_use')
    const prompted = session('prompted', {}, 'end_turn', [{ ...human('next'), uuid: 'prompted-u2', timestamp: at }])
    // The record keeps a wrap-up's question only when the wrap-up also stops for the answer.
    const reply = (id, n, stop, content = []) => ({ type: 'assistant', uuid: `${id}-a${n}`, parentUuid: `${id}-u`, timestamp: at, message: { id: `msg_${id}_${n}`, model: 'claude-opus-5-5', stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 }, content } })
    const wrapUp = (id, input) => [
      reply(id, 2, 'tool_use', [{ type: 'tool_use', id: `${id}-w`, name: 'mcp__ccd_turn__wrap_up', input }]),
      { ...toolResult('ok'), timestamp: at }, reply(id, 3, 'end_turn'),
    ]
    const wraps = (id, input, after = []) => session(id, { turnWrapUp: { description: 'Done.' } }, 'tool_use', [...wrapUp(id, input), ...after])
    const questioned = wraps('questioned', { recap: 'Done.', ask: 'Shall I push?' })
    const halted = wraps('halted', { recap: 'Done.', blocked: true })
    const recapped = wraps('recapped', { recap: 'Done.' })
    const answered = wraps('answered', { recap: 'Done.', ask: 'Shall I push?' }, [{ ...human('yes'), uuid: 'answered-u2', timestamp: at }, reply('answered', 4, 'end_turn')])
    // A started session's record names the session that started it.
    const startedBy = (id, starter, stop = 'tool_use', fork = {}) => session(id, { spawnedFrom: { sessionId: `local_${starter}`, sideSession: true, ...fork } }, stop)
    const waitsOnStarted = id => spawnSync('bash', [USAGE_SH, '--next', 'self'], { env: ENV, encoding: 'utf8' }).stdout
      .split('\n').map(row => row.split('\t')).some(row => row[2] === 'waits' && row[3]?.endsWith(`/local_${id}.json`))
    startedBy('helper', session('lead', {}))
    startedBy('forked', session('forker', {}), 'tool_use', { userFork: true })
    startedBy('aide', session('boss', {}, 'tool_use'))
    startedBy('low', startedBy('mid', session('top', {}), 'end_turn'))
    startedBy('orphan', session('gone', { isArchived: true }))
    startedBy('finished', session('idle', {}), 'end_turn')
    // The file usage-waiting.sh writes when a turn ends with background work in flight.
    const waits = (id, text, ageMs = 0) => {
      const at = (Date.now() - ageMs) / 1000
      fs.utimesSync(write(path.join(config, 'usage-waiting', id), text), at, at)
      return id
    }
    const running = waits(session('running', {}), '1\n')
    const left = waits(session('left', {}), '1\n', 120_000)
    const emptied = waits(session('emptied', {}), '')
    return [
      ['leaves out one waiting on background work', () => !goesCold(running)],
      ['names one whose waiting file is over a minute old', () => goesCold(left)],
      ['names one whose waiting file is empty', () => goesCold(emptied)],
      ['leaves out a session whose last wrap-up asks nothing', () => !goesCold(wrapped)],
      ['still marks that session\'s title', () => rows('title').includes(`Session ${wrapped}`)],
      ['names one whose wrap-up asks the user something', () => goesCold(asking)],
      ['names one whose wrap-up call asks something its record left out', () => goesCold(questioned)],
      ['names one whose wrap-up call stops for an answer', () => goesCold(halted)],
      ['leaves out one whose wrap-up call asks nothing', () => !goesCold(recapped)],
      ['leaves out one whose question a later prompt answered', () => !goesCold(answered)],
      ['marks one waiting while a session it started works', () => waitsOnStarted('lead')],
      ['leaves that one out of the next to go cold', () => !goesCold('lead')],
      ['leaves alone one whose fork the user made works', () => !waitsOnStarted('forker') && goesCold('forker')],
      ['leaves alone one whose own turn runs', () => !waitsOnStarted('boss')],
      ['marks each session up a chain of started ones', () => waitsOnStarted('mid') && waitsOnStarted('top')],
      ['leaves alone an archived starter', () => !waitsOnStarted('gone')],
      ['leaves alone one whose started session is done', () => !waitsOnStarted('idle') && goesCold('idle')],
      ['leaves out one whose summary of its last turn says completed', () => !goesCold(summed)],
      ['names one whose completed summary is of an earlier turn', () => goesCold(stale)],
      ['names one whose summary says it needs input', () => goesCold(blocked)],
      ['names a terminal session, which has no record', () => goesCold(terminal)],
      ['leaves out one whose turn waits on a tool call', () => !goesCold(working)],
      ['still marks that session\'s title', () => rows('title').includes(`Session ${working}`)],
      ['leaves out one whose new prompt has no answer yet', () => !goesCold(prompted)],
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
    // No call left pending, no line waiting for one, and the lock let go.
    const settled = () => fs.readdirSync(path.join(records, 'pending')).length === 0 && !fs.existsSync(path.join(records, 'lock'))
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
      // Two sessions at once: a test run of one is pending while the other edits a file the run watches.
      ['leaves out of a long call\'s line an edit another session recorded while it ran', () => {
        const tests = call('Bash', { command: 'node test/hooks/checks.mjs' }, 'toolu_o7', 'oh3')
        const edit = call('Edit', { file_path: readme }, 'toolu_o8', 'oh4')
        const steps = [run(tests('PreToolUse')), run(edit('PreToolUse'))]
        write(readme, '# Readme\n\nFixed.\n\nEdited.\n')
        steps.push(run(edit('PostToolUse')), run(tests('PostToolUse')))
        return steps.every(quiet) && paths('oh4') === 'README.md' && recorded('oh3').length === 0 && settled()
      }],
      ['keeps the part of such a line that its own call wrote', () => {
        const script = call('Bash', { command: 'bash fix.sh && node test/hooks/checks.mjs' }, 'toolu_o9', 'oh5')
        const edit = call('Edit', { file_path: readme }, 'toolu_o10', 'oh6')
        const start = fs.readFileSync(readme, 'utf8'), scripted = `${start}\nScripted.\n`, edited = `${scripted}\nEdited again.\n`
        const steps = [run(script('PreToolUse'))]
        write(readme, scripted)
        steps.push(run(edit('PreToolUse')))
        write(readme, edited)
        steps.push(run(edit('PostToolUse')), run(script('PostToolUse')))
        const own = recorded('oh5'), other = recorded('oh6')
        return steps.every(quiet) && own.length === 1 && blob(own[0][0]) === start && blob(own[0][1]) === scripted
          && other.length === 1 && blob(other[0][0]) === scripted && blob(other[0][1]) === edited && settled()
      }],
      ['records an Edit for both when the long call ends while the Edit is pending, for sync.sh --commit to refuse', () => {
        const tests = call('Bash', { command: 'node test/hooks/checks.mjs' }, 'toolu_o11', 'oh7')
        const edit = call('Edit', { file_path: readme }, 'toolu_o12', 'oh8')
        const steps = [run(tests('PreToolUse')), run(edit('PreToolUse'))]
        write(readme, `${fs.readFileSync(readme, 'utf8')}\nRaced.\n`)
        steps.push(run(tests('PostToolUse')), run(edit('PostToolUse')))
        return steps.every(quiet) && paths('oh7') === 'README.md' && paths('oh8') === 'README.md' && settled()
      }],
      ['records nothing for an Edit that failed while another session changed the file', () => {
        const ok = around(call('Edit', { file_path: readme }, 'toolu_o13', 'oh9'),
          () => write(readme, `${fs.readFileSync(readme, 'utf8')}\nChanged elsewhere.\n`), 'PostToolUseFailure')
        return ok && recorded('oh9').length === 0 && settled()
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
