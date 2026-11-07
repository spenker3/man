#!/usr/bin/env bun
/**
 * Screenshots for visual checks, through headless Chromium. Works on Linux, where
 * GPUIX's own screenshot() and test renderer are macOS/Windows only.
 *
 *   bun shoot.ts app <entry.tsx> --out gpuix.png [options]
 *       Bundles a GPUIX entry for the browser (same Rust renderer, as Wasm), serves it
 *       with the cross-origin isolation headers it needs, and screenshots it.
 *   bun shoot.ts url <url> --out source.png [options]
 *       Screenshots any page, e.g. the original web app, at the same size and theme.
 *
 * Options:
 *   --size 1280x800          viewport in CSS pixels (default 1280x800)
 *   --scale 1                device scale factor (default 1)
 *   --theme light|dark       prefers-color-scheme for the page (default: unset)
 *   --wait 1500              ms to wait after load and after each --do (default 1500)
 *   --do "<js>"              run in the page before the shot; repeatable, runs in order.
 *                            In a GPUIX page `gpuix` is the automation app, e.g.
 *                            --do "await gpuix.getByText('Forms').click()"
 *   --shot <path>            take an extra screenshot at this point in the --do sequence;
 *                            repeatable, interleave with --do to capture several states
 *   --proxy /api=http://127.0.0.1:4690
 *                            (app mode) forward a path prefix to a server, so the page
 *                            calls it same-origin; repeatable
 *   --entry-html <file>      (app mode) custom HTML page; default is a full-window canvas host
 *
 * The browser build cannot import Node-only modules (fs, child_process, bun:*). Keep those
 * out of the UI module, or pass the UI module itself as the entry with a browser-safe render().
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const mode = argv.shift()
const target = argv.shift()
const steps: { kind: 'do' | 'shot'; value: string }[] = []
const proxies: [string, string][] = []
const opts: Record<string, string> = {}
for (let i = 0; i < argv.length; i++) {
  const key = argv[i]
  const value = argv[++i]
  if (value === undefined) usage(`missing value for ${key}`)
  if (key === '--do') steps.push({ kind: 'do', value })
  else if (key === '--shot') steps.push({ kind: 'shot', value })
  else if (key === '--proxy') {
    const eq = value.indexOf('=')
    proxies.push([value.slice(0, eq), value.slice(eq + 1).replace(/\/$/, '')])
  } else opts[key.replace(/^--/, '')] = value
}
if ((mode !== 'app' && mode !== 'url') || !target || !opts.out) usage()

function usage(problem?: string): never {
  if (problem) console.error(`shoot: ${problem}`)
  console.error('usage: bun shoot.ts app <entry.tsx> --out file.png [options]\n       bun shoot.ts url <url> --out file.png [options]\nSee the header of shoot.ts for options.')
  process.exit(1)
}

const [width, height] = (opts.size ?? '1280x800').split('x').map(Number)
const scale = Number(opts.scale ?? 1)
const wait = Number(opts.wait ?? 1500)
const work = mkdtempSync(path.join(tmpdir(), 'man-shoot-'))
let server: ReturnType<typeof Bun.serve> | undefined
let browser: ReturnType<typeof Bun.spawn> | undefined

const cleanup = () => {
  server?.stop(true)
  browser?.kill()
  rmSync(work, { recursive: true, force: true })
}
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(130))

// ── Serve a GPUIX entry for the browser ──────────────────────────────────────

const DEFAULT_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%}</style>
</head><body><script type="module" src="/app.js"></script></body></html>`

let url = target
if (mode === 'app') {
  const entry = path.resolve(target)
  const out = path.join(work, 'dist')
  const build = await Bun.build({ entrypoints: [entry], outdir: out, target: 'browser', format: 'esm', naming: 'app.js', throw: false })
  if (!build.success) {
    for (const log of build.logs) console.error(String(log))
    console.error('\nshoot: the browser build failed. A Node-only import (fs, child_process, bun:*) in the UI is the usual cause.')
    process.exit(1)
  }
  const html = opts['entry-html'] ? readFileSync(opts['entry-html'], 'utf8') : DEFAULT_HTML
  const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  const types: Record<string, string> = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' }
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname, search } = new URL(req.url)
      const proxy = proxies.find(([prefix]) => pathname.startsWith(prefix))
      if (proxy) {
        // Forward without the browser's Origin, like a native app's own fetch.
        const headers = new Headers(req.headers)
        headers.delete('origin')
        headers.delete('referer')
        headers.set('host', new URL(proxy[1]).host)
        const res = await fetch(proxy[1] + pathname + search, { method: req.method, headers, body: req.body, redirect: 'manual' })
        const resHeaders = new Headers(res.headers)
        resHeaders.set('Cross-Origin-Resource-Policy', 'same-origin')
        return new Response(res.body, { status: res.status, headers: resHeaders })
      }
      if (pathname === '/') return new Response(html, { headers: { ...isolation, 'Content-Type': 'text/html' } })
      const file = path.join(out, pathname)
      if (!file.startsWith(out) || !existsSync(file)) return new Response('Not found', { status: 404, headers: isolation })
      return new Response(Bun.file(file), { headers: { ...isolation, 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' } })
    },
  })
  url = `http://127.0.0.1:${server.port}/`
}

// ── Drive Chromium over the DevTools protocol ───────────────────────────────

const chromium = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'].map((b) => Bun.which(b)).find(Boolean)
if (!chromium) usage('no Chromium or Chrome on PATH')
browser = Bun.spawn([chromium!, '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(work, 'profile')}`, '--no-first-run', '--hide-scrollbars', `--window-size=${width},${height}`, 'about:blank'], { stderr: 'pipe', stdout: 'ignore' })

async function devtoolsUrl(): Promise<string> {
  const reader = browser!.stderr!.getReader()
  let text = ''
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    text += new TextDecoder().decode(value)
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(text)
    if (m) { reader.releaseLock(); return m[1] }
  }
  throw new Error(`shoot: Chromium did not start:\n${text.slice(-1000)}`)
}

const browserWs = await devtoolsUrl()
const port = new URL(browserWs).port
const pages = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
const ws = new WebSocket(pages.find((p) => p.type === 'page')!.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

let nextId = 1
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const listeners: ((msg: any) => void)[] = []
const consoleErrors: string[] = []
ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data))
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)!
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  } else {
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text)
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a: any) => a.value ?? a.description).join(' '))
    listeners.forEach((l) => l(msg))
  }
}
function send(method: string, params: object = {}): Promise<any> {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
if (opts.theme) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: opts.theme }] })

const loaded = new Promise<void>((resolve) => listeners.push((m) => m.method === 'Page.loadEventFired' && resolve()))
await send('Page.navigate', { url })
await Promise.race([loaded, sleep(20_000)])
await sleep(wait)

if (mode === 'app') {
  // render() installs the automation app as globalThis.gpuix in the browser.
  const ready = await send('Runtime.evaluate', { expression: `new Promise(r => { const t = Date.now(); (function poll(){ if (globalThis.gpuix || Date.now() - t > 15000) r(!!globalThis.gpuix); else setTimeout(poll, 100) })() })`, awaitPromise: true, returnByValue: true })
  if (!ready.result.value) console.error('shoot: globalThis.gpuix never appeared; the app may have failed to render. Console errors follow if any.')
}

async function shot(file: string) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`shoot: wrote ${file}`)
}

for (const step of steps) {
  if (step.kind === 'shot') { await shot(step.value); continue }
  const result = await send('Runtime.evaluate', { expression: `(async () => { ${step.value} })()`, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    console.error(`shoot: --do failed: ${step.value}\n  ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    process.exitCode = 1
  } else if (result.result?.value !== undefined) console.log(`shoot: --do returned ${JSON.stringify(result.result.value)}`)
  await sleep(wait)
}
await shot(opts.out)
if (consoleErrors.length) console.error(`shoot: page errors:\n  ${[...new Set(consoleErrors)].slice(0, 10).join('\n  ')}`)
process.exit()
