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

// Every session runs this; the script takes a lock and moves each archive once.
const sweep = async ($: EngineInterface) => {
  if (!(await changed($))) return
  await $.process.run([`${$.plugin.root}/archive-files.sh`], { timeoutMs: 180_000 }).catch(() => undefined)
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
