# AnyMail MCP — menu-bar app

A thin Swift/AppKit menu-bar app over the Node engine in `../`. It:

- supervises the always-on engine (`node dist/index.js --http`),
- gives you a GUI to **connect mail accounts** — Gmail, iCloud, Fastmail or a custom
  IMAP host (posts to the engine's admin API),
- **Install into Agents** (posts to `/admin/install`),
- **Start at Login** via `SMAppService`.

All mail/Keychain logic stays in the Node engine — when you add an account through the
form, the app never sees the App Password in a way any model can (it posts it once to
`127.0.0.1`, and the engine stores it in the Keychain).

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

## The Add Account window

Two ways to get an App Password, both under the form:

- **Do it yourself** — opens the provider's page; paste the code into the field. The
  password goes straight to the local engine → Keychain, so no model ever sees it.
- **Copy Prompt** — one prompt you paste into any agent. It creates the App Password
  *and* registers the account with the `add_account` MCP tool, so nothing has to be
  typed back. The trade is privacy: the password becomes a tool-call argument, so it
  passes through the model's context and the client's logs. The window says so inline.

The app never automates a provider's page itself.

`AppPasswordPrompt` is deliberately pure and AppKit-free, so the prompt can be checked
without opening the window:

```bash
cd app
cat > /tmp/pp.swift <<'EOF'
for p in ["gmail", "icloud", "fastmail", "imap"] {
    print(AppPasswordPrompt.text(provider: p, email: "you@example.com"), "\n")
}
EOF
mv /tmp/pp.swift /tmp/main.swift
swiftc AnyMailMCP/AppPasswordPrompt.swift /tmp/main.swift -o /tmp/promptcheck && /tmp/promptcheck
```

(Top-level statements only compile in a file named `main.swift` — hence the `mv`.)

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
