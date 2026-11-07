# Recipes

Code that worked in real conversions on GPUIX 0.11.0.

## Inline rich text (bold words, links inside a sentence)

Mixed children in one `<text>` split into runs, so flow words through a wrapping row:

```tsx
type Rich = (string | [string])[]   // [s] = bold

export function RichText({ parts, color, size = 14, lineHeight = 21 }: { parts: Rich | string; color: string; size?: number; lineHeight?: number }) {
  const words: { w: string; bold: boolean }[] = []
  for (const p of typeof parts === 'string' ? [parts] : parts) {
    const [s, bold] = typeof p === 'string' ? [p, false] : [p[0], true]
    for (const m of s.match(/\S+\s*|\s+/g) ?? []) words.push({ w: m, bold })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap' }}>
      {words.map((x, i) => (
        <text key={i} style={{ color, fontSize: size, lineHeight, whiteSpace: 'nowrap', fontWeight: x.bold ? 600 : undefined }}>{x.w}</text>
      ))}
    </div>
  )
}
```

A link inside prose: the same word `<text>`s wrapped in a `<div onClick>` with a 1px bottom rule
(text-decoration color and offset aren't supported). Plain labels with values: one template string.

## System light/dark theme

No appearance API in 0.11. Read it from the OS and follow changes:

```ts
import { spawn, spawnSync } from 'node:child_process'

export type Scheme = 'light' | 'dark'

export function readScheme(): Scheme {
  if (process.env.APP_THEME === 'light' || process.env.APP_THEME === 'dark') return process.env.APP_THEME
  if (process.platform === 'darwin') {
    const r = spawnSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], { encoding: 'utf8' })
    return r.stdout.trim() === 'Dark' ? 'dark' : 'light'
  }
  if (process.platform === 'win32') {
    const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'], { encoding: 'utf8' })
    return /0x0\b/.test(r.stdout) ? 'dark' : 'light'
  }
  // Linux: the XDG desktop portal, which Chromium also reads. 1 = dark, 2 = light, 0 = no preference.
  const r = spawnSync('gdbus', ['call', '--session', '--dest', 'org.freedesktop.portal.Desktop',
    '--object-path', '/org/freedesktop/portal/desktop', '--method', 'org.freedesktop.portal.Settings.ReadOne',
    'org.freedesktop.appearance', 'color-scheme'], { encoding: 'utf8' })
  return /uint32 1\b/.test(r.stdout) ? 'dark' : 'light'
}

/** Linux: call onChange when the portal reports a new color scheme. Returns a stop function. */
export function watchScheme(onChange: (s: Scheme) => void): () => void {
  if (process.platform !== 'linux') return () => {}
  const p = spawn('gdbus', ['monitor', '--session', '--dest', 'org.freedesktop.portal.Desktop',
    '--object-path', '/org/freedesktop/portal/desktop'], { stdio: ['ignore', 'pipe', 'ignore'] })
  p.stdout.on('data', (d) => { if (String(d).includes('color-scheme')) onChange(readScheme()) })
  return () => p.kill()
}
```

Hold the scheme in React state at the root, pick the token object from it, and provide it by context.

## Tooltip and Select that must stretch or grow

The Roots wrap their child in `display: flex; alignItems: start`. Style the Root itself:

```tsx
import * as TooltipPrimitive from '@gpuix/react/tooltip'

const root = fill === 'grow'
  ? { flexGrow: 1, minWidth: 0, flexDirection: 'column', alignItems: 'stretch' }
  : fill === 'stretch' ? { alignSelf: 'stretch', flexDirection: 'column', alignItems: 'stretch' } : undefined

<TooltipPrimitive.Root style={root}>
  <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
  <TooltipPrimitive.Content side="bottom" sideOffset={4} style={{ ... }}>...</TooltipPrimitive.Content>
</TooltipPrimitive.Root>
```

Check that the tooltip actually opens (hover with automation, then screenshot). If it doesn't,
render your own bubble: hover state on the trigger, then `<anchored deferred>` after ~350 ms,
inside an absolute box the size of the trigger.

## Toast layer

Not a transparent full-window `<anchored>` (it paints the window black). Make the root
`position: "relative"` and put the toasts in a `position: "absolute"` div as its **last** child.

## Image pinned to the top (object-position)

`objectFit: "contain"` centers and there is no `objectPosition`. Read the image's pixel size,
measure the box with `onLayout`, and size the `<img>` yourself (`width = box.width`,
`height = box.width * h / w`, capped by the box height) inside a `flexDirection: column` box.
Images that need auth: fetch them with the token and pass a `data:` URL.

## Persisted UI state (replaces localStorage)

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const dir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'my-app')
const file = path.join(dir, 'state.json')
export const loadState = (): Record<string, unknown> => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} } }
export const saveState = (s: Record<string, unknown>) => { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(s)) }
```

Tests and verification scripts must reset this file, or a remembered tab breaks the next run.

## Single binary with `bun build --compile`

The loader finds its `.node` through `createRequire`, which a compiled binary can't follow. Use a
build entry that embeds it (one per target platform):

```ts
// build/entry-linux-x64.ts
import binding from '@gpuix/native-linux-x64-gnu/gpuix-native.linux-x64-gnu.node' with { type: 'file' }
process.env.NAPI_RS_NATIVE_LIBRARY_PATH ??= binding
await import('../app' + '.tsx')
```

```ts
// build/node-file.d.ts
declare module '*.node' { const path: string; export default path }
```

`bun build --compile build/entry-linux-x64.ts --outfile dist/app`. Run the binary once to check.
macOS: `@gpuix/native-darwin-arm64/gpuix-native.darwin-arm64.node`; Windows: `win32-x64-msvc`.

## Window-level shortcuts

Window `onKeyDown` modifier names are `ctrl` and `cmd`. In automation, `locator.press()` targets an
element; for window-level keys use the app's keystroke call (`app.call("keystrokes", { keys })` in
0.11, from `@gpuix/native/dist/automation/client.js`).

## Clicks inside clickable cards

GPUI hit-testing can deliver a press to both a tag and its clickable card. If a child action must
not also trigger the card, have the card ignore a press that lands within ~250 ms of the child's.
