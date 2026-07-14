# Distributing AnyMail MCP

The distribution model is **direct download from a website + GitHub Releases**,
the way Cursor, Rectangle, or Ollama ship — *not* the Mac App Store. MAS requires
the App Sandbox, which forbids the two things this app does by design: spawn a
`node`/engine child process and write other apps' MCP config files. So MAS is out;
everything below is the notarized-download path.

This is a **spec + TODO list**, ordered by what unblocks what. The one item that
makes "download and run" actually true for non-technical users is #1 — do it first.

---

## 1. Self-contained engine (the real blocker) 🚨

Today the menu-bar app runs the user's **system `node dist/index.js`**. A downloaded
app cannot assume Node is installed — that's the same "it doesn't just work" trap as
an unsigned app hitting Gatekeeper. The engine must ship *inside* the `.app`.

Two ways, pick one:

- [ ] **Option A — compile a single binary (recommended).** Produce a standalone
      `anymail-engine` executable and bundle it at `Resources/engine/anymail-engine`.
  - Bun: `bun build ./src/index.ts --compile --outfile anymail-engine`
  - or Node SEA (`--experimental-sea-config`) / `pkg`.
  - ⚠️ **Native addon caveat:** `@napi-rs/keyring` is a prebuilt `.node` binary. A
    compiled bundle usually can't inline it — copy the matching
    `keyring.darwin-*.node` next to the binary and confirm it loads at runtime on a
    clean Mac (no Node, no Homebrew). This is the step most likely to bite; test it
    on a fresh user account.
- [ ] **Option B — bundle Node + `dist/` + `node_modules`** into `Resources/engine/`
      and point `enginePath` there. Simpler, ~40 MB heavier, no compile step.
- [ ] Update `NodeLocator` / `EnginePaths` in the Swift app to prefer the bundled
      engine over a system Node (the lookup order already has a `Resources/engine`
      slot — see `app/BUILD.md`).
- [ ] Verify end-to-end on a Mac with **no Node installed**.

## 2. Code signing + notarization (required to open without warnings)

- [ ] Enroll in the **Apple Developer Program** (~$99/yr) → issue a
      **"Developer ID Application"** certificate. (Hardened Runtime is already on;
      the app is intentionally **not** sandboxed — see `app/GmailMCP/GmailMCP.entitlements`.)
- [ ] Create an **App Store Connect API key** (or app-specific password) for `notarytool`.
- [ ] Sign, notarize, staple — the pipeline:
      ```bash
      xcodebuild ... -configuration Release       # build "AnyMail MCP.app"
      codesign --deep --force --options runtime \
        --sign "Developer ID Application: <NAME> (<TEAMID>)" "AnyMail MCP.app"
      # (make the DMG — step 3 —) then notarize the DMG:
      xcrun notarytool submit "AnyMail MCP.dmg" \
        --key <AuthKey.p8> --key-id <KEYID> --issuer <ISSUER> --wait
      xcrun stapler staple "AnyMail MCP.dmg"
      ```
- [ ] Confirm `spctl -a -vvv "AnyMail MCP.app"` reports **accepted / Notarized Developer ID**.

## 3. The DMG (custom branded background) 🎨

- [ ] `brew install create-dmg` (and `librsvg` to rasterize the background).
- [ ] Background asset lives at **`assets/dmg-background.svg`** (in this repo); export
      to `@1x` (600×400) and `@2x` (1200×800) PNGs.
- [ ] Build the DMG with **`scripts/make-dmg.sh`** (in this repo): it lays out the app
      icon on the left, a **/Applications** drop-link on the right, an arrow between,
      the custom background, and the app icon as the volume icon.
- [ ] Sign the DMG with the same Developer ID, then notarize+staple (step 2).

The DMG window a user sees:

```
┌───────────────────────────────────────────────┐
│                AnyMail  MCP                     │
│                                                 │
│     ┌────┐                        ┌────┐        │
│     │📧  │   ──────drag──────▶    │📁  │        │
│     └────┘                        └────┘        │
│    AnyMail MCP                  Applications     │
└───────────────────────────────────────────────┘
```

## 4. Auto-update

- [ ] Integrate **Sparkle** (appcast `appcast.xml` + EdDSA-signed updates) so the app
      updates itself instead of the user re-downloading. Host the appcast + DMGs on
      GitHub Releases (or a small static site).

## 5. Homebrew (optional, popular)

- [ ] **Cask** for the app → `brew install --cask anymail-mcp` (points at the notarized
      DMG on the latest GitHub Release). Ship via a tap repo (`homebrew-anymail`) first;
      submit to `homebrew-cask` once there's adoption.
- [ ] **Formula** for the CLI (below).

## 6. CLI distribution (the no-GUI path)

The engine is also the CLI — advanced users don't need the app at all:

- [ ] **npm**: set `"private": false` in `package.json`, then `npm publish` →
      `npx anymail-mcp add you@gmail.com` / `npm i -g anymail-mcp`.
- [ ] **Standalone CLI binary**: the same compiled binary from step 1, attached to each
      GitHub Release for people without Node.
- [ ] **One-line installer**: `curl -fsSL https://<host>/install.sh | sh` that downloads
      the right binary for the arch and drops it on `PATH`.
- [ ] **Homebrew formula** (step 5).

## 7. Download page

- [ ] A minimal landing page (GitHub Pages is enough): a **"Download for macOS"** button
      linking to the latest release DMG, plus the `npx` / `brew` one-liners for the CLI,
      and the App-Password setup note. Detect Apple-Silicon vs Intel if shipping both.

## 8. Release automation (CI)

- [ ] A **macOS GitHub Actions** workflow, triggered on `v*` tags, that: builds the
      engine binary, builds + signs the app, makes + signs the DMG, notarizes + staples,
      and uploads the DMG + CLI binary to the GitHub Release. Requires repo secrets you
      provide: base64 **Developer ID** cert + password, and the **notarytool** API key.
      (This can't run here — no Apple account, no signing secrets.)

---

## Consolidated checklist

**Engine** ☐ compile/bundle a self-contained engine ☐ bundle `@napi-rs/keyring` `.node`
☐ prefer bundled engine in the Swift locator ☐ verify on a Node-less Mac
**Signing** ☐ Developer ID cert ☐ notarytool key ☐ sign+notarize+staple ☐ `spctl` passes
**DMG** ☐ export background PNGs ☐ `make-dmg.sh` ☐ sign+notarize DMG
**Update** ☐ Sparkle appcast
**CLI** ☐ `npm publish` ☐ standalone binary ☐ `install.sh` ☐ Homebrew formula
**Distribution** ☐ Homebrew cask ☐ download page ☐ tag-driven CI release

See [`RELEASING.md`](RELEASING.md) for the version-bump/tag/release flow this plugs into.
