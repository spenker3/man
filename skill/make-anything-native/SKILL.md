---
name: make-anything-native
description: Build native GPU desktop apps in React with GPUIX (React/Solid rendered by Zed's GPUI through Rust, no Electron or web view), and convert web frontends (React, Electron, Vue, Svelte, plain HTML/CSS) into GPUIX apps. Use whenever writing or debugging GPUIX code (@gpuix/react, @gpuix/native), porting a web or Electron UI to a native app, or verifying a GPUIX app visually. Also use when asked to make an app "native", "GPU-rendered" or "GPUI" while writing React.
metadata:
  version: "1"
  gpuix: "0.11.0"
---

# MAN: Make Anything Native

GPUIX is a React renderer, not a transpiler. React runs in Bun or Node as usual, and
each commit becomes a batch of mutations sent over N-API to Rust. Rust keeps a retained
tree and rebuilds GPUI elements from it every frame. GPUI does layout (Taffy flexbox),
text, input and painting on Metal, Vulkan or DirectX. **Your JSX looks like React DOM
but nothing is DOM or CSS.** Most failures are silent: a wrong style does nothing, or one
bad value blanks the whole window.

Written against GPUIX **0.11.0**. GPUIX is pre-1.0; if the installed version differs, check
anything version-specific with `scripts/docs.ts`.

## Tools in this skill

Run them with Bun from the app's directory (paths are relative to this file):

| Script | Use it to |
|---|---|
| `scripts/docs.ts toc` / `section <heading>` / `grep <regex>` | Read the GPUIX README **for the installed version**. npm ships no docs, and the README on `main` describes newer APIs than 0.11 has. |
| `scripts/inventory.ts <source-dir>` | Before a conversion: list the elements, CSS features, browser APIs, Electron APIs and dependencies to handle, with the GPUIX answer for each. |
| `scripts/lint.ts <app-dir>` | After every batch of edits: catch the silent failures that `tsc` misses. Errors are real bugs. |
| `scripts/shoot.ts url <url>` / `app <entry>` | Screenshot the source web app (or a browser build of the GPUIX app) at a fixed size and theme, for comparison. |
| `scripts/grab.ts` | Linux/Hyprland: size your app's window on the agent workspace and capture exactly that window. |

The type definitions are the API reference that ships: `node_modules/@gpuix/native/dist/host.d.ts`
(`StyleDesc` lists every style prop) and `node_modules/@gpuix/react/dist/index.d.ts`.

## Setup

```bash
bunx @gpuix/cli new my-app          # or add to an existing project:
bun add --exact @gpuix/react@0.11.0 @gpuix/native@0.11.0 react@19.2.0
bun add -d --exact typescript @types/react @types/bun
```

- Pin `@gpuix/react` and `@gpuix/native` to the **same exact** version. React must satisfy the
  adapter's peer range (0.11.0 needs `^19.2.0`).
- `tsconfig.json` needs `"jsx": "react-jsx"` and `"jsxImportSource": "@gpuix/react"`. Without it
  TypeScript checks against DOM types and misses most mistakes. Run `bunx tsc --noEmit` often:
  it rejects shorthand strings like `padding: "0 16px"` and unknown props.
- End the entry file with `render(<App />, { title, width, height })`. Run with `bun --hot app.tsx`.

## The rules that bite (all seen in real conversions)

Layout and style:
1. **`div` is block, not flex.** `flexDirection`, `gap`, `alignItems`, `justifyContent` do nothing
   without `display: "flex"` (or `"grid"`).
2. **One invalid value rejects the whole mutation batch, silently.** The window goes black or stops
   updating; only stderr says `Batch op N setStyle parse error: invalid type ...`. Always run apps
   with stderr visible. Percent strings are only valid for `width`/`height`/`min*`/`max*`;
   `left: "40%"`, `marginTop: "auto"`, `flexBasis: "100%"` are invalid. Lengths are numbers in px.
3. **`lineHeight` is pixels**, not a multiplier. `lineHeight: 1.5` stacks lines on top of each other.
   GPUI's default leading is taller than CSS `1.5`, so set an explicit px `lineHeight` at the root
   to match the source's row heights (e.g. 14px × 1.5 → `21`).
4. **No CSS:** no classes, cascade, selectors, `var()`, `calc()`, rem/em/vh, `z-index` (tree order is
   paint order), `transform`, transitions or keyframes. See `references/css.md`.

Text:
5. **One string per `<text>`.** Mixed children (`<text>5-hour: {value}</text>`) render as separate runs
   that can wrap onto separate lines, and adjacent `<text>` siblings did not merge in practice,
   despite the README. Use a template string: `` <text>{`5-hour: ${value}`}</text> ``. For inline
   bold or links inside prose, use a wrapping flex row of word-level `<text>` (`references/recipes.md`).
6. **Give every `<text>` and `<svg>` an explicit `color`.** The README contradicts itself on
   inheritance; `<svg>` icons don't follow the parent's color.
7. **`fontFamily` must be one installed family name.** Font stacks and fontconfig aliases are not
   followed: `"Helvetica"` silently fell back to GPUI's default on Linux (it maps to `Nimbus Sans`
   there). Check names with `fc-list : family`. `registerFont()` takes TTF/OTF bytes, not WOFF2.

Components and overlays:
8. **No `<button>`, `<span>`, `<p>`, `<a>`, `<select>`, checkbox, radio, range.** Use `Button`, `Select`,
   `Combobox`, `Tooltip`, `Dialog` from `@gpuix/react`, or `<div onClick>` with `cursor: "pointer"`.
9. **`Tooltip` and `Select` roots wrap their children in a flex `div` with `alignItems: "start"`**, so a
   child can't stretch or grow. Pass a `style` to the Root (`alignSelf: "stretch"`, `flexGrow: 1`).
10. **`<anchored>` in a flex row anchors to its flow position.** Wrap it in an absolutely positioned
    box the size of the trigger. A **transparent full-window `<anchored>` paints the window black**;
    use a plain `position: "absolute"` layer as the last child of the root for toasts.
11. **`<input>` has no inner padding and puts text at the top of its box.** Give it an explicit
    height (control height − 2 × border) inside a padded wrapper, and `lineHeight`.
12. **Keyboard focus dims everything else by default** (`keyboardFocusDim`). Set it to `false` and
    use `focusVisible` styles to match a web app's focus rings.

Platform:
13. **0.11 has no system-appearance, clipboard, notification or native-dialog API, and one window.**
    Read light/dark from the OS (recipe), persist `localStorage` data to a JSON file, show errors
    in the window. Check `scripts/docs.ts grep clipboard` on newer versions.
14. **`bun build --compile` does not embed the renderer** (`Cannot find native binding`). Use the
    entry in `references/recipes.md` that embeds the `.node` file.

## Workflows

**Writing a new GPUIX app or feature:** set up as above, build in small steps, and after each step
run `bunx tsc --noEmit`, `bun scripts/lint.ts .`, and look at the result (Verify, below).

**Converting a web or Electron frontend:** read `references/convert.md` first. In short:
1. `bun scripts/inventory.ts <source>` and decide, before porting, what to do with every row marked
   `!` (unsupported). Write the decisions down; never drop a feature silently.
2. Screenshot the source at the target size in both themes (`scripts/shoot.ts url`).
3. Port tokens first (a theme object in JS), then the shell, then one screen at a time. Keep the
   source's data layer (API clients, state, pure logic): it runs unchanged.
4. Electron: move main-process work into the GPUIX process (`references/electron.md`).
5. Lint, typecheck and compare screenshots after each screen.

Vue, Svelte, Angular or plain HTML: port components to React function components first, then
follow the same steps (`references/convert.md`).

## Verify

Look at every screen you build. GPUIX gives no DevTools, and most mistakes only show in pixels.

- **macOS / Windows:** `launch()` from `@gpuix/react/automation` plus `app.screenshot()`, or the
  headless `createTestRoot()` for tests.
- **Linux:** live-window `screenshot()` and `createTestRoot()` are unavailable (no headless wgpu
  renderer yet). On Hyprland with the agent workspace set up, run the app normally (it opens on
  the invisible `AGENT` monitor) and capture it with `scripts/grab.ts`. Elsewhere, use the
  browser build: `scripts/shoot.ts app <entry>` (needs a browser-safe UI module).
- **Drive the app with automation**, not real input: `getByTestId`/`getByText` locators,
  `click`, `fill`, `hover`, `dragTo`. Give interactive elements a `testId`.
- **Always close what you launch** in a `finally`. Kill processes by the PID you started, never
  with `pkill -f <pattern>` (it matches your own shell).
- Automation reads bounds from the last paint: a window that isn't painting (hidden workspace,
  minimized) times out. Reset any state the app persists between runs.

Details and scripts: `references/verify.md`.

## References

- `references/convert.md`: the conversion procedure and how to handle each unsupported feature.
- `references/css.md`: CSS to GPUIX style mapping, themes, fonts, responsive layout.
- `references/electron.md`: replacing Electron's main process, IPC, windows, menus and dialogs.
- `references/recipes.md`: code for rich text, system theme, tooltips, image fit, toasts, compile.
- `references/verify.md`: automation, screenshots on each platform, side-by-side comparison.
