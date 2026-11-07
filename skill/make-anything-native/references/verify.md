# Verifying a GPUIX app

Check three things after each screen: it typechecks and lints, it looks right next to the
reference, and its interactions work when driven by automation.

## Static checks

```bash
bunx tsc --noEmit
bun <skill>/scripts/lint.ts .
```

Run the app with stderr visible. `Batch op N setStyle parse error` means a style value was
rejected, and the whole batch with it.

## Automation

Give interactive elements a `testId`. The same locator API works headless, in a live window and
in a browser build:

```ts
import { launch } from '@gpuix/react/automation'

const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1' } })
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await app.getByTestId('composer').fill('hello')
  await app.getByText('Send').click()
  await app.getByText('hello').waitFor()
} finally {
  await app.close()   // always: a throw before close() leaves the window open
}
```

- Map `GPUIX_BACKGROUND=1` to `render(..., { focus: false })` in the entry (ignored on Linux).
- `clock.pause()` / `clock.fastForward(ms)` make motion deterministic before a screenshot.
- Bounds come from the last painted frame: a window that isn't painting times out.
- Kill only the PIDs you started. `pkill -f`/`pgrep -f` patterns match your own shell command.
- Reset files the app persists (remembered tab, course) at the start of each run.

## Screenshots by platform

| Platform | Live window | Headless |
|---|---|---|
| macOS, Windows | `app.screenshot({ path })` | `createTestRoot()` + `connectTest(renderer)` |
| Linux + Hyprland agent workspace | `scripts/grab.ts --pid <pid> --out x.png --size WxH` | none yet |
| Linux, other | `scripts/shoot.ts app <entry>` (browser build) | none yet |

**Linux with the agent workspace.** Apps launched by an agent whose environment has
`AGENT_WORKSPACE=1` open on the invisible `AGENT` monitor, so they never cover the user's screen and always keep painting.
`grab.ts` finds the window of your PID (or its children), floats it at the exact size, and
captures only that window. It refuses windows on any other workspace. `grim -o AGENT` captures
the whole agent monitor.

**Browser build** (`shoot.ts app`): the same Rust renderer compiled to Wasm, rendered by headless
Chromium. The UI module must not import Node-only modules (`fs`, `child_process`, `bun:*`): keep
those in the native entry and pass data in. `--proxy /api=http://127.0.0.1:PORT` serves an API
same-origin; `--do "await gpuix.getByText('Forms').click()"` drives it before the shot.

## Comparing with the source

1. `shoot.ts url <source-url> --out ref.png --size WxH --theme light|dark` for the source.
2. Capture the GPUIX app at the same logical size and theme.
3. Read both images and list the differences: spacing, row heights (check `lineHeight`), font
   (check the family resolved), colors per theme, alignment, missing elements. Fix, recapture.

Match the scale too: the source captured at device scale 1.25 is not comparable with a window
capture at 1.
