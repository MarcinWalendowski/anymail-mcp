# AnyMail MCP — menu-bar app

A thin Swift/AppKit menu-bar app over the Node engine in `../`. It:

- supervises the always-on engine (`node dist/index.js --http`),
- gives you a GUI to **connect Gmail accounts** (posts to the engine's admin API),
- **Install into Agents** (posts to `/admin/install`),
- **Start at Login** via `SMAppService`.

All Gmail/Keychain logic stays in the Node engine — the app never sees an App
Password (it posts it once to `127.0.0.1`, the engine stores it in the Keychain).

## Prerequisites

- macOS 13+ and **Xcode 15+**.
- **Node 18+** on the machine (Homebrew `/opt/homebrew/bin/node` or `/usr/local/bin/node`
  are auto-detected; nvm too).
- **XcodeGen**: `brew install xcodegen`.
- The engine built once:
  ```bash
  cd ..            # anymail-mcp/
  npm install && npm run build
  ```

## Build & run

```bash
cd app
xcodegen generate          # → AnyMailMCP.xcodeproj
open AnyMailMCP.xcodeproj     # set your Signing Team (Signing & Capabilities), then Run
```

Or headless:
```bash
xcodebuild -project AnyMailMCP.xcodeproj -scheme AnyMailMCP -configuration Release \
  -derivedDataPath build build
open "build/Build/Products/Release/AnyMail MCP.app"
```

On launch a mail icon appears in the menu bar. Use **Add Account…**, then
**Install into Agents**, then toggle **Start at Login**.

## Paths

The app finds the engine at (in order): a bundled `Resources/engine/dist/index.js`,
an override, or `~/loki-labs/anymail-mcp/dist/index.js` (the dev checkout). Node is
auto-detected. To override either:

```bash
defaults write com.lokilabs.AnyMailMCP nodePath   /opt/homebrew/bin/node
defaults write com.lokilabs.AnyMailMCP enginePath /ABS/PATH/anymail-mcp/dist/index.js
```

## Notes & caveats

- **Node is not bundled in v1** — the app runs your system node against the
  engine checkout (which has `node_modules`). To make a self-contained `.app`,
  copy `dist/` + `node_modules` into `Resources/engine/` at build time and point
  `enginePath` there.
- **Keychain prompt:** the first mail operation triggers "node wants to use your
  keychain" — click **Always Allow**. It's quiet afterward (stable node path).
- **Run-at-login** (`SMAppService`) needs a **signed** app; move `AnyMail MCP.app`
  to `/Applications` so the registration persists.
- **Not sandboxed** (it spawns node and writes agent configs). For distribution,
  codesign with your **Developer ID** and **notarize** — done on your machine;
  it can't be done in the coding-agent environment.
- Don't also run `node dist/index.js --http` by hand while the app is running —
  they'd both try to bind port 8765.
