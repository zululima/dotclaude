import type { EngineInterface, Register, Timer } from 'claude-code'

type Usage = { figures: string; coldAt: number; offset: number; mark: string; signedInUntil: number }
type Other = { endsAt: number; title: string; isSignIn: boolean }

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FIRE = '\u{1F525}'
const ALARM = '⏰'
const ICE = '\u{1F9CA}'
const HOURGLASS = '\u23F3'
const COOKIE = '\u{1F36A}'
const LOCK = '\u{1F512}\uFE0F'
// The desktop app cuts the status line at about this many characters.
const WIDTH = 40

// An emoji takes two columns, the hourglass too, though it is one UTF-16 unit,
// and the variation selector after the lock counts as the unit it is.
const width = (text: string) =>
  [...text].reduce((n, c) => n + (c === '\uFE0F' ? 1 : (c.codePointAt(0) ?? 0) >= 0x2300 ? 2 : 1), 0)

const minutes = (left: number) => (left >= 60_000 ? String(Math.floor(left / 60_000)) : '<1')

let usage: Usage | undefined
let others: Other[] = []
let othersReadAt = -Infinity
let beacon: string | undefined
let archives: string[] | undefined
const heardAt = new Map<string, number>()
let shown: string | undefined
let isBusy = false
let flip: Timer | undefined

const pad = (n: number) => String(n).padStart(2, '0')

// The offset is the one usage.sh read from the host's clock, so the UTC
// getters give local time whatever zone this environment runs in. A sign-in in
// the session's Chrome tabs takes the cache's place when it ends first.
const cache = (now: number, { coldAt, offset, mark, signedInUntil }: Usage) => {
  const left = coldAt - now
  const signedIn = signedInUntil - now
  if (signedIn > 0 && (signedIn < left || left <= 0)) return `${COOKIE} ${minutes(signedIn)} min`

  const after = mark ? ` ${mark}` : ''
  if (left >= 60_000) return `${FIRE} ${Math.floor(left / 60_000)} min${after}`
  if (left > 0) return `${ALARM} <1 min${after}`

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

// The other session whose cache goes cold or whose Chrome sign-in ends next,
// its title cut at a word to fit.
const next = (now: number, room: number) => {
  const other = others.find(o => o.endsAt > now)
  if (!other) return ''

  const left = other.endsAt - now
  const head = `${other.isSignIn ? LOCK : HOURGLASS} ${minutes(left)} min `
  const title = fit(other.title, room - width(head))

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

const readOthers = async ($: EngineInterface) => {
  const id = await $.session.id()
  const { exitCode, stdout } = await $.process.run([`${$.plugin.root}/usage.sh`, '--next', id])
  others =
    exitCode === 0
      ? stdout
          .split('\n')
          .filter(Boolean)
          .map(row => {
            const [endsAt = '', title = '', kind = ''] = row.split('\t')
            return { endsAt: Number(endsAt) * 1000, title, isSignIn: kind === 'sign-in' }
          })
      : []
  othersReadAt = await $.clock.now()
}

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

  flip = $.clock.after(at - now, () => void redraw($).then(() => schedule($)))
}

const show = async ($: EngineInterface) => {
  const id = await $.session.id()
  const { exitCode, stdout } = await $.process.run([`${$.plugin.root}/usage.sh`, '--status', id])
  const [figures, coldAt, offset, mark = '', signedInUntil = '0'] = stdout.trim().split('\n')
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
// The other sessions are read once a minute too, for what neither file shows.
const tick = async ($: EngineInterface) => {
  if ((await $.clock.now()) - othersReadAt >= 60_000) await readOthers($)
  if (isBusy) return show($)
  await redraw($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await hasNews($)
    await readOthers($)
    await show($)
    $.clock.every(15_000, () => void tick($))
    if ((await watched($)).length > 0) $.clock.every(5_000, () => void listen($))

    return started
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isBusy = true
      await signal($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) {
      isBusy = false
      await show($)
    }

    return completed
  })
}
