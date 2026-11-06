import type { EngineInterface, Register, Timer } from 'claude-code'

type Usage = { figures: string; coldAt: number; offset: number; mark: string; signedInUntil: number }
type Other = { endsAt: number; title: string; isSignIn: boolean; record: string; isUntitled: boolean }
type Titled = { coldAt: number; title: string; record: string; source: string; isOwn: boolean; retryAt: number }
type Known = { at: number; pr: string; titles: string[]; written: string[] }
type SessionRecord = { isArchived?: boolean; title?: string; titleSource?: string }

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FIRE = '\u{1F525}'
const ALARM = '⏰'
const ICE = '\u{1F9CA}'
const HOURGLASS = '\u23F3'
const COOKIE = '\u{1F36A}'
const BRAIN = '\u{1F9E0}'
const LOCK = '\u{1F512}\uFE0F'
// The desktop app cuts the status line at about this many characters.
const WIDTH = 40
const MARK = new RegExp(`^(${FIRE}|${ICE}) `, 'u')
const RETRY = 600_000
const MOST_WORDS = 8
// A sidebar row with a pull request badge, indented under another session,
// fades out text past about this many characters.
const MOST_TITLE = 16

// An emoji takes two columns, the hourglass too, though it is one UTF-16 unit,
// and the variation selector after the lock counts as the unit it is.
const width = (text: string) =>
  [...text].reduce((n, c) => n + (c === '\uFE0F' ? 1 : (c.codePointAt(0) ?? 0) >= 0x2300 ? 2 : 1), 0)

const minutes = (left: number) => (left >= 60_000 ? String(Math.floor(left / 60_000)) : '<1')

let usage: Usage | undefined
let compactsAt: number | undefined
let others: Other[] = []
let othersReadAt = -Infinity
let beacon: string | undefined
let archives: string[] | undefined
const heardAt = new Map<string, number>()
let shown: string | undefined
let isBusy = false
let flip: Timer | undefined
const titled = new Map<string, Titled>()
let titling = Promise.resolve()
const known = new Map<string, Known>()
let ownRecord = ''
let indexReads = 0
let found: { key: string; text: string } | undefined

const pad = (n: number) => String(n).padStart(2, '0')
const bare = (title: string) => title.replace(MARK, '')

// The offset is the one usage.sh read from the host's clock, so the UTC
// getters give local time whatever zone this environment runs in. A sign-in in
// the session's Chrome tabs takes the cache's place when it ends first.
const cache = (now: number, { coldAt, offset, mark, signedInUntil }: Usage) => {
  const left = coldAt - now
  const signedIn = signedInUntil - now
  if (signedIn > 0 && (signedIn < left || left <= 0)) return `${COOKIE} ${minutes(signedIn)}m`

  const after = mark ? ` ${mark}` : ''
  if (left >= 60_000) return `${FIRE} ${Math.floor(left / 60_000)}m${after}`
  if (left > 0) return `${ALARM} <1m${after}`

  const cold = new Date(coldAt + offset)
  const isToday = Math.floor((coldAt + offset) / DAY) === Math.floor((now + offset) / DAY)

  return isToday
    ? `${ICE} since ${pad(cold.getUTCHours())}:${pad(cold.getUTCMinutes())}`
    : `${ICE} since ${cold.getUTCDate()} ${MONTHS[cold.getUTCMonth()]}`
}

const fit = (title: string, room: number) => {
  if (title.length <= room) return title
  const space = title.lastIndexOf(' ', room)

  return title.slice(0, space > 0 ? space : room).replace(/[\s,:;+-]+$/, '')
}

// Cmd+K splits what is typed at anything but a letter or a digit and lists a
// session when each word is part of its title, is its pull request number or
// is "pr" beside that number, or when each is part of one earlier title. A
// title that starts with what is typed comes first, which a marked one never
// does, then the most recently active. It leaves out the session it opens in.
const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

const place = (typed: string[], { pr, titles: [title = '', ...earlier] }: Known) =>
  typed.every(w => title.includes(w) || w === pr || (w === 'pr' && typed.includes(pr))) ||
  earlier.some(t => typed.every(w => t.includes(w)))
    ? Number(!title.trim().startsWith(typed.join(' ')))
    : undefined

// 2 when Cmd+K lists the session alone, 1 when first, 0 when after another.
const standing = (typed: string[], record: string) => {
  const target = known.get(record)
  const own = target && place(typed, target)
  if (target === undefined || own === undefined) return 0

  let rank = 2
  for (const [r, k] of known) {
    const p = r === record || r === ownRecord ? undefined : place(typed, k)
    if (p === undefined) continue
    if (p < own || (p === own && k.at >= target.at)) return 0
    rank = 1
  }

  return rank
}

// Cmd+K lists only this session for its title while no other session's title
// or earlier title holds every word of it, and while it holds every word of no
// other session's title, which would list this one for that title too.
const clash = (title: string, record: string) => {
  const typed = words(title)
  const renamed: Known = { at: 0, pr: known.get(record)?.pr ?? '', titles: [title.toLowerCase()], written: [title] }
  for (const [r, k] of known) {
    if (r === record) continue
    if (typed.length > 0 && place(typed, k) !== undefined) {
      const i = Math.max(0, k.titles.findIndex(t => typed.every(w => t.includes(w))))
      const was = i === 0 ? 'is titled' : 'was titled'
      return `Another session ${was} "${bare(k.written[i] ?? '')}", which holds every word of this title, so Cmd+K would list both for it. Pick a word it lacks.`
    }
    const theirs = words(k.titles[0] ?? '')
    if (theirs.length > 0 && place(theirs, renamed) !== undefined)
      return `This title holds every word of another session's title, "${bare(k.written[0] ?? '')}", so Cmd+K would list both for that one. Pick other words.`
  }
}

const isAbove = (a: number[], b: number[]) => {
  const i = a.findIndex((n, j) => n !== b[j])
  return i >= 0 && (a[i] ?? 0) > (b[i] ?? 0)
}

// The title's first word, which a reader knows the session by, and those later
// words that fit and have Cmd+K list it soonest: alone, or else first. Then
// the most letters. The title cut to fit stands for the same words, and is the
// one name left when the first word alone is too long.
const findable = (other: Other, room: number) => {
  const cut = fit(other.title, room)
  if (!cut || other.isUntitled || !known.has(other.record)) return cut
  const key = [other.record, other.title, room, ownRecord, indexReads].join('\t')
  if (found?.key === key) return found.text

  const own = [...new Map(other.title.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(w => [w.toLowerCase(), w])).values()]
  const [first = '', ...later] = own.slice(0, MOST_WORDS)
  let text = cut
  let best: number[] | undefined
  for (let n = 0; n < 2 ** later.length; n++) {
    const picked = [first, ...later.filter((_, i) => n & (1 << i))]
    const label = picked.join(' ')
    if (width(label) > room) continue
    const score = [standing(words(label), other.record), picked.join('').length]
    if (!best || isAbove(score, best)) [text, best] = [label, score]
  }
  if (words(text).join(' ') === words(cut).join(' ')) text = cut

  found = { key, text }
  return text
}

// The other session whose cache goes cold or whose Chrome sign-in ends next,
// named so Cmd+K lists it first.
const next = (now: number, room: number) => {
  const other = others.find(o => o.endsAt > now)
  if (!other) return ''

  const left = other.endsAt - now
  const head = `${other.isSignIn ? LOCK : HOURGLASS} ${minutes(left)}m `
  const title = findable(other, room - width(head))

  return title ? head + title : ''
}

// Until the session's first answer usage.sh has no figures for it, so the
// other session shows alone.
const line = async ($: EngineInterface) => {
  const now = await $.clock.now()
  if (!usage) return next(now, WIDTH) || undefined

  const own = `${cache(now, usage)}, ${usage.figures}`
  const other = next(now, WIDTH - width(own) - 2)

  return other ? `${own}, ${other}` : own
}

// The first read takes every desktop session, archived ones too, and each one
// after it those changed since.
const index = async ($: EngineInterface) => {
  const read = await rows($, known.size > 0 ? ['--index', '65'] : ['--index'])
  for (const [record = '', at = '0', pr = '', ...titles] of read)
    if (record) known.set(record, { at: Number(at), pr, titles: titles.map(t => t.toLowerCase()), written: titles })
  indexReads++
}

const readOthers = async ($: EngineInterface) => {
  await index($)
  const read = await rows($, ['--next', await $.session.id()])
  const isTitle = ([, , kind = '']: string[]) => kind === 'title' || kind === 'own'
  others = read
    .filter(row => !isTitle(row))
    .map(([endsAt = '', title = '', kind = '', record = '', untitled = '']) => ({
      endsAt: Number(endsAt) * 1000,
      title: bare(title),
      isSignIn: kind === 'sign-in',
      record,
      isUntitled: untitled === 'untitled',
    }))
  read.filter(isTitle).forEach(keep)
  othersReadAt = await $.clock.now()
}

const rows = async ($: EngineInterface, args: string[]) => {
  const { exitCode, stdout } = await $.process.run([`${$.plugin.root}/usage.sh`, ...args])
  return exitCode === 0
    ? stdout
        .split('\n')
        .filter(Boolean)
        .map(row => row.split('\t'))
    : []
}

const keep = ([coldAt = '0', title = '', kind = '', record = '', source = '']: string[]) => {
  if (!record) return
  if (kind === 'own') ownRecord = record
  const retryAt = titled.get(record)?.retryAt ?? 0
  titled.set(record, { coldAt: Number(coldAt) * 1000, title, record, source, isOwn: kind === 'own', retryAt })
}

// The sessions quiet for over an hour are cold for certain and change only
// when one wakes up, which --next then reads, so they are read once.
const sweep = async ($: EngineInterface) => (await rows($, ['--titles', await $.session.id()])).forEach(keep)

// A title set by hand stays as it is, since the app would ask before each
// change. One the app declines waits ten minutes.
const rename = async ($: EngineInterface, t: Titled, mark: string, now: number) => {
  const record = await $.fs
    .read(t.record)
    .then(text => JSON.parse(text) as SessionRecord)
    .catch(() => undefined)
  if (!record?.title || record.isArchived) return void titled.delete(t.record)

  t.title = record.title
  t.source = record.titleSource ?? 'none'
  const title = `${mark} ${bare(record.title)}`
  if (t.source === 'user' || record.title === title) return

  const sessionId = t.record.slice(t.record.lastIndexOf('/') + 1).replace(/\.json$/, '')
  const isDone = await $.mcp
    .call('ccd_session_mgmt', 'set_session_title', { session_id: sessionId, title })
    .then(
      result => !result.isError,
      () => false,
    )
  if (isDone) t.title = title
  else t.retryAt = now + RETRY
}

// Each desktop session's title starts with a fire while its cache is warm and
// an ice cube once it is cold. This session's own is warm while a turn runs.
// One pass at a time, so two never rename the same session.
const retitle = ($: EngineInterface) =>
  (titling = titling.then(async () => {
    const now = await $.clock.now()
    for (const t of titled.values()) {
      const isWarm = t.isOwn ? isBusy || (usage?.coldAt ?? 0) > now : t.coldAt > now
      const mark = isWarm ? FIRE : ICE
      if (t.source !== 'user' && !t.title.startsWith(`${mark} `) && t.retryAt <= now) await rename($, t, mark, now)
    }
  }).catch(() => undefined))

// Every session's main turn rewrites the beacon, beside the usage log, so the
// others read again within seconds, not at their next minute.
const beaconPath = async ($: EngineInterface) => {
  if (beacon !== undefined) return beacon

  try {
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (await $.env.get('HOME'))?.concat('/.claude')
    beacon = dir === undefined ? '' : `${dir}/usage-beacon`
  } catch {
    beacon = ''
  }

  return beacon
}

// The desktop app rewrites its index of archived sessions on each archive, just
// after the session's own record, so one archived drops out as fast.
const archivePaths = async ($: EngineInterface) => {
  if (archives !== undefined) return archives

  const dirs = async (path: string) =>
    (await $.fs.list(path).catch(() => [])).filter(e => e.kind === 'dir').map(e => `${path}/${e.name}`)
  try {
    const home = await $.env.get('HOME')
    const root = `${home}/Library/Application Support/Claude/claude-code-sessions`
    const accounts = home === undefined ? [] : (await Promise.all((await dirs(root)).map(dirs))).flat()
    archives = accounts.map(dir => `${dir}/archived-sessions.idx`)
  } catch {
    archives = []
  }

  return archives
}

const watched = async ($: EngineInterface) => [await beaconPath($), ...(await archivePaths($))].filter(Boolean)

const isNew = async ($: EngineInterface, path: string) => {
  const at = await $.fs.stat(path).then(
    s => s.mtimeMs,
    () => 0,
  )
  if (at <= (heardAt.get(path) ?? 0)) return false

  heardAt.set(path, at)
  return true
}

const hasNews = async ($: EngineInterface) =>
  (await Promise.all((await watched($)).map(path => isNew($, path)))).includes(true)

const signal = async ($: EngineInterface) => {
  const path = await beaconPath($)
  if (!path) return

  await $.fs.write(path, `${await $.session.id()}\n`).catch(() => undefined)
  await isNew($, path)
}

const listen = async ($: EngineInterface) => {
  if (!(await hasNews($))) return
  await readOthers($)
  await redraw($)
  await retitle($)
}

const redraw = async ($: EngineInterface) => {
  const text = await line($)
  if (text === shown) return

  shown = text
  $.ui.status(text)
}

// The alarm clock, the ice and the end of a sign-in show the moment they apply,
// not at the next tick, so the line never says a prompt still makes it when it
// would not.
const schedule = async ($: EngineInterface) => {
  flip?.cancel()
  flip = undefined
  if (!usage) return
  const now = await $.clock.now()
  const { coldAt, signedInUntil } = usage
  const at = Math.min(...[coldAt - 60_000 + 1, coldAt, signedInUntil - 60_000 + 1, signedInUntil].filter(t => t > now))
  if (at === Infinity) return

  flip = $.clock.after(
    at - now,
    () =>
      void redraw($)
        .then(() => retitle($))
        .then(() => schedule($)),
  )
}

// The session compacts at its compaction window, which can be smaller than the
// model's, and only a breakdown reports it. A summary one is counted locally,
// so it is read once a turn.
const measure = async ($: EngineInterface) => {
  compactsAt = await $.session
    .usage({ breakdown: 'summary' })
    .then(u => u.context.breakdown?.rawMaxTokens)
    .catch(() => undefined)
}

// The transcript's figure stands until the session reports its own.
const show = async ($: EngineInterface) => {
  const id = await $.session.id()
  const { exitCode, stdout } = await $.process.run([`${$.plugin.root}/usage.sh`, '--status', id])
  const { context } = await $.session.usage().catch(() => ({ context: undefined }))
  const [read, coldAt, offset, mark = '', signedInUntil = '0'] = stdout.trim().split('\n')
  const window = compactsAt ?? context?.window
  const tokens = context?.tokens
  const figures = read && tokens !== undefined && window ? `${BRAIN} ${Math.round((tokens * 100) / window)}%` : read
  usage =
    exitCode === 0 && figures && coldAt && offset
      ? {
          figures,
          coldAt: Number(coldAt) * 1000,
          offset: Number(offset) * 1000,
          mark,
          signedInUntil: Number(signedInUntil) * 1000,
        }
      : undefined

  shown = await line($)
  $.ui.status(shown)
  await schedule($)
}

// A running turn keeps refreshing the cache, so the transcript is read again.
// The other sessions are read once a minute too, for what neither file shows,
// and on each tick while one waits for the app to title it.
const tick = async ($: EngineInterface) => {
  if (others.some(o => o.isUntitled) || (await $.clock.now()) - othersReadAt >= 60_000) await readOthers($)
  await (isBusy ? show($) : redraw($))
  await retitle($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await hasNews($)
    await readOthers($)
    await measure($)
    await show($)
    await sweep($)
    void retitle($)
    $.clock.every(15_000, () => void tick($))
    if ((await watched($)).length > 0) $.clock.every(5_000, () => void listen($))

    return started
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isBusy = true
      await signal($)
      void retitle($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) {
      isBusy = false
      await measure($)
      await show($)
      void retitle($)
    }

    return completed
  })

  // A rename Claude makes keeps the mark. A session renames itself in a turn,
  // while its cache is warm.
  on('tool.call', { tool: 'mcp__ccd_session_mgmt__set_session_title' }, async ($, e, next) => {
    const length = [...bare(e.title)].length
    if (length > MOST_TITLE)
      return { deny: `The title is ${length} characters. Keep it within ${MOST_TITLE}, the emoji not counted.` }

    const isSelf = e.session_id === 'self'
    const record = isSelf ? ownRecord : ([...known.keys()].find(r => r.endsWith(`/${e.session_id}.json`)) ?? '')
    const clashes = isSelf && !ownRecord ? undefined : clash(bare(e.title), record)
    if (clashes) return { deny: clashes }

    const t = [...titled.values()].find(t => (isSelf ? t.isOwn : t.record.endsWith(`/${e.session_id}.json`)))
    if (!isSelf && !t) return next(e)

    const isWarm = isSelf || (t?.coldAt ?? 0) > (await $.clock.now())
    const title = `${isWarm ? FIRE : ICE} ${bare(e.title)}`
    const renamed = await next({ ...e, title })
    if (t && renamed.deny === undefined && renamed.isError !== true) t.title = title

    return renamed
  })
}
