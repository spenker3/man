#!/usr/bin/env bun
/**
 * Linux/Hyprland: capture your app's real GPU window from the agent workspace (the invisible
 * AGENT monitor), at an exact size, without touching the user's screen.
 *
 *   bun grab.ts --pid <pid> --out shot.png [--size 1280x800]
 *
 * --pid   the PID you launched (launch() returns it as app.pid in recent versions; otherwise
 *         use the child process you spawned). Windows of its descendants count too.
 * --size  floats the window and resizes it to WxH logical px first (default: leave as is).
 *
 * Refuses to act on a window that isn't on the `agent` workspace: run agent apps with
 * AGENT_WORKSPACE=1 in the agent's environment so they open there.
 */

import { readFileSync, readdirSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
const pid = Number(opt('--pid'))
const out = opt('--out')
const size = opt('--size')
if (!pid || !out) {
  console.error('usage: bun grab.ts --pid <pid> --out shot.png [--size 1280x800]')
  process.exit(1)
}

const sh = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const [text, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()]
  if ((await p.exited) !== 0) throw new Error(`${cmd.join(' ')}: ${err || text}`)
  return text
}
const dispatch = (lua: string) => sh(['hyprctl', 'dispatch', lua])

// The process tree under --pid: GPUIX's launch() runs the app as a child of your script.
function descendants(root: number): Set<number> {
  const children = new Map<number, number[]>()
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue
    try {
      const ppid = Number(readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ')[1])
      children.set(ppid, [...(children.get(ppid) ?? []), Number(d)])
    } catch {}
  }
  const all = new Set([root])
  const queue = [root]
  while (queue.length) for (const c of children.get(queue.pop()!) ?? []) if (!all.has(c)) { all.add(c); queue.push(c) }
  return all
}

type Client = { address: string; pid: number; at: [number, number]; size: [number, number]; floating: boolean; workspace: { name: string }; title: string }
async function findWindow(): Promise<Client> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const pids = descendants(pid)
    const mine = (JSON.parse(await sh(['hyprctl', 'clients', '-j'])) as Client[]).filter((c) => pids.has(c.pid))
    if (mine.length) return mine[mine.length - 1]
    await Bun.sleep(250)
  }
  throw new Error(`grab: no window for pid ${pid} or its children within 15 s`)
}

let c = await findWindow()
if (c.workspace.name !== 'agent') {
  console.error(`grab: "${c.title}" is on workspace ${c.workspace.name}, not "agent". Not touching it; launch with AGENT_WORKSPACE=1.`)
  process.exit(1)
}
const win = `window = "address:${c.address}"`
if (size) {
  const [w, h] = size.split('x').map(Number)
  const agent = (JSON.parse(await sh(['hyprctl', 'monitors', '-j'])) as { name: string; x: number; y: number }[]).find((m) => m.name === 'AGENT')
  if (!c.floating) await dispatch(`hl.dsp.window.float({ action = "on", ${win} })`)
  await dispatch(`hl.dsp.window.resize({ x = ${w}, y = ${h}, ${win} })`)
  if (agent) await dispatch(`hl.dsp.window.move({ x = ${agent.x + 20}, y = ${agent.y + 20}, ${win} })`)
  await Bun.sleep(400) // let the app repaint at the new size
  c = (JSON.parse(await sh(['hyprctl', 'clients', '-j'])) as Client[]).find((x) => x.address === c.address)!
}
// Floating windows from several agents can overlap; raise ours before capturing.
await dispatch(`hl.dsp.window.alter_zorder({ mode = "top", ${win} })`)
await sh(['grim', '-g', `${c.at[0]},${c.at[1]} ${c.size[0]}x${c.size[1]}`, out])
console.log(`grab: wrote ${out} (${c.size[0]}x${c.size[1]})`)
