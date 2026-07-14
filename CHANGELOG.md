# Changelog

All notable changes to AnyMail MCP are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Provider abstraction** — a `MailProvider` interface with Gmail behind it, plus a
  generic IMAP/SMTP provider for iCloud, Fastmail, or any host (`--provider icloud|fastmail|imap`).
  One agent can now span multiple providers. Non-Gmail search and threading are limited
  (experimental); Gmail behavior is unchanged.
- `DISTRIBUTION.md` + `scripts/make-dmg.sh` + a branded DMG background — the spec and
  tooling for shipping a notarized website download and the CLI channels (no App Store).

### Changed
- Account registry gains a `provider` field (defaults to `gmail`; existing accounts unaffected).

### Planned
- OAuth sign-in as an alternative to App Passwords.
- Microsoft 365 / Outlook provider (needs OAuth — basic-auth IMAP is being retired).
- Self-contained engine (bundled/compiled Node) + signed & notarized DMG + Homebrew.
- `npm`/`npx` distribution for the CLI/engine.

## [0.1.0] - 2026-07-14

Initial public release.

### Added
- **Multi-account Gmail MCP engine** (Node/TypeScript) exposing full CRUD over
  IMAP/SMTP: `list_accounts`, `search_messages`, `get_message`, `get_thread`,
  `list_labels`, `get_attachment`, `send_message`, `create_draft`,
  `create_label`, `modify_labels`, `mark_read`, `mark_unread`, `star`, `unstar`,
  `archive`, `move_message`, `trash_message`, `delete_message`.
- **Two transports from one engine** — stdio (for stdio-only agents) and an
  always-on local HTTP server on `127.0.0.1:8765`.
- **CLI** for account management: `add`, `list`, `test`, `default`, `remove`,
  `install`, `token`.
- **macOS menu-bar app** (Swift/AppKit) — Add Account window, Install into
  Agents, Start at Login; supervises the engine as a child process.
- **One-click agent registration** for Claude Desktop, Claude Code, Cursor,
  VS Code, and Windsurf.
- **Security**: App Passwords stored only in the macOS Keychain; loopback-only
  bind; bearer-token auth on every request; Origin validation; per-account
  read-only mode; `confirm:true` gate on permanent delete; stderr logging with
  secret redaction.

[Unreleased]: https://github.com/MarcinWalendowski/anymail-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MarcinWalendowski/anymail-mcp/releases/tag/v0.1.0
