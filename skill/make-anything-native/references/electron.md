# Replacing Electron

An Electron app has two halves. The renderer (React in a web page) converts like any web
frontend. The main process (Node) moves **into the GPUIX process itself**: GPUIX runs on Bun or
Node, so there is one process with full Node access and no IPC.

## Main process → GPUIX process

| Electron | GPUIX |
|---|---|
| `ipcMain.handle(ch, fn)` + `ipcRenderer.invoke(ch)` + preload `contextBridge` | a plain module exporting `fn`; components import and call it |
| `BrowserWindow({ width, height, minWidth, backgroundColor, title })` | `render(<App />, { title, width, height, ... })`; check `scripts/docs.ts section "Window"` for options |
| `nativeTheme.shouldUseDarkColors` | OS appearance (recipe in `recipes.md`) |
| `shell.openExternal(url)` | `spawn("xdg-open" / "open" / "cmd /c start", [url], { detached: true, stdio: "ignore" })` |
| `dialog.showOpenDialog` | `renderer.promptForPaths({ files, directories, multiple })` |
| `dialog.showErrorBox`, `showMessageBox` | 0.11 has no native dialogs and one window: render an error screen in the window (with Quit) |
| `Menu.setApplicationMenu` | macOS menu bar: `scripts/docs.ts section "menu bar"`; on Linux/Windows Electron menus are usually hidden, so drop or move to in-app UI |
| `app.requestSingleInstanceLock()` | a lock file or socket under `$XDG_RUNTIME_DIR`; hand off to the first instance and exit |
| `app.getPath("userData")` | `$XDG_CONFIG_HOME/<app>` / `~/Library/Application Support/<app>` / `%APPDATA%\<app>` |
| `app.on("before-quit")`, child process cleanup | `process.on("exit")` / signal handlers; spawn children with pipes so they die with the app |
| `electron-store` | JSON file in the config dir |
| `autoUpdater` / `electron-updater` | `checkUpdate()` from `@gpuix/native` + cargo-packager (`scripts/docs.ts section "Auto-update"`) |
| `electron-builder` | `bun build --compile` (with the `.node` embedding entry from `recipes.md`) + cargo-packager |
| `webContents`, `session`, cookies | not needed: `fetch` with explicit headers |

## Spawning a backend

Keep the same contract as the Electron main process: reuse a server already on the port (health
check), otherwise spawn it with `stdio: ["pipe", "pipe", "pipe"]`, keep the last few KB of its
output for the error screen, and kill it on exit. Login-shell `PATH` (for CLIs the backend calls)
can be read with `$SHELL -ilc 'printf %s "$PATH"'`, as Electron apps often do.

Never point a test run at the user's real data: copy the data directory and set the app's
data-dir variable, and stub anything that spends money (model CLIs, paid APIs).

## Renderer-side Electron APIs

`window.electron.*` / `window.api.*` bridges become direct imports of the moved main-process
module. `process.platform` checks keep working. Remove `contextIsolation` workarounds.
