# Releasing AnyMail MCP

AnyMail MCP follows [SemVer](https://semver.org). Releases are cut manually — there
is no CI that builds or signs the macOS app, because notarization needs an Apple
Developer account and macOS runners that aren't wired up here.

## Cut a release

1. **Bump the version** in all three places so they agree:
   - `package.json` → `version`
   - `app/project.yml` → `MARKETING_VERSION`
   - `app/project.yml` → `CURRENT_PROJECT_VERSION` (integer build number, +1)
2. **Update `CHANGELOG.md`** — move items out of `[Unreleased]` into a new
   dated `## [x.y.z]` section, and update the compare/tag links at the bottom.
3. **Verify** the engine: `npm install && npm run build && npm run typecheck`.
4. **Commit** (`release: vX.Y.Z`), then **tag**:
   ```bash
   git tag -a vX.Y.Z -m "AnyMail MCP vX.Y.Z"
   git push origin main --tags
   ```
5. **Publish GitHub release notes:**
   ```bash
   gh release create vX.Y.Z --title "AnyMail MCP vX.Y.Z" --notes-file <(sed -n '/## \[X.Y.Z\]/,/## \[/p' CHANGELOG.md)
   ```
   (or paste the changelog section into the release UI).

## Distribution channels

Current and planned ways users get AnyMail MCP:

| Channel | Status | Notes |
|---------|--------|-------|
| Clone + `npm run build` | ✅ now | The Track A path in the README. |
| GitHub Release (source) | ✅ now | Tag + release notes, as above. |
| Signed & notarized `.dmg` | ⏳ roadmap | Needs an Apple Developer ID + `xcrun notarytool`; build & notarize on a Mac, then attach the `.dmg` to the GitHub release. |
| Homebrew | ⏳ roadmap | A formula for the CLI/engine and/or a cask for the notarized app. |
| `npm` / `npx` | ⏳ roadmap | Set `"private": false` in `package.json`, then `npm publish`. |
| Mac App Store | ❌ not planned | MAS requires the App Sandbox, which forbids spawning a `node` child process and writing other apps' MCP configs — core to how AnyMail MCP works. |

## Notarizing the macOS app (when doing the DMG channel)

On a Mac with an Apple Developer account:

```bash
cd app && xcodegen generate
xcodebuild -project AnyMailMCP.xcodeproj -scheme AnyMailMCP -configuration Release \
  -derivedDataPath build build
# codesign with Developer ID, staple, and notarize:
xcrun notarytool submit "AnyMail MCP.dmg" --apple-id <id> --team-id <team> --wait
xcrun stapler staple "AnyMail MCP.dmg"
```

Then attach `AnyMail MCP.dmg` to the GitHub release.
