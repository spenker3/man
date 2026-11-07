# Converting a web or Electron frontend to GPUIX

The goal is the same app, natively rendered, looking and behaving as close to the source as
GPUIX allows, with every gap written down.

## 1. Inventory and decide

```bash
bun <skill>/scripts/inventory.ts <source-dir> > conversion-inventory.md
```

Read the source's README and agent instruction files (AGENTS.md, CLAUDE.md), then the inventory. For every row marked `!`, and every
dependency that touches the DOM, decide one of: **port** (GPUIX has an equivalent), **rebuild**
(compose it from divs, `motion.div`, headless controls), **render to image** (charts, math, complex
SVG), **Rust custom element** (`scripts/docs.ts section "Your own native elements"`), **open
externally** (iframes, video), or **drop**. Write the decisions into a `CONVERSION.md` in the
output. A feature dropped without a note is a bug.

## 2. Capture the source

Screenshot each screen you will port, at the window size you will use, in light and dark:

```bash
bun <skill>/scripts/shoot.ts url "http://localhost:5173/#/settings" --out ref/settings-dark.png --size 1280x800 --theme dark
```

Use an already-running dev server if there is one, or serve the built `dist/` read-only. If the
source app needs a backend, run it against a copy of the data, never the user's real data.

## 3. Port in this order

1. **Project:** setup from SKILL.md. Copy the data layer unchanged: API clients, types, stores
   (zustand, redux, react-query), pure logic and their tests. Only `fetch` needs absolute URLs
   (there is no page origin), and cookies don't exist (send tokens as headers).
2. **Tokens:** turn CSS custom properties into a theme object (`references/css.md`), both themes.
   Precompute `color-mix()` and alpha colors to hex.
3. **Primitives:** one `ui.tsx` with the source's reusable pieces (Button, Field, Card, Badge, Icon,
   RichText) built once on GPUIX, matching the source CSS classes. Most screens are then mechanical.
4. **Shell, then one screen at a time.** After each: `tsc`, `lint.ts`, screenshot, compare.

## 4. Element and API mapping

`inventory.ts` prints a hint for each finding. The ones that need more than a rename:

| Source | GPUIX |
|---|---|
| `<span>`, `<p>`, headings, `<strong>`, `<em>`, `<label>` | `<text>` with explicit style. Inline mixed formatting: RichText recipe. No italic style. |
| `<button>` | `Button` from `@gpuix/react` (keyboard and disabled handling) or `<div onClick>` + `cursor: "pointer"` |
| `<a href>` | external: open with the OS (`xdg-open`/`open`/`start` via `child_process`); internal: app state |
| `<select>` | `Select` + `SelectTrigger`/`SelectContent`/`SelectItem`. No type-to-find. |
| checkbox, radio, switch, range | divs with state; the mark is a child `div` with `pointerEvents: "none"`; range = drag (`onMouseDown` + window move) with arrow keys |
| `<dialog>`, `popover`, `::backdrop` | `Dialog` (Portal, Backdrop, Popup), or `<anchored>` + `DismissableLayer` |
| `title` attribute / `[data-tip]` | `Tooltip`; check that it opens (one conversion had to fall back to an `<anchored deferred>` bubble) |
| `<table>` | flex rows, or `display: "grid"` with `gridTemplateColumns: <count>` |
| `<input type=file>`, `webkitdirectory` | `renderer.promptForPaths({ files, directories, multiple })`; apply `accept` filters after picking |
| drop zone | `onFileDrop` works; there is no drag-enter/over event, so no hover highlight |
| `<canvas>`, chart libraries | divs for simple bars, `setImagePixels` for raster, or a Rust custom element |
| `<iframe>`, `<video>` | no web view: render the content natively, open it in the browser, or a custom element |
| KaTeX / MathJax HTML | render math to SVG (MathJax SVG output) and show it with `<img>` |
| `marked`/`react-markdown` + DOMPurify | `<markdown>` element (GFM); custom renderers need a JS parse into elements |
| highlight.js/Prism/Shiki | `<code>` element (a block; inline code is `<text>` in a mono font) |
| icon components (lucide-react etc.) | take the raw SVG strings (script it once) and render with `<svg>` + explicit `style.color` |
| `localStorage` | JSON file under `$XDG_CONFIG_HOME/<app>/` (Node `fs`) |
| `matchMedia`, `prefers-color-scheme` | `useWindowSize()`; appearance from the OS (`references/recipes.md`) |
| `ResizeObserver`, `getBoundingClientRect` | `onLayout` on `<div>`/`<text>` |
| `scrollIntoView`, `focus()` | `renderer.scrollIntoView(id)`, `renderer.focusElement(id)` / focus docs |
| `document.hidden` / visibility | none; keep polling or pause on window blur if the version exposes it |
| keyframe spinner / pulse | `motion` animates width, height, opacity, top/left/right/bottom, borderRadius only: no rotate. Use pre-rotated SVG frames or a JS timer. |

## 5. Other frameworks

- **Vue / Svelte / Angular:** rewrite each component as a React function component first:
  props stay props, reactive state becomes `useState`/`useReducer`, computed values become
  `useMemo`, watchers become `useEffect`, slots become `children`/render props, template
  directives become JSX (`v-if` → `&&`, `v-for`/`{#each}` → `.map` with `key`). Then port as above.
- **Plain HTML/JS:** each page becomes a component; event listeners become props; DOM mutation
  code becomes state. Global CSS goes through the same token and style mapping.
- **Solid:** GPUIX has a Solid adapter (`@gpuix/solid`); prefer it for Solid sources.

## 6. Done means

Every screen in scope ported and screenshotted next to its reference in both themes; `tsc` and
`lint.ts` clean; interactions driven by automation; `CONVERSION.md` lists what changed or was
dropped and why.
