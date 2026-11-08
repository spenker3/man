<div align="center">

# MAN: Make Anything Native

### An agent skill for building native GPU desktop apps in React, and for converting web and Electron frontends into them.

**Agents write React well and Rust UI code badly. MAN has them write React that runs natively on the GPU.**

[What it does](#what-it-does) · [Install](#install) · [Use it](#use-it) · [How it works](#how-it-works) · [What it works for](#what-it-works-for) · [Limits](#limits)

</div>

---

## What it does

[GPUIX](https://github.com/remorses/gpuix) renders React (or Solid) with
[GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui), the GPU UI framework that
draws the Zed editor. Layout, text, input and painting run in Rust on Metal, Vulkan or DirectX.
There's no Electron, no Chromium and no web view, so the app is far lighter than Electron and
paints like a native app.

The catch is that GPUIX JSX looks like React DOM but almost nothing from the web carries over.
There's no CSS, `div` isn't flex, `lineHeight` is in pixels, and font stacks don't resolve. Worst,
most mistakes fail silently: a wrong style does nothing, and one bad value blanks the whole
window. An agent that knows React but not GPUIX spends most of its time finding these out.

MAN is the knowledge and tooling an agent needs to get it right the first time:

- **The rules that bite.** Fourteen pitfalls, each one hit in a real conversion or verified
  against the installed GPUIX, with the fix.
- **A conversion procedure** for React and Electron apps, and for Vue, Svelte or plain HTML via
  React. It includes a mapping for every DOM element, CSS feature, browser API and Electron API,
  with a decision for each thing GPUIX can't do: rebuild it, render it to an image, write a Rust
  custom element, or drop it on purpose.
- **Recipes** that worked in practice: inline rich text, following the system light/dark theme,
  toasts, tooltips that stretch, persisted state, and a single-binary build.
- **Five scripts** that make the work checkable:

| Script | What it does |
|---|---|
| `docs.ts` | Reads the GPUIX README for the *installed* version. npm ships no docs, and the README on `main` describes APIs that releases don't have yet. |
| `inventory.ts` | Scans a source project and lists everything a conversion has to handle, with the GPUIX answer for each and a `!` on what GPUIX can't do. |
| `lint.ts` | Catches the silent failures that `tsc` misses: invalid style values, flex props on block divs, pixel `lineHeight`, DOM tags, `className`, font stacks, mixed text runs, leaked test windows. It reads the valid style props from the installed GPUIX. |
| `shoot.ts` | Screenshots the source web app, or a browser build of the GPUIX app, in headless Chromium at a fixed size and theme. It can click through the app first with GPUIX's automation API and forward API calls to a local server. |
| `grab.ts` | Linux/Hyprland: captures the app's real GPU window at an exact size from an invisible agent monitor, so verification never touches your screen. |

## Install

Requirements: [Bun](https://bun.sh) 1.2 or later. `shoot.ts` needs Chromium or Chrome, and
`grab.ts` needs Hyprland and `grim`.

```bash
git clone https://github.com/skadooodle/man ~/man
```

The skill is the folder `skill/make-anything-native/`: a `SKILL.md` with frontmatter, plus
`references/` and `scripts/`. It works with any coding agent that can read files and run commands.

**Claude Code** loads it as a skill:

```bash
mkdir -p ~/.claude/skills
ln -s ~/man/skill/make-anything-native ~/.claude/skills/make-anything-native
```

**Other agents with skills support** (the `SKILL.md` format): link or copy the same folder into
that agent's skills directory.

**Any other agent:** add this to the project's `AGENTS.md` (or the agent's rules file):

```markdown
When building a native desktop app, writing GPUIX code (@gpuix/react), or converting a web or
Electron frontend to native, first read ~/man/skill/make-anything-native/SKILL.md and follow it.
Its references/ and scripts/ paths are relative to that file.
```

`lint.ts` installs its own pinned TypeScript the first time it runs.

### Optional: an invisible agent monitor (Hyprland)

The agent's test windows can open on a headless monitor instead of your screen, where `grab.ts`
captures them. Set this up with
[`extras/hyprland/agent-workspace.lua`](extras/hyprland/agent-workspace.lua) (Hyprland 0.56+, Lua
config):

1. Put it in `~/.config/hypr/` and add `require("hypr.agent-workspace")` to `hyprland.lua`.
2. Give the agent `AGENT_WORKSPACE=1` in its environment. For Claude Code, set
   `"env": { "AGENT_WORKSPACE": "1" }` in `~/.claude/settings.json`. For other agents, start them
   with the variable set, e.g. `AGENT_WORKSPACE=1 codex`.

Every process the agent starts inherits the variable, and the module moves their windows to the
agent monitor without taking focus. `SUPER + ALT + A` shows that monitor on your screen. The
module uses Omarchy's `o.bind` for the keybinding; outside Omarchy, swap it for `hl.bind`.

## Use it

Ask for a native app, or a conversion, the way you normally would. Agents with skills support load it
when the task involves GPUIX or making a web UI native:

```text
Build a native desktop markdown notes app with a sidebar and search.

Convert ~/code/dashboard (Vite + React) into a native GPUIX app. Keep the look, both themes.

Replace the Electron shell in ~/code/myapp with GPUIX. The renderer is React in web/,
main.cjs spawns our API server.
```

For a conversion, the agent:

1. Runs `inventory.ts` on the source and writes down a decision for everything GPUIX can't
   express, before writing any code.
2. Screenshots the source screens at the target size, in both themes.
3. Copies the data layer unchanged (API clients, stores, pure logic), then ports the design
   tokens, a small set of primitives, the shell, and one screen at a time.
4. After each screen, runs `tsc` and `lint.ts`, captures the app, compares it with the source
   screenshot, and drives the interactions with GPUIX's automation API.
5. Delivers a `CONVERSION.md` that lists what changed and what was dropped, and why.

You can run the scripts yourself too:

```bash
S=~/man/skill/make-anything-native/scripts
bun $S/inventory.ts ~/code/dashboard          # what a conversion involves
bun $S/lint.ts .                              # from a GPUIX app's directory
bun $S/docs.ts section "Virtual lists"        # docs for the installed GPUIX version
bun $S/shoot.ts url http://localhost:5173 --out ref.png --size 1280x800 --theme dark
```

## How it works

GPUIX is a React renderer, not a transpiler. Your components run as normal JavaScript in Bun or
Node. Each React commit becomes a batch of mutations sent over N-API to Rust, which keeps a
retained tree and rebuilds GPUI elements from it every frame:

```
React components (Bun or Node)
   │  commit → [["createElement", 7, "div"], ["setStyle", 7, {...}], ...]
   ▼  one applyBatch() call over N-API
Rust retained tree ──► every frame: GPUI elements ──► Taffy layout ──► Metal / Vulkan / DirectX
   ▲
   └── clicks and keys go back to JS handlers by element id
```

Scrolling, animation (`motion.div`), text input and painting stay in Rust. JavaScript runs only
when state changes. Compared with hand-written Rust GPUI, you pay for a JS runtime (tens of MB),
a second copy of the tree, and one GPUI view for the whole window. Compared with Electron, you
drop Chromium entirely.

MAN sits on the agent's side of that stack. `SKILL.md` gives the model, setup and rules up front.
The `references/` files load only when a task needs them (`convert`, `css`, `electron`,
`recipes`, `verify`), and the scripts turn "it typechecks" into "it renders correctly and matches
the source".

### Verification

GPUIX has no DevTools, so the skill makes the agent look at every screen:

- **macOS and Windows:** GPUIX's own `app.screenshot()` and headless test renderer.
- **Linux:** those aren't available yet. On Hyprland, the agent runs the app on an invisible
  headless monitor and captures it with `grab.ts`. Elsewhere, `shoot.ts` renders the browser build
  (the same Rust renderer compiled to Wasm) in headless Chromium.
- **Interactions** go through GPUIX's Playwright-style automation (`getByTestId`, `click`, `fill`,
  `dragTo`), never through the real mouse or keyboard.

### Where the rules come from

The rules come from test conversions of two real apps, run by agents with no skill: a CSS-heavy
React design-system site and an Electron app that spawns its own server. Between them the agents
hit about 38 problems and spent most of their time on things nobody had written down. Every rule
in `SKILL.md` traces back to one of those runs, or to a check against the installed GPUIX version.

## What it works for

| Source | Support |
|---|---|
| React (Vite, CRA, Next client pages) | Primary. Components, hooks and state carry over; the markup and styles are rewritten. |
| Electron | Primary. The renderer converts like React; main-process work moves into the GPUIX process, so there's no IPC. |
| Vue, Svelte, Angular | Port components to React first; the skill gives the mapping. |
| Plain HTML/CSS/JS | Each page becomes a component; DOM code becomes state. |
| Solid | GPUIX has a Solid adapter (`@gpuix/solid`). |

Target platforms are whatever GPUIX ships prebuilt: macOS arm64, Linux x64, and Windows x64/arm64.
It was developed and tested on Linux (Hyprland, Intel Vulkan).

Good fits: tools, dashboards, chat and mail clients, editors for structured data, settings-heavy
apps, and most things people build with Electron. Plain Rust GPUI still wins for very large or
very fast-changing UIs, such as code editors or huge live grids, and where memory or binary size
is tight.

## Limits

- Written against **GPUIX 0.11.0**. GPUIX is pre-1.0 and changes quickly. Version-specific advice
  is marked, and `docs.ts` always reads the installed version's docs.
- Some web features have no GPUIX equivalent yet: `canvas`, iframes, video, transforms and
  rotation, `z-index`, nested vertical scrolling, a system-theme API, clipboard and native dialogs
  in 0.11. The skill says what to do instead; it can't make them exist.
- `grab.ts` and the invisible agent monitor are Hyprland-specific. Elsewhere on Linux, use
  `shoot.ts` with the browser build.

## Roadmap

- **Phase 1 (this release):** writing GPUIX apps and converting web and Electron frontends.
- **Phase 2:** use a working GPUIX app as the spec and visual proof for an agent-written port to
  plain Rust GPUI, for apps that outgrow the JS layer.

## License

[MIT](LICENSE). GPUIX and GPUI are separate projects with their own licenses.
