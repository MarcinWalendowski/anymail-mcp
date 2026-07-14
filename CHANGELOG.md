# Changelog

All notable changes to AnyMail MCP are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- OAuth sign-in as an alternative to App Passwords.
- Microsoft 365 / Outlook provider (needs OAuth — basic-auth IMAP is being retired).
- Self-contained engine (bundled/compiled Node) + signed & notarized DMG + Homebrew.
- `npm`/`npx` distribution for the CLI/engine.

## [0.3.0] - 2026-07-14

### Added
- **"Create an App Password" assistant** in the menu-bar app's Add Account window.
  Instead of leaving you to find Google's settings, one button opens the App
  Passwords page in your own browser, or an AI agent can do it: the app copies a
  ready-to-run task prompt and opens **Claude for Chrome** (local — drives your own
  browser) or **ChatGPT / Claude.ai** (cloud). A **Paste** button drops the returned
  16-character code into the field for the normal verify → Keychain flow. The app
  never automates Google's page itself; cloud agents carry an inline full-mailbox
  exposure warning and are never the default. (GUI only.)
- **Add IMAP / custom accounts without the CLI** — a new `add_account` MCP tool
  (provider `gmail` | `icloud` | `fastmail` | `imap`, with host/port config for custom
  IMAP) and, in the app's Add Account window, a **provider picker** plus custom-IMAP
  host/port fields. The GUI keeps the password off the model (it goes straight to the
  local engine); the MCP tool carries a security caveat because the password is a tool
  argument.

### Fixed
- **Large bulk operations no longer fail on the client tool timeout.** Removing ops
  (trash / move / delete / empty) now act on up to `max` (default 2000) messages per
  call and return `{matched, affected, remaining, done}`; when `done:false`, re-run the
  same call to continue (acted messages leave the search scope, so it resumes cleanly,
  and `failed[]` still reports per-message errors). Flag ops (mark_all_read,
  bulk_modify_labels) stay uncapped. Fixes a real timeout on an ~8,400-message trash.

## [0.2.0] - 2026-07-14

### Added
- **Provider abstraction** — a `MailProvider` interface with Gmail behind it, plus a
  generic IMAP/SMTP provider for iCloud, Fastmail, or any host (`--provider icloud|fastmail|imap`).
  One agent can now span multiple providers. Non-Gmail search and threading are limited
  (experimental); Gmail behavior is unchanged.
- **Query-first bulk tools** — `mark_all_read`, `bulk_modify_labels`, `bulk_move`,
  `bulk_trash`, `bulk_delete`, `empty_spam`, `empty_trash`. Each takes `{query?, mailbox?,
  dryRun?, confirm?}` and acts on the whole matching set in one pass (chunked IMAP
  commands), instead of one tool call per message. `dryRun` returns the matched count +
  a sample; destructive or >100-message batches require `confirm:true`; partial failures
  are reported, never hidden. **Untested against live Gmail** — typecheck-green only.
- `DISTRIBUTION.md` + `scripts/make-dmg.sh` + a branded DMG background — the spec and
  tooling for shipping a notarized website download and the CLI channels (no App Store).

### Changed
- Account registry gains a `provider` field (defaults to `gmail`; existing accounts unaffected).

### Fixed
- **Single-message ops can now reach Spam & Trash.** Every Gmail mutation used to resolve
  the message only in All Mail, which excludes Spam/Trash — so acting on a message that
  lived only there failed with "not found". Ops now locate the message wherever it is
  (All Mail → Spam → Trash → Inbox) and act in that mailbox.
- **`delete` no longer reports false success.** Permanently deleting a Spam-only message
  used to return `{deleted:true}` without actually deleting it. It now deletes in place
  when already in Trash/Spam (where Gmail's EXPUNGE is real), otherwise moves to Trash and
  expunges there — and raises an error instead of claiming a delete that didn't happen.
  *(Behavior change to the shipped delete/trash paths; verified by typecheck, not yet live.)*

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

[Unreleased]: https://github.com/MarcinWalendowski/anymail-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/MarcinWalendowski/anymail-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/MarcinWalendowski/anymail-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/MarcinWalendowski/anymail-mcp/releases/tag/v0.1.0
