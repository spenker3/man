#!/usr/bin/env bun
/**
 * Scans a web or Electron frontend and lists what a GPUIX conversion has to handle:
 * the framework, DOM elements, CSS features, browser APIs, Electron APIs and
 * dependencies, each with a count, example files, and what to do in GPUIX.
 * Hints are short; references/mapping.md has the full treatment.
 *
 *   bun inventory.ts <project-dir> [--json]
 *
 * Read-only. Skips node_modules, dist, build output and test files.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '.')
const asJson = process.argv.includes('--json')

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', '.git', '.next', '.svelte-kit', 'coverage', 'web-dist', 'archive'])
const TEST_FILE = /\.(test|spec|stories)\.[jt]sx?$|__tests__/
const CODE = /\.(tsx|jsx|ts|js|mjs|cjs|vue|svelte)$/
const STYLE = /\.(css|scss|sass|less)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if ((CODE.test(name) || STYLE.test(name) || name.endsWith('.html')) && !TEST_FILE.test(full) && st.size < 2_000_000) out.push(full)
  }
  return out
}

type Hit = { count: number; files: Set<string> }
type Table = Map<string, Hit>
function add(table: Table, key: string, file: string, n = 1) {
  const hit = table.get(key) ?? { count: 0, files: new Set() }
  hit.count += n
  hit.files.add(path.relative(root, file))
  table.set(key, hit)
}

// ── What each finding means in GPUIX ────────────────────────────────────────

const ELEMENT_HINTS: Record<string, string> = {
  div: 'native <div>; block by default, set display:"flex" for flex layout',
  img: 'native <img> (raster or SVG, local/data/http)',
  svg: '<svg> is monochrome tintable icons only; render complex SVG to an image or <img src=*.svg>',
  input: 'native <input> for text; checkbox/radio/range/file need custom controls or file pickers',
  textarea: 'native <textarea>',
  span: '<text> (inline run); adjacent <text> merge into one line',
  p: '<text> in a block <div>', h1: '<text> with fontSize/fontWeight', h2: '<text> with fontSize/fontWeight', h3: '<text> with fontSize/fontWeight', h4: '<text>', h5: '<text>', h6: '<text>',
  strong: '<text style={{fontWeight}}>', b: '<text style={{fontWeight}}>', em: '<text>; there is no fontStyle/italic', i: '<text>; no italic (or an icon font: use <svg>)', small: '<text> with fontSize', code: '<code> is a highlighted BLOCK; inline code = <text fontFamily mono>', pre: '<code> or <text whiteSpace>', kbd: '<text> styled', mark: '<text> + highlight API', label: '<text>; clicking it does not focus an input', br: 'split into separate block <text>',
  button: 'no <button> element: Button component from @gpuix/react, or <div onClick> with cursor:"pointer"', a: '<div onClick>; external links open via the OS (xdg-open/open/start), internal ones change app state', form: '<div>; no submit event, handle Enter on inputs',
  ul: '<div> column', ol: '<div> column with your own numbers', li: '<div> row', nav: '<div>', header: '<div>', footer: '<div>', main: '<div>', section: '<div>', article: '<div>', aside: '<div>', figure: '<div>', figcaption: '<text>', hr: '<div> with height 1 and a background',
  select: 'headless Select from @gpuix/react', option: 'Select items', dialog: 'Dialog from @gpuix/react (or <anchored>/portal)', details: 'state + <div onClick>', summary: '<div onClick>',
  table: 'display:"grid" with gridTemplateColumns, or flex rows', thead: '<div>', tbody: '<div>', tr: '<div> row', td: '<div> cell', th: '<div> cell',
  blockquote: '<div> with a left border', cite: '<text>', abbr: '<text>', time: '<text>', sup: '<text> with smaller fontSize (no baseline shift)', sub: '<text> with smaller fontSize (no baseline shift)', dl: '<div>', dt: '<text>', dd: '<text>', fieldset: '<div> with a border', legend: '<text>', progress: 'two <div>s (track + fill width)', meter: 'two <div>s (track + fill width)', output: '<text>', optgroup: 'Select group',
  canvas: 'NOT SUPPORTED (planned): draw to an image buffer, use <svg>/<img>, or a Rust custom element',
  iframe: 'NOT SUPPORTED: no web view; render natively or open in the browser',
  video: 'NOT SUPPORTED: Rust custom element or open externally', audio: 'NOT SUPPORTED: play from Node instead', picture: '<img>', source: '<img>',
}

const SVG_CHILDREN = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs', 'use', 'symbol', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'stop', 'tspan', 'foreignobject'])
ELEMENT_HINTS['svg children (path, circle, ...)'] = 'inline SVG markup: move it to an .svg file or string for <svg src> / <img>'

const CSS_FEATURES: [string, RegExp, string][] = [
  ['class selectors / cascade', /(^|[\s,}])\.[a-zA-Z_-][\w-]*[^{]*\{/gm, 'no CSS: every style becomes a style object; share via TS constants/functions'],
  ['CSS custom properties var()', /var\(--/g, 'theme object in JS (context) instead of variables'],
  ['light-dark() / prefers-color-scheme', /light-dark\(|prefers-color-scheme/g, 'theme object in JS; no system-appearance API in 0.11: read it from the OS (references/css.md)'],
  ['@media queries', /@media\b(?![^{]*prefers-color-scheme)/g, 'useWindowSize() and branch in JS'],
  ['@container queries', /@container\b/g, 'measure the element (onLayout/bounds) and branch in JS'],
  [':hover', /:hover/g, 'style.hover'],
  [':active', /:active/g, 'style.active'],
  [':focus / :focus-visible', /:focus(-visible|-within)?/g, 'style.focusVisible (focus-within: track in state)'],
  [':disabled / [disabled] / aria-* selectors', /:disabled|\[disabled\]|\[aria-[\w-]+/g, 'state-dependent style objects in JS'],
  ['::before / ::after', /::?(before|after)\b/g, 'real child elements'],
  ['::placeholder', /::placeholder/g, 'input placeholder prop + its style props; check docs'],
  ['::selection', /::selection/g, 'style.selectionColor'],
  [':nth-child / :first-child / :last-child', /:(nth-child|nth-of-type|first-child|last-child|not)\(?/g, 'compute per item in the map() (index)'],
  ['sibling/descendant combinators', /[\w\])]\s*[>+~]\s*[.#\w]/g, 'pass styles down explicitly'],
  ['calc()', /calc\(/g, 'compute numbers in JS'],
  ['rem/em units', /\d(r?em)\b/g, 'numbers in px (multiply by the root font size)'],
  ['vh/vw units', /\d(vh|vw|dvh|svh)\b/g, 'percentages of a sized parent, or useWindowSize()'],
  ['transform / translate / scale / rotate', /\btransform\s*:|\btranslate\s*:|\bscale\s*:|\brotate\s*:/g, 'NOT SUPPORTED: position/size instead, or motion.div for animated offsets'],
  ['transition', /\btransition(-[\w]+)?\s*:/g, 'motion.div (width/height/opacity/top/left/borderRadius only) or drop'],
  ['@keyframes / animation', /@keyframes|\banimation(-[\w]+)?\s*:/g, 'motion.div loops in JS, or drop'],
  ['z-index', /\bz-index\s*:/g, 'NOT SUPPORTED: tree order is paint order; overlays via <anchored>/portals'],
  ['position: sticky', /position\s*:\s*sticky/g, 'NOT SUPPORTED: split into a fixed header + scrolling body'],
  ['position: fixed', /position\s*:\s*fixed/g, 'works like absolute (no scrolling document)'],
  ['display: grid', /display\s*:\s*(inline-)?grid/g, 'display:"grid" exists but gridTemplateColumns is a COUNT; areas/fr tracks/spans unsupported'],
  ['grid-template-areas / spans', /grid-template-areas|grid-(column|row)\s*:|span\s+\d/g, 'NOT SUPPORTED: nest flex containers'],
  ['display: inline / inline-block / inline-flex', /display\s*:\s*inline/g, 'no inline flow: rows of flex children'],
  ['box-shadow', /box-shadow\s*:/g, 'structured boxShadow object(s), not a string'],
  ['filter / backdrop-filter', /\b(backdrop-)?filter\s*:/g, 'NOT SUPPORTED (window blur exists for whole windows)'],
  ['background-image / url()', /background(-image)?\s*:[^;]*url\(/g, '<img> positioned behind content'],
  ['gradients', /(linear|radial|conic)-gradient\(/g, 'linear: 2-stop LinearGradientBackground only; others: image'],
  ['border shorthand / per-side colors', /\bborder(-(top|right|bottom|left))?\s*:\s*[^;]*\b(solid|dashed|dotted)/g, 'borderWidth/borderColor numbers; ONE borderColor for all sides'],
  ['outline', /\boutline\s*:/g, 'outlineWidth/outlineColor/outlineOffset'],
  ['letter-spacing', /letter-spacing\s*:/g, 'NOT SUPPORTED'],
  ['text-transform', /text-transform\s*:/g, 'transform the string in JS'],
  ['font-style italic', /font-style\s*:\s*italic/g, 'NOT SUPPORTED as a style; use an italic font family if needed'],
  ['font-variant-numeric / font-feature-settings', /font-(variant-numeric|feature-settings)\s*:/g, 'NOT SUPPORTED; use a mono font for aligned numbers'],
  ['text-overflow / line clamp', /text-overflow\s*:|line-clamp/g, 'textOverflow:"ellipsis" + whiteSpace:"nowrap", or lineClamp'],
  ['white-space', /white-space\s*:/g, 'whiteSpace: "normal" | "nowrap" only'],
  ['overflow: auto/scroll', /overflow(-[xy])?\s*:\s*(auto|scroll|overlay)/g, 'overflow/overflowX/overflowY:"scroll"; NO nested vertical scrolling'],
  ['@font-face / font imports', /@font-face|@fontsource|fonts\.googleapis/g, 'register fonts with the custom-fonts API'],
  ['cursor', /\bcursor\s*:/g, 'style.cursor (most CSS values)'],
  ['user-select', /user-select\s*:/g, 'style.userSelect'],
  ['pointer-events', /pointer-events\s*:/g, 'style.pointerEvents'],
  ['opacity', /\bopacity\s*:/g, 'style.opacity'],
  ['aspect-ratio', /aspect-ratio\s*:/g, 'style.aspectRatio as a number'],
]

const BROWSER_APIS: [string, RegExp, string][] = [
  ['DOM queries (document.querySelector/getElementById)', /document\.(querySelector|getElementById|getElementsBy)/g, 'no DOM: refs + GPUIX measure/focus APIs'],
  ['document.* other', /document\.(body|documentElement|addEventListener|createElement|title|activeElement|execCommand)/g, 'no document: renderer/window APIs'],
  ['window.addEventListener / keydown globals', /window\.addEventListener|document\.addEventListener/g, 'renderer keyboard callbacks / element onKeyDown'],
  ['getBoundingClientRect / offsetWidth', /getBoundingClientRect|offset(Width|Height|Top|Left)|client(Width|Height)|scroll(Top|Height|Width)/g, 'onLayout/bounds measurement APIs'],
  ['scrollIntoView / scrollTo', /scrollIntoView|scrollTo\(|scrollBy\(/g, 'renderer.scrollIntoView / scrollTo (docs "Programmatic scrolling")'],
  ['.focus() / .blur() on DOM refs', /\.(focus|blur)\(\)/g, 'renderer.focusElement / focus APIs (docs "Imperative focus")'],
  ['ResizeObserver', /ResizeObserver/g, 'onLayout / useWindowSize'],
  ['IntersectionObserver', /IntersectionObserver/g, '<virtual-list> or onScrollChange math'],
  ['matchMedia', /matchMedia\(/g, 'useWindowSize for sizes; appearance from the OS (references/css.md)'],
  ['localStorage / sessionStorage', /(local|session)Storage/g, 'a JSON file under the app data dir (Node fs)'],
  ['IndexedDB', /indexedDB/g, 'SQLite (bun:sqlite) or files'],
  ['navigator.clipboard', /navigator\.clipboard/g, 'OS clipboard: check `docs.ts grep clipboard` for your version, else wl-copy/pbcopy/clip via child_process'],
  ['file input / FileReader / drag-drop files', /type=["']file["']|FileReader|onDrop|ondrop|dataTransfer/g, 'renderer.promptForPaths() file picker; file drag-drop: none, use the picker'],
  ['window.open / location', /window\.open\(|location\.(href|hash|assign|reload)|history\.(push|replace)State/g, 'external: open via the OS (xdg-open/open/start); routing: app state'],
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/g, 'no HTML: <markdown>, or parse into elements'],
  ['requestAnimationFrame', /requestAnimationFrame/g, 'motion.div, or a timer driving state'],
  ['Notification API', /new Notification\(/g, 'check `docs.ts grep -i notification` for your version, else notify-send/osascript'],
  ['WebSocket / EventSource / fetch', /new (WebSocket|EventSource)\(|\bfetch\(/g, 'works (Bun/Node); cookies and relative URLs do not, use absolute URLs'],
  ['alert / confirm / prompt', /\b(alert|confirm|prompt)\(/g, 'Dialog component or native dialogs'],
]

const ELECTRON_APIS = /\b(app|BrowserWindow|ipcMain|ipcRenderer|contextBridge|dialog|shell|Menu|MenuItem|Tray|nativeTheme|globalShortcut|clipboard|Notification|protocol|session|webContents|autoUpdater|powerMonitor|screen|nativeImage|net|crashReporter|safeStorage|systemPreferences)\b/g

const DEP_HINTS: [RegExp, string][] = [
  [/^react-dom$/, 'replaced by @gpuix/react render()'],
  [/^(react-router|react-router-dom|@tanstack\/react-router|wouter)$/, 'DOM routers: replace with state-based routing'],
  [/^(tailwindcss|@tailwindcss\/.*|styled-components|@emotion\/.*|sass|less|postcss|clsx|classnames)$/, 'CSS tooling: styles become objects'],
  [/^(@radix-ui\/.*|@mui\/.*|@chakra-ui\/.*|@headlessui\/.*|@mantine\/.*|antd|react-bootstrap|@shadcn\/.*|@base-ui-components\/.*)$/, 'DOM component library: rebuild on GPUIX elements / headless controls'],
  [/^(framer-motion|motion|react-spring|@react-spring\/.*)$/, 'motion.div from @gpuix/react'],
  [/^(recharts|chart\.js|react-chartjs-2|victory|@nivo\/.*|echarts|plotly.*|@visx\/.*)$/, 'DOM/canvas charts: draw with divs, <svg>, or an image'],
  [/^d3(-.*)?$/, 'math modules (scale, force, shape) work; DOM selection/rendering does not'],
  [/^(katex|mathjax.*|mathjax-full)$/, 'HTML output unusable: render math to SVG (MathJax SVG) and show as <img>'],
  [/^(marked|markdown-it|remark.*|react-markdown)$/, '<markdown> element renders GFM natively'],
  [/^(dompurify|sanitize-html)$/, 'not needed without HTML'],
  [/^(highlight\.js|prismjs|shiki|react-syntax-highlighter)$/, '<code> element highlights natively'],
  [/^(monaco-editor|@monaco-editor\/.*|codemirror|@codemirror\/.*|@uiw\/.*)$/, '<textarea>/<code>, or a Rust custom element'],
  [/^(lucide-react|react-icons|@heroicons\/.*|@tabler\/icons-react|@phosphor-icons\/.*)$/, 'icon components render DOM SVG: use the icons\' raw SVG with <svg>'],
  [/^(@fontsource.*)$/, 'register the font file with the custom-fonts API'],
  [/^(electron|electron-builder|electron-forge|@electron.*|electron-store|electron-updater)$/, 'removed: GPUIX process + cargo-packager + checkUpdate'],
  [/^(vite|@vitejs\/.*|webpack.*|parcel|esbuild|rollup)$/, 'bundler not needed: bun runs TSX directly'],
  [/^(react-virtualized|react-window|@tanstack\/react-virtual|react-virtuoso)$/, '<virtual-list>'],
  [/^(react|typescript|@types\/.*|vitest|jest|eslint.*|prettier)$/, 'keep'],
  [/^jsdom$/, 'DOM test env: tests move to GPUIX automation'],
  [/^(zustand|jotai|redux|@reduxjs\/.*|mobx|valtio|@tanstack\/react-query|swr|immer|zod|date-fns|dayjs|lodash.*)$/, 'works unchanged (no DOM)'],
]

// ── Scan ───────────────────────────────────────────────────────────────────

const files = walk(root)
const elements: Table = new Map()
const css: Table = new Map()
const browser: Table = new Map()
const electron: Table = new Map()
const ipcChannels = new Set<string>()
const frameworks = new Set<string>()
let classNameCount = 0
let inlineStyleCount = 0
let codeLines = 0
let cssLines = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n').length
  if (STYLE.test(file)) {
    cssLines += lines
    for (const [name, re] of CSS_FEATURES) { const n = text.match(re)?.length ?? 0; if (n) add(css, name, file, n) }
    continue
  }
  codeLines += lines
  if (file.endsWith('.vue')) frameworks.add('vue')
  if (file.endsWith('.svelte')) frameworks.add('svelte')
  if (/from ['"]react['"]|require\(['"]react['"]\)/.test(text)) frameworks.add('react')
  if (/from ['"]solid-js['"]/.test(text)) frameworks.add('solid')
  if (/from ['"]@angular\//.test(text)) frameworks.add('angular')

  // Markup: JSX/TSX, Vue/Svelte templates and HTML all use <lowercase-tag.
  if (/\.(tsx|jsx|vue|svelte|html)$/.test(file)) {
    for (const m of text.matchAll(/<([a-z][a-z0-9]*)(?=[\s>/])/g)) {
      if (m[1] in ELEMENT_HINTS) add(elements, m[1], file)
      else if (SVG_CHILDREN.has(m[1])) add(elements, 'svg children (path, circle, ...)', file)
      // Anything else is a TS generic (<string>), a document tag in a template string, or a custom element.
    }
    classNameCount += text.match(/\bclass(Name)?=/g)?.length ?? 0
    inlineStyleCount += text.match(/\bstyle=\{\{/g)?.length ?? 0
    // Inline <style> and style attributes also carry CSS.
    // Inline <style> blocks carry real CSS; scan only their contents.
    for (const block of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      for (const [name, re] of CSS_FEATURES) { const n = block[1].match(re)?.length ?? 0; if (n) add(css, name, file, n) }
    }
  }
  for (const [name, re] of BROWSER_APIS) { const n = text.match(re)?.length ?? 0; if (n) add(browser, name, file, n) }
  if (/require\(['"]electron['"]\)|from ['"]electron['"]/.test(text)) {
    frameworks.add('electron')
    const importLine = text.match(/(?:const|import)\s*\{([^}]+)\}\s*(?:=\s*require\(['"]electron['"]\)|from ['"]electron['"])/)
    const imported = new Set(importLine?.[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]) ?? [])
    for (const m of text.matchAll(ELECTRON_APIS)) if (imported.has(m[1])) add(electron, m[1], file)
    for (const m of text.matchAll(/ipc(?:Main|Renderer)\.(?:handle|on|once|invoke|send)\(\s*['"`]([^'"`]+)/g)) ipcChannels.add(m[1])
  }
  for (const m of text.matchAll(/exposeInMainWorld\(\s*['"`]([^'"`]+)/g)) ipcChannels.add(`contextBridge:${m[1]}`)
}

// Dependencies from every package.json under the root (Electron apps often have several).
const deps = new Map<string, Set<string>>()
function readManifests(dir: string, depth = 0) {
  if (depth > 3) return
  const manifest = path.join(dir, 'package.json')
  if (existsSync(manifest)) {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      const where = deps.get(name) ?? new Set()
      where.add(path.relative(root, dir) || '.')
      deps.set(name, where)
    }
  }
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (!SKIP_DIRS.has(name) && !name.startsWith('.') && statSync(full).isDirectory()) readManifests(full, depth + 1)
  }
}
readManifests(root)
for (const name of deps.keys()) {
  if (name === 'vue') frameworks.add('vue')
  if (name === 'svelte') frameworks.add('svelte')
  if (name === 'electron') frameworks.add('electron')
  if (/^(react|solid-js|@angular\/core)$/.test(name)) frameworks.add(name === 'solid-js' ? 'solid' : name.replace('@angular/core', 'angular'))
}

// ── Report ─────────────────────────────────────────────────────────────────

const sorted = (t: Table) => [...t.entries()].sort((a, b) => b[1].count - a[1].count)
const where = (h: Hit) => [...h.files].slice(0, 3).join(', ') + (h.files.size > 3 ? ` +${h.files.size - 3}` : '')
const unsupported = (hint: string) => /NOT SUPPORTED/.test(hint)

const report = {
  root,
  frameworks: [...frameworks],
  size: { files: files.length, codeLines, cssLines, classNameCount, inlineStyleCount },
  elements: sorted(elements).map(([k, h]) => ({ element: k, count: h.count, hint: ELEMENT_HINTS[k] ?? 'custom element or SVG child: check', files: where(h) })),
  css: sorted(css).map(([k, h]) => ({ feature: k, count: h.count, hint: CSS_FEATURES.find((c) => c[0] === k)![2], files: where(h) })),
  browser: sorted(browser).map(([k, h]) => ({ api: k, count: h.count, hint: BROWSER_APIS.find((c) => c[0] === k)![2], files: where(h) })),
  electron: sorted(electron).map(([k, h]) => ({ api: k, count: h.count, files: where(h) })),
  ipcChannels: [...ipcChannels],
  dependencies: [...deps.entries()].map(([name, w]) => ({ name, in: [...w].join(', '), hint: DEP_HINTS.find(([re]) => re.test(name))?.[1] ?? 'check: does it touch the DOM?' })),
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const out: string[] = []
const flag = (hint: string) => (unsupported(hint) ? '**!** ' : '')
out.push(`# Conversion inventory: ${path.basename(root)}`, '')
out.push(`- Frameworks: ${report.frameworks.join(', ') || 'none detected (plain HTML/JS?)'}`)
out.push(`- ${files.length} files, ${codeLines} code lines, ${cssLines} CSS lines, ${classNameCount} class attributes, ${inlineStyleCount} inline styles`)
if (frameworks.has('vue') || frameworks.has('svelte') || frameworks.has('angular')) out.push('- Not React: port components to React first (references/other-frameworks.md)')
if (frameworks.has('electron')) out.push('- Electron: main-process work moves into the GPUIX process (references/electron.md)')
out.push('', 'Rows marked **!** have no GPUIX equivalent. Decide what to do with each before porting.', '')

out.push('## Elements', '', '| Element | Count | GPUIX | Files |', '|---|---:|---|---|')
for (const e of report.elements) out.push(`| \`<${e.element}>\` | ${e.count} | ${flag(e.hint)}${e.hint} | ${e.files} |`)
if (report.css.length) {
  out.push('', '## CSS features', '', '| Feature | Count | GPUIX | Files |', '|---|---:|---|---|')
  for (const c of report.css) out.push(`| ${c.feature} | ${c.count} | ${flag(c.hint)}${c.hint} | ${c.files} |`)
}
if (report.browser.length) {
  out.push('', '## Browser APIs', '', '| API | Count | GPUIX | Files |', '|---|---:|---|---|')
  for (const b of report.browser) out.push(`| ${b.api} | ${b.count} | ${b.hint} | ${b.files} |`)
}
if (report.electron.length || report.ipcChannels.length) {
  out.push('', '## Electron', '', '| API | Uses | Files |', '|---|---:|---|')
  for (const e of report.electron) out.push(`| \`${e.api}\` | ${e.count} | ${e.files} |`)
  if (report.ipcChannels.length) out.push('', `IPC channels / bridges: ${report.ipcChannels.map((c) => `\`${c}\``).join(', ')}. Each becomes a direct function call.`)
}
out.push('', '## Dependencies', '', '| Package | In | GPUIX |', '|---|---|---|')
for (const d of report.dependencies) out.push(`| \`${d.name}\` | ${d.in} | ${d.hint} |`)
console.log(out.join('\n'))
