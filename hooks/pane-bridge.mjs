#!/usr/bin/env node

// Carries local files into a site open in the Claude Code app's built-in
// browser pane, which has no file upload tool and blocks other sites from
// calling localhost, and writes to disk what a page drawn in the pane posts.
// Start it with preview_start from this entry in .claude/launch.json, with the
// home directory spelled out, since nothing expands ~ there:
//
//   { "name": "pane-bridge", "runtimeExecutable": "node", "port": 8765,
//     "runtimeArgs": ["<home>/.claude/hooks/pane-bridge.mjs",
//       "--dir", "<folder>", "--back", "<site address>"] }
//
// The tab preview_start opens goes on to the site with the folder's files in
// the address's fragment, which never reaches the site's server, and
// /?back=<address> does the same from another tab. --back names the address
// the site ends on, since a script that moves the tab on may drop the
// fragment. Chromium takes no address over 2 MB, so the files go in parts of
// 1.5 MB. Then run what `pane-bridge.mjs site` prints with javascript_tool in
// that tab. It moves the part into the IndexedDB of the site's origin, clears
// the fragment and, while a part is missing, returns the address that brings
// it: navigate there and run it again, or the shorter script `part` prints.
// Any page of the origin takes a part, such as its robots.txt, so the run
// that builds the files can wait for the page with the upload button. That
// run wraps HTMLInputElement.prototype.click, so the site's own upload button
// takes the files queued with __paneBridge.offer(<name>...) through a
// DataTransfer instead of opening the file picker. Click that button, then
// await __paneBridge.taken(), which returns an error rather than guess when no
// file input took them, such as on a site that only takes a drop.
//
// The other way round, a page under /f/ draws on a canvas and posts the blob
// to /save?name=<file>, which writes it into the folder. Without --back, /
// lists the folder. --port goes with a port other than 8765.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const take = String.raw`
  const ask = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const opening = indexedDB.open('pane-bridge', 1)
  opening.onupgradeneeded = () => opening.result.createObjectStore('parts')
  const db = await ask(opening)
  const kept = () => ask(db.transaction('parts').objectStore('parts').getAll())
  const key = '#pane-bridge='
  if (location.hash.startsWith(key)) {
    const part = JSON.parse(decodeURIComponent(location.hash.slice(key.length)))
    history.replaceState(history.state, '', location.pathname + location.search)
    part.pieces = part.pieces.map(({ b64, ...piece }) => ({
      ...piece, blob: new Blob([Uint8Array.fromBase64(b64, { alphabet: 'base64url' })]),
    }))
    const stale = (await kept()).some((p) => p.id !== part.id)
    const store = db.transaction('parts', 'readwrite').objectStore('parts')
    if (stale) store.clear()
    await ask(store.put(part, part.part))
  }
  const parts = await kept()
  db.close()
  if (!parts.length) {
    return { error: 'no files here: open the bridge page in this tab first' }
  }
  const missing = []
  for (let n = 1; n <= parts[0].parts; n++) {
    if (!parts.some((p) => p.part === n)) missing.push(n)
  }
  if (missing.length) {
    return { parts: parts[0].parts, missing, next: parts[0].bridge + '&part=' + missing[0] }
  }`

const site = String.raw`await (async () => {${take}
  indexedDB.deleteDatabase('pane-bridge')
  const byName = new Map()
  for (const piece of parts.flatMap((p) => p.pieces)) {
    byName.set(piece.name, [...(byName.get(piece.name) || []), piece])
  }
  const files = [...byName.values()].map((pieces) => {
    const { name, type, size } = pieces[0]
    pieces.sort((a, b) => a.at - b.at)
    const file = new File(pieces.map((p) => p.blob), name, { type })
    if (file.size !== size) throw new Error(name + ' arrived with ' + file.size + ' of ' + size)
    return file
  })
  const bridge = (window.__paneBridge = { files, queue: [] })
  bridge.offer = (...names) => {
    bridge.queue = names.map((name) => {
      const file = bridge.files.find((f) => f.name === name)
      if (!file) throw new Error('no file named ' + name)
      return file
    })
    return names
  }
  bridge.taken = async (ms = 3000) => {
    for (const end = Date.now() + ms; bridge.queue.length && Date.now() < end; ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!bridge.queue.length) return { taken: true }
    const left = bridge.queue.map((f) => f.name)
    bridge.queue = []
    return { error: 'no file input took these', left }
  }
  if (!window.__paneBridgeWrapped) {
    const wrap = (original) => function (...args) {
      const queue = window.__paneBridge?.queue
      if (this.type !== 'file' || !queue?.length) return original?.apply(this, args)
      const picked = new DataTransfer()
      for (const file of queue.splice(0, this.multiple ? queue.length : 1)) picked.items.add(file)
      this.files = picked.files
      this.dispatchEvent(new Event('input', { bubbles: true }))
      this.dispatchEvent(new Event('change', { bubbles: true }))
    }
    HTMLInputElement.prototype.click = wrap(HTMLInputElement.prototype.click)
    HTMLInputElement.prototype.showPicker = wrap(HTMLInputElement.prototype.showPicker)
    window.__paneBridgeWrapped = true
  }
  return bridge.files.map((f) => f.name + ' ' + f.size)
})()`

const part = String.raw`await (async () => {${take}
  return { parts: parts[0].parts, missing }
})()`

if (['site', 'part'].includes(process.argv[2])) {
  console.log(process.argv[2] === 'site' ? site : part)
  process.exit(0)
}

const option = (flag) => {
  const at = process.argv.indexOf(flag)
  return at > 1 ? process.argv[at + 1] : undefined
}
const given = option('--dir')
if (!given) {
  console.error('usage: pane-bridge.mjs --dir <folder> [--back <address>] [--port <n>] | site | part')
  process.exit(64)
}
const dir = path.resolve(given.replace(/^~(?=\/|$)/, os.homedir()))
const port = Number(option('--port') || 8765)
const own = ['localhost', '127.0.0.1', '[::1]'].map((host) => `http://${host}:${port}`)
const partBytes = 1_500_000
const longestAddress = 2 * 1024 * 1024

const types = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm',
  mov: 'video/quicktime', html: 'text/html', txt: 'text/plain', json: 'application/json',
}
const typeOf = (name) =>
  types[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream'
const plain = (name) => Boolean(name) && name === path.basename(name) && !name.startsWith('.')
const names = () => fs.readdirSync(dir)
  .filter((name) => plain(name) && fs.statSync(path.join(dir, name)).isFile()).sort()
const inScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c')
const html = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

function page(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(`<!doctype html><meta charset="utf-8"><title>pane-bridge</title>${body}`)
}

function layout() {
  const files = names().map((name) => {
    const { size, mtimeMs } = fs.statSync(path.join(dir, name))
    return { name, size, mtimeMs }
  })
  const id = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12)
  const parts = [[]]
  let room = partBytes
  for (const { name, size } of files) {
    let at = 0
    do {
      if (!room) {
        parts.push([])
        room = partBytes
      }
      const length = Math.min(size - at, room)
      parts.at(-1).push({ name, type: typeOf(name), size, at, length })
      at += length
      room -= length
    } while (at < size)
  }
  return { id, parts }
}

function slice(name, at, length) {
  const bytes = Buffer.alloc(length)
  const fd = fs.openSync(path.join(dir, name), 'r')
  try {
    fs.readSync(fd, bytes, 0, length, at)
  } finally {
    fs.closeSync(fd)
  }
  return bytes.toString('base64url')
}

function handoff(res, to, which) {
  let target
  try {
    target = new URL(to)
  } catch {
    return page(res, 400, `<p>Not an address: ${html(to)}</p>`)
  }
  if (!/^https?:$/.test(target.protocol)) return page(res, 400, '<p>Only http and https.</p>')
  target.hash = ''
  const { id, parts } = layout()
  const number = Number(which || 1)
  if (!Number.isInteger(number) || number < 1 || number > parts.length) {
    return page(res, 400, `<p>No part ${html(String(which))} of ${parts.length}.</p>`)
  }
  const pieces = parts[number - 1].map(({ length, ...piece }) =>
    ({ ...piece, b64: slice(piece.name, piece.at, length) }))
  const bridge = `http://localhost:${port}/?back=${encodeURIComponent(target.href)}`
  const carried = { id, part: number, parts: parts.length, bridge, pieces }
  const address = `${target.href}#pane-bridge=${encodeURIComponent(JSON.stringify(carried))}`
  if (address.length > longestAddress) {
    return page(res, 400, `<p>The site address is too long to carry a part.</p>`)
  }
  page(res, 200, `<p>Handing part ${number} of ${parts.length} to ${html(target.href)}</p><script>
location.replace(${inScript(address)})
</script>`)
}

function save(req, res, name) {
  if (req.headers.origin && !own.includes(req.headers.origin)) {
    res.writeHead(403)
    return res.end('only a page on this server may save')
  }
  if (!plain(name)) {
    res.writeHead(400)
    return res.end('name must be a plain file name')
  }
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, Buffer.concat(chunks))
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(`saved ${file}`)
  })
}

function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`)
  if (req.method === 'POST' && url.pathname === '/save') {
    return save(req, res, url.searchParams.get('name'))
  }
  if (req.method !== 'GET') {
    res.writeHead(405)
    return res.end()
  }
  if (url.pathname === '/') {
    const to = url.searchParams.get('back') || option('--back')
    if (to) return handoff(res, to, url.searchParams.get('part'))
    const list = names().map((n) => `<li><a href="/f/${encodeURIComponent(n)}">${html(n)}</a></li>`)
    return page(res, 200, `<p>${html(dir)}</p><ul>${list.join('')}</ul>`)
  }
  let name = ''
  try {
    if (url.pathname.startsWith('/f/')) name = decodeURIComponent(url.pathname.slice(3))
  } catch {}
  if (plain(name) && names().includes(name)) {
    const type = typeOf(name) + (typeOf(name).startsWith('text/') ? '; charset=utf-8' : '')
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
    return fs.createReadStream(path.join(dir, name)).pipe(res)
  }
  res.writeHead(404)
  res.end('not found')
}

if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`pane-bridge: no such folder: ${dir}`)
  process.exit(1)
}
for (const host of ['127.0.0.1', '::1']) {
  http.createServer(handle)
    .on('error', (error) => {
      if (host === '127.0.0.1') throw error
    })
    .listen(port, host)
}
console.log(`pane-bridge serving ${dir} on port ${port}`)
