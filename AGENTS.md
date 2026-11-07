# MAN: Make Anything Native

An agent skill (`make-anything-native`) for building native GPU desktop apps with
[GPUIX](https://github.com/remorses/gpuix) (React/Solid rendered by Zed's GPUI) and converting web
and Electron frontends into GPUIX. Agents write React well and raw GPUI poorly; GPUIX keeps React
as the source while GPUI does layout, text, input and painting in Rust.

## Layout
- `skill/make-anything-native/`: the skill itself.
  - `SKILL.md`: the entry point, with the model, setup and the rules that bite. Keep it short; detail goes in references.
  - `references/`: convert, css, electron, recipes and verify, loaded only when a task needs them.
  - `scripts/`: Bun tools (docs, inventory, lint, shoot, grab). `scripts/package.json` pins TypeScript 5.9 for `lint.ts`, because TS 7 has no JS compiler API. lint installs it on first run.
- `extras/hyprland/agent-workspace.lua`: an optional Hyprland module that sends agent-launched windows to a headless monitor.

## Rules for changing the skill
- Every rule or recipe must come from an observed failure in a real GPUIX app, or be verified against the installed GPUIX (`node_modules/@gpuix/native/dist/host.d.ts`, `scripts/docs.ts`). No guesses.
- GPUIX is pre-1.0. Mark version-specific claims with the version they were checked on (currently 0.11.0), and update `metadata.gpuix` in `SKILL.md` when re-verifying.
- Keep the skill agent-neutral: no wording that assumes one agent. Agent-specific setup belongs in the README.
- Scripts read from the installed GPUIX where possible (lint takes style props from `host.d.ts`), so they follow version changes.

## Testing
- Test changes in isolation and cheaply: a small fixture for `lint.ts` (one line per bug, plus one correct line that must pass), a single self-closing probe window for `grab.ts`, and one URL for `shoot.ts`. Run `lint.ts` on a known-good GPUIX app to check for false positives.
- Full agent conversions are the real test but are expensive; run them only for substantial changes.
- Scaffold a GPUIX app to test against with `bunx @gpuix/cli new <dir>`.

## GPUIX on Linux
- Live-window `screenshot()` and the headless `createTestRoot()` are macOS/Windows only (no headless wgpu renderer yet), so native vitest tests skip.
- The browser build renders in headless Chromium through WebGL2 (`scripts/shoot.ts app`); the WebGPU flags produced blank images.
- GPUIX ignores `focus: false` on Linux, so test windows take focus unless something like the Hyprland module moves them away.
