# CSS to GPUIX styles

Every style is a JS object on the element's `style` prop. The full list of props is
`StyleDesc` in `node_modules/@gpuix/native/dist/host.d.ts`; a prop that isn't there does nothing.

## Values

| CSS | GPUIX |
|---|---|
| `16px`, `1rem`, `1em` | `16` (multiply rem/em by the root font size) |
| `50%` | `"50%"`, only for `width`, `height`, `minWidth/Height`, `maxWidth/Height` |
| `100vh`, `100vw` | `height: "100%"` on a chain of sized parents, or `useWindowSize()` |
| `calc(100% - 48px)` | flex layout (`flexGrow: 1`) or compute from `onLayout` |
| `padding: 0 16px` | `paddingTop: 0, paddingRight: 16, ...` (or `padding: n` for all sides) |
| `border: 1px solid var(--line)` | `borderWidth: 1, borderColor: theme.line` (one color for all sides; per-side widths exist) |
| `margin-left: auto`, `margin-top: auto` | a spacer `<div style={{ flexGrow: 1 }} />` |
| `line-height: 1.5` | `lineHeight: fontSize * 1.5` (px) |
| `box-shadow: 0 1px 2px #0003` | `boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "#00000033" }` |
| `linear-gradient(...)` | `background: { type: "linear-gradient", angle, stops: [a, b] }` (two stops) |
| `color-mix()`, `rgb(... / .5)` | precomputed hex, `#rrggbbaa` |
| `opacity` on text | alpha in the text color (cheaper and exact) |

## Selectors and states

- `.class` rules: style constants or functions in TS (`const card = (t: Theme) => ({ ... })`),
  spread into `style`. Descendant/sibling selectors become explicit props on the children.
- `:hover`, `:active`: `style.hover`, `style.active`. Hover on a parent that recolors a child
  (an icon) needs JS state (`onMouseEnter`/`onMouseLeave`); prefer native `hover` where possible,
  JS hover can stick after simulated clicks.
- `:focus-visible`: `style.focusVisible`, and `keyboardFocusDim: false` on the root to stop GPUIX
  dimming everything else.
- `:disabled`, `[aria-*]`, `:nth-child`, `:first-child`: decide in JS from state and the map index.
- `::before`/`::after`: real child elements.
- `::placeholder`: `placeholder` prop; `::selection`: `selectionColor`.

## Layout

- `display: block` (default) stacks children; `display: "flex"` for anything with direction or gap.
- `flex: 1` → `flexGrow: 1, flexShrink: 1, flexBasis: 0`; a growing input in a wrapping row needs
  `flexBasis: 0` plus a `minWidth`, or it takes a whole line.
- A flex child that must shrink or ellipsize needs `minWidth: 0` (as in CSS).
- `display: grid`: `gridTemplateColumns` is a **count**. `repeat(auto-fit, minmax(240px, 1fr))` →
  measure the container with `onLayout` and compute the count. No areas, spans or fr tracks.
- `position: sticky`: a fixed-height sibling outside the scroller (header above, bar below).
- `position: fixed`: lays out like `absolute`. `z-index`: reorder (later children paint on top),
  or use `<anchored>`/portals for overlays.
- `overflow: auto`: `overflowY: "scroll"`. **No nested vertical scrolling**: only one vertical
  scroller per axis path. Scrollbars draw only with `scrollbarColor`/`scrollbarWidth`.
- Text overflow: `whiteSpace: "nowrap"` + `textOverflow: "ellipsis"`, or `lineClamp`.
- `@media (max-width)`: `const { width } = useWindowSize()` and branch.

## Themes

Turn the token file into one object per theme with the same keys, provide it through React
context, and pick it from the OS appearance (`references/recipes.md`). `light-dark(a, b)` becomes
two entries. Give the user an override (env var or setting) and test both themes.

## Fonts

- Use one installed family name (`fc-list : family` on Linux). Stacks and aliases (`Helvetica`,
  `system-ui`, `sans-serif`) are not resolved; on Linux Helvetica is usually `Nimbus Sans`.
- Bundled web fonts: convert WOFF2 to TTF/OTF and `renderer.registerFont(bytes)`, or use an
  installed equivalent. Check that a weight actually renders (a missing weight falls back silently).
- `font-variant-numeric: tabular-nums`: use a mono family for aligned numbers.
- Missing glyphs (e.g. `⌫`) render as boxes: check symbols in the chosen font.
