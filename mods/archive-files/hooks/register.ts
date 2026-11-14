import type { EngineInterface, Register } from 'claude-code'

let indexes: string[] | undefined
const seenAt = new Map<string, number>()

// The desktop app rewrites its index of archived sessions on each archive.
const indexPaths = async ($: EngineInterface) => {
  if (indexes !== undefined) return indexes

  const dirs = async (path: string) =>
    (await $.fs.list(path).catch(() => [])).filter(e => e.kind === 'dir').map(e => `${path}/${e.name}`)
  try {
    const home = await $.env.get('HOME')
    const config = (await $.env.get('XDG_CONFIG_HOME')) ?? `${home}/.config`
    const roots = [`${home}/Library/Application Support`, config].map(dir => `${dir}/Claude/claude-code-sessions`)
    const orgs = home === undefined ? [] : (await Promise.all(roots.map(dirs))).flat()
    const accounts = (await Promise.all(orgs.map(dirs))).flat()
    indexes = accounts.map(dir => `${dir}/archived-sessions.idx`)
  } catch {
    indexes = []
  }

  return indexes
}

const changed = async ($: EngineInterface) => {
  let any = false
  for (const path of await indexPaths($)) {
    const at = await $.fs.stat(path).then(
      s => s.mtimeMs,
      () => 0,
    )
    if (at > (seenAt.get(path) ?? 0)) {
      seenAt.set(path, at)
      any = true
    }
  }

  return any
}

// Chrome tab groups an archive left wait for Chrome to be out of sight. The script
// stamps groups-checked at each try, so all sessions together try once a minute.
const groupsDue = async ($: EngineInterface) => {
  const home = await $.env.get('HOME')
  const dir = `${home}/Library/Application Support/claude-archive-files`
  const at = (name: string) =>
    $.fs.stat(`${dir}/${name}`).then(
      s => s.mtimeMs,
      () => undefined,
    )
  if (home === undefined || (await at('.')) === undefined) return false
  const [pending, swept, checked] = await Promise.all([at('groups-pending'), at('groups-swept'), at('groups-checked')])
  if (pending === undefined && swept !== undefined) return false

  return (checked ?? 0) < (await $.clock.now()) - 60_000
}

let busy = false

// Every session runs this; the script takes a lock and moves each archive once.
const sweep = async ($: EngineInterface) => {
  if (busy) return
  busy = true
  try {
    const args = (await changed($)) ? [] : (await groupsDue($)) ? ['--groups'] : undefined
    if (args === undefined) return
    await $.process.run([`${$.plugin.root}/archive-files.sh`, ...args], { timeoutMs: 180_000 }).catch(() => undefined)
  } finally {
    busy = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if ((await indexPaths($)).length > 0) {
      void sweep($)
      $.clock.every(5_000, () => void sweep($))
    }

    return started
  })
}
