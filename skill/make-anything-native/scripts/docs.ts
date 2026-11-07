#!/usr/bin/env bun
/**
 * GPUIX's README is its whole API reference, and npm doesn't ship it. This fetches
 * the README for the installed @gpuix/native version, caches it, and prints parts.
 *
 *   bun docs.ts toc                    list every heading with its line number
 *   bun docs.ts section "Scrolling"    print a section (heading match, case-insensitive)
 *   bun docs.ts grep "lineClamp"       print matching lines with 2 lines of context
 *   bun docs.ts path                   print the cached file's path, to read it directly
 *
 * Options: --version 0.11.0 (default: found in node_modules from the current directory up)
 *          --ref main       (read the latest README instead of the release)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
function option(name: string): string | undefined {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  args.splice(i, 2)
  return value
}

function installedVersion(): string | undefined {
  let dir = process.cwd()
  while (true) {
    const manifest = path.join(dir, 'node_modules/@gpuix/native/package.json')
    if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, 'utf8')).version
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

const refOption = option('--ref')
const versionOption = option('--version')
const version = versionOption ?? installedVersion()
const ref = refOption ?? (version ? `@gpuix/native@${version}` : 'main')
if (!refOption && !version) {
  console.error('docs: no @gpuix/native in node_modules here or above; reading main. Pass --version to pin.')
}

const cacheDir = path.join(process.env.XDG_CACHE_HOME ?? path.join(homedir(), '.cache'), 'make-anything-native')
const cacheFile = path.join(cacheDir, `gpuix-README-${ref.replace(/[^\w.-]+/g, '_')}.md`)

async function readme(): Promise<string> {
  // A release README never changes, so only `main` is fetched again.
  if (existsSync(cacheFile) && ref !== 'main') return readFileSync(cacheFile, 'utf8')
  const url = `https://raw.githubusercontent.com/remorses/gpuix/${ref}/README.md`
  const res = await fetch(url)
  if (!res.ok) {
    if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8')
    throw new Error(`docs: ${url} returned ${res.status}`)
  }
  const text = await res.text()
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cacheFile, text)
  return text
}

const lines = (await readme()).split('\n')

// Headings outside fenced code blocks only; `# comment` lines in bash blocks aren't headings.
const headings: { line: number; level: number; title: string }[] = []
let fenced = false
lines.forEach((text, i) => {
  if (/^\s*```/.test(text)) fenced = !fenced
  const m = !fenced && /^(#{1,6})\s+(.*)$/.exec(text)
  if (m) headings.push({ line: i, level: m[1].length, title: m[2] })
})

const [command, ...rest] = args
const query = rest.join(' ')

switch (command) {
  case 'toc':
    console.log(`# GPUIX README (${ref})`)
    for (const h of headings) console.log(`${String(h.line + 1).padStart(5)}  ${'  '.repeat(h.level - 1)}${h.title}`)
    break
  case 'section': {
    const q = query.toLowerCase()
    const matches = headings.filter((h) => h.title.toLowerCase().includes(q))
    if (!matches.length) {
      console.error(`docs: no heading contains "${query}". Run \`bun docs.ts toc\`.`)
      process.exit(1)
    }
    for (const h of matches) {
      const end = headings.find((n) => n.line > h.line && n.level <= h.level)?.line ?? lines.length
      console.log(lines.slice(h.line, end).join('\n').trimEnd(), '\n')
    }
    break
  }
  case 'grep': {
    const re = new RegExp(query, 'i')
    let last = -10
    lines.forEach((text, i) => {
      if (!re.test(text)) return
      const from = Math.max(i - 2, last + 3)
      if (from > last + 3) console.log('--')
      for (let j = from; j <= Math.min(i + 2, lines.length - 1); j++) console.log(`${j + 1}: ${lines[j]}`)
      last = i
    })
    break
  }
  case 'path':
    console.log(cacheFile)
    break
  default:
    console.error('usage: bun docs.ts toc | section <heading> | grep <regex> | path  [--version X] [--ref main]')
    process.exit(1)
}
