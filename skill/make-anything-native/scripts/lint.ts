#!/usr/bin/env bun
/**
 * Finds GPUIX mistakes that typecheck (or that tsc can't see) but fail silently at runtime.
 *
 *   bun lint.ts <app-dir> [files...]
 *
 * Uses the app's own `typescript` and reads the valid style props from the installed
 * @gpuix/native host.d.ts, so it follows the GPUIX version in use. Exit 1 on errors.
 * Only inline object literals are checked; styles built elsewhere and spread in are not.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '.')
// The skill's own pinned TypeScript (5.x has the JS compiler API; 7.x doesn't), installed on first use.
const here = import.meta.dir
if (!existsSync(path.join(here, 'node_modules/typescript'))) {
  const r = Bun.spawnSync(['bun', 'install', '--silent'], { cwd: here, stdout: 'inherit', stderr: 'inherit' })
  if (r.exitCode !== 0) { console.error('lint: could not install typescript for the linter'); process.exit(2) }
}
const ts: typeof import('typescript') = createRequire(path.join(here, 'package.json'))('typescript')

type Finding = { file: string; line: number; level: 'error' | 'warn'; msg: string }
const findings: Finding[] = []

// ── Project checks ─────────────────────────────────────────────────────────
const pkgPath = path.join(root, 'package.json')
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const adapter = deps['@gpuix/react'] ?? deps['@gpuix/solid']
  const native = deps['@gpuix/native']
  const exact = (v?: string) => !!v && /^\d+\.\d+\.\d+/.test(v)
  if (adapter && (!exact(adapter) || !exact(native) || adapter !== native)) {
    findings.push({ file: 'package.json', line: 1, level: 'warn', msg: `pin the GPUIX adapter and @gpuix/native to the same exact version (have ${adapter} / ${native ?? 'missing'})` })
  }
}
const tsconfigPath = path.join(root, 'tsconfig.json')
if (existsSync(tsconfigPath) && !/"jsxImportSource"\s*:\s*"@gpuix\/(react|solid)"/.test(readFileSync(tsconfigPath, 'utf8'))) {
  findings.push({ file: 'tsconfig.json', line: 1, level: 'error', msg: 'set "jsxImportSource": "@gpuix/react" or tsc checks against DOM types' })
}

// ── Style schema from the installed GPUIX ──────────────────────────────────
const hostDts = path.join(root, 'node_modules/@gpuix/native/dist/host.d.ts')
const styleKeys = new Map<string, string>() // prop -> declared type text
if (existsSync(hostDts)) {
  const body = /export interface StyleDesc \{([\s\S]*?)\n\}/.exec(readFileSync(hostDts, 'utf8'))?.[1] ?? ''
  for (const m of body.matchAll(/^\s+(\w+)\?:\s*([^;]+);/gm)) styleKeys.set(m[1], m[2].trim())
} else {
  findings.push({ file: 'node_modules', line: 1, level: 'warn', msg: '@gpuix/native not installed; style props not checked' })
}
const numericOnly = (key: string) => /^number$/.test(styleKeys.get(key) ?? '')
const dimension = (key: string) => /DimensionValue/.test(styleKeys.get(key) ?? '')

const DOM_TAGS = new Set('span p a button h1 h2 h3 h4 h5 h6 ul ol li nav header footer main section article aside label form select option table thead tbody tr td th strong b em i small pre kbd br hr iframe video audio canvas dialog details summary figure figcaption blockquote'.split(' '))
const FLEX_ONLY = ['flexDirection', 'gap', 'rowGap', 'columnGap', 'alignItems', 'justifyContent', 'flexWrap', 'alignContent']
const GENERIC_FONTS = /^(helvetica|arial|system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|ui-sans-serif|ui-monospace|segoe ui|inter)$/i

// ── Source files ───────────────────────────────────────────────────────────
const SKIP = new Set(['node_modules', 'dist', 'build', 'web-dist', '.git'])
function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n) || n.startsWith('.')) continue
    const f = path.join(dir, n)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (/\.(tsx|ts)$/.test(n) && !n.endsWith('.d.ts')) out.push(f)
  }
  return out
}
const files = process.argv.length > 3 ? process.argv.slice(3).map((f) => path.resolve(f)) : walk(root)

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const rel = path.relative(root, file)
  const at = (node: ts.Node, level: Finding['level'], msg: string) =>
    findings.push({ file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, level, msg })

  const propName = (p: ts.ObjectLiteralElementLike) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined)

  function checkStyle(obj: ts.ObjectLiteralExpression, tag: string, nested = false) {
    const hasSpread = obj.properties.some((p) => ts.isSpreadAssignment(p))
    const keys = new Map<string, ts.ObjectLiteralElementLike>()
    for (const p of obj.properties) { const k = propName(p); if (k) keys.set(k, p) }

    for (const [key, p] of keys) {
      if (styleKeys.size && !styleKeys.has(key)) at(p, 'error', `style.${key} is not a GPUIX style prop; it does nothing`)
      if (!ts.isPropertyAssignment(p)) continue
      const v = p.initializer
      if (ts.isObjectLiteralExpression(v) && /^(hover|active|focusVisible)$/.test(key)) checkStyle(v, tag, true)
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) {
        const s = v.text
        if (numericOnly(key)) at(p, 'error', `style.${key}: "${s}" must be a number; one bad value rejects the whole mutation batch (blank window)`)
        else if (dimension(key) && !/^-?\d+(\.\d+)?%$/.test(s)) at(p, 'error', `style.${key}: "${s}" must be a number (px) or "N%"; one bad value rejects the whole batch`)
        if (key === 'fontFamily' && (s.includes(',') || GENERIC_FONTS.test(s.trim()))) at(p, 'warn', `fontFamily "${s}": GPUI takes one installed family; stacks and aliases fall back silently (check fc-list : family)`)
      }
      if (key === 'lineHeight' && ts.isNumericLiteral(v) && Number(v.text) < 4) at(p, 'error', `lineHeight: ${v.text} is pixels in GPUIX, not a multiplier`)
    }
    if (!nested && !hasSpread && tag === 'div' && !keys.has('display')) {
      const flexKey = FLEX_ONLY.find((k) => keys.has(k))
      if (flexKey) at(keys.get(flexKey)!, 'error', `${flexKey} without display: "flex" does nothing (div is block)`)
    }
  }

  function textChildren(el: ts.JsxElement) {
    const kids = el.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim()))
    const hasExpr = kids.some((c) => ts.isJsxExpression(c) && c.expression && !ts.isStringLiteral(c.expression) && !ts.isTemplateExpression(c.expression) && !ts.isNoSubstitutionTemplateLiteral(c.expression))
    const hasText = kids.some((c) => ts.isJsxText(c))
    if (kids.length > 1 && (hasExpr || hasText)) at(el, 'warn', '<text> with mixed children renders separate runs that can wrap apart; use one template string')
    for (const c of kids) if (ts.isJsxElement(c) && c.openingElement.tagName.getText() === 'text') at(c, 'warn', '<text> inside <text> becomes a nested block, not inline text')
  }

  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText()
      if (DOM_TAGS.has(tag)) at(node, 'error', `<${tag}> is not a GPUIX element (use div/text/Button/Select...)`)
      let hasColor = false
      let styleUnknown = false
      for (const a of node.attributes.properties) {
        if (!ts.isJsxAttribute(a)) { styleUnknown = true; continue }
        const name = a.name.getText()
        if (name === 'className' || name === 'class') at(a, 'error', `${name} does nothing in GPUIX; use style objects`)
        if (name === 'style') {
          const e = a.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined
          if (e && ts.isObjectLiteralExpression(e)) {
            checkStyle(e, tag)
            hasColor = e.properties.some((p) => propName(p) === 'color')
            if (e.properties.some((p) => ts.isSpreadAssignment(p))) styleUnknown = true
          } else styleUnknown = true
        }
      }
      if ((tag === 'text' || tag === 'svg') && !hasColor && !styleUnknown) at(node, 'warn', `<${tag}> without an explicit style.color (inheritance is unreliable; svg ignores the parent)`)
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'text') textChildren(node)
    ts.forEachChild(node, visit)
  }
  visit(sf)

  // Automation launched without a guaranteed close leaks a window.
  if (/\blaunch\(\s*\{/.test(text) && /@gpuix\/(react|native)\/automation/.test(text) && !/finally\s*\{[^}]*\.close\(/.test(text)) {
    findings.push({ file: rel, line: 1, level: 'warn', msg: 'launch() without app.close() in a finally block leaks the window when a step throws' })
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
for (const f of findings) console.log(`${f.file}:${f.line}  ${f.level === 'error' ? 'error' : 'warn '}  ${f.msg}`)
const errors = findings.filter((f) => f.level === 'error').length
console.log(`\nlint: ${errors} error(s), ${findings.length - errors} warning(s) in ${files.length} file(s)`)
process.exit(errors ? 1 : 0)
