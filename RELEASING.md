# Releasing AnyMail MCP

AnyMail MCP follows [SemVer](https://semver.org). Releases are cut manually on a Mac:
the universal DMG is built locally with `npm run app:dmg` and attached to a GitHub
Release. There is no tag-driven CI that builds or signs the app yet (notarization
needs an Apple Developer account and signing secrets), so the steps below are the
whole flow. The full distribution design is in [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md).

## Cut a release

1. **Bump the version** in all four places so they agree:
   - `package.json` → `version`
   - `src/mcp/server.ts` → the `McpServer({ version })` string. This is what the
     engine reports to agents in `initialize`, so a stale value misreports the
     running build. Easy to miss; check it.
   - `app/project.yml` → `MARKETING_VERSION` (Apple requires one-to-three integers
     here, so a pre-release suffix like `-rc.3` lives in `package.json` and the tag,
     not in this field).
   - `app/project.yml` → `CURRENT_PROJECT_VERSION` (integer build number, +1).
2. **Update `CHANGELOG.md`**: move items out of `[Unreleased]` into a new dated
   `## [x.y.z]` section, and update the compare/tag links at the bottom.
3. **Verify** the engine: `npm ci && npm run build && npm run typecheck`.
4. **Build the DMG** (universal, ad-hoc signed):
   ```bash
   npm run app:dmg      # → AnyMail-MCP-<version>-universal.dmg
   ```
   To ship a **notarized** DMG instead, set `DEVELOPER_ID` (and notarytool
   credentials) first; the pipeline switches paths automatically. See
   [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md).
5. **Commit** (`release: vX.Y.Z`), then **tag**:
   ```bash
   git tag -a vX.Y.Z -m "AnyMail MCP vX.Y.Z"
   git push origin main --tags
   ```
6. **Publish the GitHub Release** with the DMG attached. Write the notes into a file
   (see the template below), then:
   ```bash
   gh release create v0.0.1-rc.3 --prerelease --title "v0.0.1-rc.3" \
     --notes-file notes.md \
     AnyMail-MCP-0.0.1-rc.3-universal.dmg
   ```
   Drop `--prerelease` once the version is stable (no `-rc` / `-beta` suffix). For a
   final release you can generate the notes straight from the changelog instead:
   ```bash
   gh release create vX.Y.Z --title "AnyMail MCP vX.Y.Z" \
     --notes-file <(sed -n '/## \[X.Y.Z\]/,/## \[/p' CHANGELOG.md) \
     AnyMail-MCP-X.Y.Z-universal.dmg
   ```

## Release-notes template

Keep it short. Highlights first (what a user cares about), then the changelog section
verbatim, then the install + Gatekeeper note, then known limitations.

```markdown
## Highlights
- <the one or two things worth downloading this build for>

## Changes
<paste the dated CHANGELOG section for this version>

## Install
Download `AnyMail-MCP-<version>-universal.dmg` below (one universal build for Apple
Silicon and Intel, Node is bundled, no prerequisites). Open it and drag **AnyMail MCP**
to Applications. The build is ad-hoc signed and not yet notarized, so the first launch
is blocked: open **System Settings > Privacy & Security**, scroll to the "AnyMail MCP
was blocked" notice, and click **Open Anyway**.

CLI only: `git clone https://github.com/MarcinWalendowski/anymail-mcp.git && cd anymail-mcp && ./scripts/setup-cli.sh`

## Known limitations
- Not notarized yet, so the first launch needs the Gatekeeper "Open Anyway" step.
- macOS re-shows the Keychain "Always Allow" prompt after each app update while builds
  are ad-hoc signed (a Developer ID signature will end that).
- <anything version-specific, e.g. Intel slice not runtime-verified>
```

## Distribution channels

Current and planned ways users get AnyMail MCP:

| Channel | Status | Notes |
|---------|--------|-------|
| Clone + `./scripts/setup-cli.sh` | ✅ now | The CLI path in the README. Runs on macOS, Windows, Linux. |
| Universal DMG (ad-hoc signed) | ✅ now | Built with `npm run app:dmg`, attached to the GitHub Release. First launch needs the Gatekeeper "Open Anyway" step. |
| Signed & notarized DMG | ⏳ roadmap | Same pipeline with `DEVELOPER_ID` set; needs an Apple Developer ID + `xcrun notarytool`. Then the app opens on a double-click. |
| Homebrew | ⏳ roadmap | A formula for the CLI/engine and/or a cask for the notarized app. |
| `npm` / `npx` | ⏳ roadmap | Set `"private": false` in `package.json`, add `"files": ["dist"]`, then `npm publish`. |
| Mac App Store | ❌ not planned | MAS requires the App Sandbox, which forbids spawning a `node` child process and writing other apps' MCP configs, core to how AnyMail MCP works. |

The signing, notarization, and CI-release details for the roadmap channels live in
[`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md).
