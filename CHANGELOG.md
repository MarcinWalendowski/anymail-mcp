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

## [0.0.1-rc.2] - 2026-07-15

### Changed — BREAKING
- **`gmMsgId` → `id`, `gmThrId` → `threadId`** across every tool's input and output.
  The engine serves iCloud, Fastmail and generic IMAP as well as Gmail, but the schema
  still named its ids after Gmail's `X-GM-MSGID` / `X-GM-THRID` — on a non-Gmail
  account the id is really folder+uidvalidity+uid. The fields were always documented
  as opaque and provider-defined; now they're named that way, matching what the code
  calls them internally and what Gmail's own API calls them.

  `get_message` and friends now take `{id}`; `get_thread` takes `{threadId}`. Note
  `id` is **not** `messageId` — the latter is still the RFC822 Message-ID header, and
  both appear on a message summary. Any agent that hardcoded the old field names must
  be updated; agents reading the schema each session need no change.

## [0.0.1-rc.1] - 2026-07-15

**First release candidate.** The earlier `v0.1.0`–`v0.3.0` tags and releases have been
withdrawn and the version reset: this project is pre-1.0, the public version history
restarts here, and interfaces may still change without notice. Everything below is the
current feature set, not a diff against a withdrawn build.

### Added
- **Multi-account, multi-provider email MCP engine** (Node/TypeScript), exposing full
  CRUD over IMAP/SMTP to any MCP client. One agent session can span several mailboxes
  across different providers; every tool takes an optional `account`.
- **Providers** — Gmail (labels, threads, native `X-GM-RAW` search) plus a generic
  IMAP/SMTP provider for **iCloud**, **Fastmail**, or any host
  (`--provider icloud|fastmail|imap`, with custom host/port). Non-Gmail accounts are
  folder-based: no labels, no server-side threads, text-only search. `list_accounts`
  reports each account's provider so an agent can tell which rules apply.
- **Per-message tools** — `list_accounts`, `search_messages`, `get_message`,
  `get_thread`, `list_labels`, `get_attachment`, `send_message`, `create_draft`,
  `create_label`, `modify_labels`, `mark_read`, `mark_unread`, `star`, `unstar`,
  `archive`, `move_message`, `trash_message`, `delete_message`, `add_account`.
- **Query-first bulk tools** — `mark_all_read`, `bulk_modify_labels`, `bulk_move`,
  `bulk_trash`, `bulk_delete`, `empty_spam`, `empty_trash`. Each takes
  `{query?, mailbox?, dryRun?, confirm?, max?}` and acts on the whole matching set in
  one pass instead of one call per message. `dryRun:true` previews the count and a
  sample; destructive or >100-message batches require `confirm:true`; partial failures
  are reported, never hidden. Spam and Trash are reachable via `mailbox`.
- **Resumable bulk** — removing ops (trash / move / delete / empty) act on up to `max`
  (default 2000) messages per call and return `{matched, affected, remaining, done}`;
  when `done:false`, re-run the same call to continue. Keeps a 10k-message sweep under
  the client's tool timeout.
- **Two transports from one engine** — stdio, and an always-on local HTTP server on
  `127.0.0.1:8765`.
- **CLI** for account management: `add`, `list`, `test`, `default`, `remove`,
  `install`, `token`. `install` registers the server into Claude Desktop, Claude Code,
  Cursor, VS Code and Windsurf.
- **macOS menu-bar app** (Swift/AppKit) — supervises the engine, with an Add Account
  window (provider picker + custom IMAP host/port), Install into Agents, and Start at
  Login. The App Password never reaches the model: it is posted to the local engine,
  which stores it in the Keychain.
- **"Create an App Password" assistant** in the app — opens the provider's page in your
  own browser, or hands the task to a local (Claude for Chrome) or cloud
  (ChatGPT / Claude.ai) agent. It never automates the provider's page itself; cloud
  options carry an inline full-mailbox exposure warning and are never the default.
- **Security** — App Passwords only in the macOS Keychain; loopback-only bind;
  bearer-token auth on every request; Origin validation (DNS-rebinding defense);
  per-account read-only mode; `confirm:true` gate on permanent delete; stderr logging
  with secret redaction.

### Note for anyone running a withdrawn 0.1–0.3 build
The stored identifiers were renamed from `gmail-mcp` to `anymail-mcp`, so an upgrade
will not find your existing accounts or App Passwords. To carry them over:

```bash
mv ~/.gmail-mcp ~/.anymail-mcp   # keeps accounts.json + your local server token
```

Then re-add each account (`anymail-mcp add <email>`) to write its App Password under
the new Keychain service, and delete the stale `gmail-mcp` entries in Keychain Access.
Gmail-specific names (`imap.gmail.com`, `[Gmail]/Spam`, the `X-GM-*` extensions) are
unrelated to this and unchanged.

[Unreleased]: https://github.com/MarcinWalendowski/anymail-mcp/compare/v0.0.1-rc.2...HEAD
[0.0.1-rc.1]: https://github.com/MarcinWalendowski/anymail-mcp/releases/tag/v0.0.1-rc.1
[0.0.1-rc.2]: https://github.com/MarcinWalendowski/anymail-mcp/compare/v0.0.1-rc.1...v0.0.1-rc.2
