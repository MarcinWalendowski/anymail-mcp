# AnyMail MCP

**Connect all your email accounts to your AI agent — not just one.**

AnyMail MCP is a local [MCP](https://modelcontextprotocol.io) server that gives an
agent (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, …) full read /
send / organize / delete access across **multiple mailboxes at once** — Gmail,
iCloud, Fastmail, or any IMAP host — over IMAP/SMTP. Per-account **App Passwords**
live in the macOS Keychain — nothing is hosted, and your credentials never leave
your Mac.

**Gmail is the most complete provider** (labels, threads, native Gmail search), and
the others work today with a smaller feature set — see [Providers](#providers).

![platform: macOS](https://img.shields.io/badge/platform-macOS%2013%2B-black)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![status: v0.0.1-rc.1](https://img.shields.io/badge/status-v0.0.1--rc.1%20%C2%B7%20Gmail%20%2B%20IMAP-orange)

---

## Why AnyMail MCP exists

Today, connecting your mail to an AI agent generally means **one account at a
time** — a single Gmail, or a single Microsoft 365 mailbox. But most people live
across several inboxes: personal, work, a side project, an old address that still
gets the important stuff. The agent can only ever see one of them.

AnyMail MCP removes that limit. Connect every account you have — across providers —
and your agent can search, triage, draft, send, label, and clean up across **all of
them** in a single session, while every credential stays on your machine.

> **Pre-1.0 — v0.0.1-rc.1.** This is a release candidate: it works, but interfaces
> may still change without notice. Authentication is via **App Passwords**;
> Microsoft 365 / Outlook and OAuth sign-in are on the [roadmap](#roadmap).

## Providers

Every provider speaks IMAP/SMTP, so the core — search, read, send, draft, move,
archive, trash, delete, attachments, and the bulk tools — works everywhere. What
differs is what the underlying protocol exposes:

| | **Gmail** | **iCloud** · **Fastmail** · **any IMAP host** |
|---|---|---|
| Status | Fully supported | Works, smaller feature set |
| Organizing | **Labels** — many per message (`modify_labels`) | **Folders** — one per message (`move` / `archive`) |
| Search | **Native Gmail syntax** (`from:x has:attachment older_than:1y`) | Server-side **text match** only |
| Threads | `get_thread` | Not available |
| Add it with | *(default)* | `--provider icloud` · `--provider fastmail` · `--provider imap --imap-host … --smtp-host …` |

Presets ship for Gmail (`imap.gmail.com`), iCloud (`imap.mail.me.com`, STARTTLS on
587) and Fastmail (`imap.fastmail.com`); `--provider imap` takes any host/port.
`list_accounts` reports each account's provider, so an agent can tell which rules
apply before it acts.

Mixing is the point: a Gmail work account and an iCloud personal account can be
connected at the same time, and every tool takes an optional `account` to pick
between them.

## What it can do

Full CRUD across every connected account:

| Kind | Operations |
|------|-----------|
| **Read** | list accounts · search · read message · read thread *(Gmail)* · list labels *(Gmail)* · fetch attachments |
| **Create** | send · save draft · create label · add an account (`add_account`) |
| **Update** | add/remove labels · read/unread · star/unstar · archive · move |
| **Delete** | trash (reversible) · permanent delete (explicit `confirm:true`) |
| **Bulk** | one call acts on *every* message matching a query: `mark_all_read` · `bulk_modify_labels` · `bulk_move` · `bulk_trash` · `bulk_delete` · `empty_spam` · `empty_trash` |

Every tool takes an optional `account` (the email address); omit it to use your
default account.

### Cleaning up in bulk

The bulk tools are **query-first**: they take `{ query?, mailbox?, dryRun?, confirm?, max? }`
and act on the whole matching set in one pass, instead of one tool call per
message. So "mark everything from this sender as read" or "trash every promo
older than a year" is a single call.

- `dryRun:true` previews the matched count and a small sample, changing nothing.
- Destructive or large (>100-message) batches require `confirm:true`.
- Per-message failures are reported, never hidden.
- Spam and Trash are reachable via the `mailbox` param (e.g. `mailbox:'[Gmail]/Spam'`).

For very large clean-ups, the removing ops (`bulk_trash` / `bulk_move` /
`bulk_delete` / `empty_*`) act on up to `max` messages per call (default **2000**)
and return `{ matched, affected, remaining, done }`. When `done` is `false`, just
re-run the **same call** until it's `true` — acted-on messages leave the search
scope, so it resumes cleanly, and a 10k-message sweep never trips your agent's
tool timeout.

---

## Get started

AnyMail MCP runs two ways from one engine. Pick the track that fits you.

### Prerequisite (every account, one-time)

Each provider wants an **App Password** — a per-app credential you create once,
after turning on two-factor auth. Never your normal password.

| Provider | Where to create it | Notes |
|----------|--------------------|-------|
| **Gmail** | <https://myaccount.google.com/apppasswords> | Needs **2-Step Verification** on first. IMAP is always-on — nothing else to toggle. |
| **iCloud** | <https://account.apple.com> → Sign-In and Security → App-Specific Passwords | Needs **two-factor authentication** on the Apple Account. |
| **Fastmail** | Settings → Password & Security → App Passwords | Scope it to **IMAP + SMTP**. |
| **Other IMAP** | Your host's control panel | Some hosts also require enabling IMAP access explicitly. |

> An App Password grants **full mailbox access** and is stored only in your
> Keychain. If a machine is lost, revoke it at the same URL you created it —
> that instantly cuts AnyMail MCP off from that account. See
> [SECURITY.md](SECURITY.md).

### Track A — Command line (works today)

For developers and anyone comfortable in a terminal.

```bash
git clone https://github.com/MarcinWalendowski/anymail-mcp.git
cd anymail-mcp
npm install            # @napi-rs/keyring ships prebuilt binaries — no compiler needed
npm run build          # → dist/index.js

# add accounts (prompts for the App Password, hidden)
node dist/index.js add you@gmail.com --name "Personal" --default
node dist/index.js add work@company.com
node dist/index.js add archive@gmail.com --read-only   # triage-only: refuses all writes
node dist/index.js list
node dist/index.js test you@gmail.com                  # verify IMAP + SMTP

# other providers (folder-based: no labels, no threads, text-only search)
node dist/index.js add you@icloud.com   --provider icloud
node dist/index.js add you@fastmail.com --provider fastmail
node dist/index.js add you@host.tld     --provider imap --imap-host imap.host.tld --smtp-host smtp.host.tld

# register into every agent it can detect
node dist/index.js install
```

Tip: `npm link` once, then the commands are just `anymail-mcp add …`, `anymail-mcp list`, etc.

### Track B — Menu-bar app (GUI)

For a no-terminal experience: a macOS menu-bar app that supervises the engine and
gives you an **Add Account** window, an **Install into Agents** button, and
**Start at Login** — the App Password never touches the app, it's posted once to
`127.0.0.1` and the engine stores it in the Keychain.

The Add Account window supports **Gmail, iCloud, Fastmail, or a custom IMAP host**
(a provider picker reveals host/port fields for the custom case). Accounts can also
be added from an agent with the `add_account` MCP tool — though the GUI is the more
private path, since it posts the password straight to the local engine and the model
never sees it.

The window also has a **"Create an App Password"** assistant so you
don't have to hunt through Google settings: one button opens Google's App
Passwords page in your own browser, or you can hand the task to an AI agent — it
copies a ready-to-run prompt and opens **Claude for Chrome** (runs locally in your
browser) or **ChatGPT / Claude.ai**. The app never automates Google's page itself;
the returned 16-character code is pasted back into the field (there's a **Paste**
button) and verified as usual. Note: cloud agents create the password on a *remote*
machine — prefer the local options; the window warns you inline.

The source and build steps live in [`app/`](app/BUILD.md). **Today you build it
yourself** (`xcodegen generate` + Xcode). A signed, notarized download that opens
with a double-click is on the [roadmap](#roadmap) — the full plan (self-contained
engine, DMG, notarization, CLI channels) is in [DISTRIBUTION.md](DISTRIBUTION.md);
notarizing needs an Apple Developer account, so it can't be produced here.

---

## Connect it to your agent

`node dist/index.js install` writes the right config for each agent it detects:

| Agent | Transport | What gets written |
|-------|-----------|-------------------|
| Cursor · Claude Code · VS Code · Windsurf | **HTTP** | local URL + `Authorization: Bearer <token>` |
| Claude Desktop | **stdio** | spawn command (its own engine, same Keychain) |

Restart the agent afterward, then ask it to `list_accounts`.

---

## Security model

The engine can read, send, and **delete** your mail, so the always-on server is
locked down (full detail in [SECURITY.md](SECURITY.md)):

- **Binds `127.0.0.1` only** — never listens on the network.
- **Bearer token** on every request (engine + admin API), minted on first run and
  stored `0600` outside the repo. App Passwords never appear in any response.
- **Origin validation** — rejects browser origins (DNS-rebinding defense).
- App Passwords live **only** in the macOS Keychain.
- Per-account **read-only** mode; permanent delete requires `confirm:true`.
- Logs go to stderr with secret/body redaction.

Nothing secret is ever written into this repository — account config and the
server token live in `~/.anymail-mcp/` (outside the repo), passwords live in the
Keychain.

---

## Roadmap

- [x] **Generic IMAP providers** — iCloud, Fastmail, and any IMAP host work via
      `--provider` ([smaller feature set](#providers): folders not labels, text-only
      search, no threads).
- [ ] **Richer search for IMAP providers** — map the common Gmail-style operators
      (`from:`, `subject:`, `has:attachment`, date ranges) onto IMAP SEARCH, so a
      query behaves the same across accounts.
- [ ] **More providers** — Microsoft 365 / Outlook (needs OAuth), Yahoo, so one agent
      spans every mailbox regardless of host.
- [ ] **OAuth sign-in** — connect an account with a normal "Sign in with Google /
      Microsoft" flow instead of manually creating App Passwords.
- [ ] **One-click install** — a signed & **notarized** DMG and a Homebrew cask so
      non-technical users download and run without Gatekeeper warnings.
- [ ] **`npm`/`npx` distribution** for the CLI/engine.
- [ ] **Windows & Linux** engine builds (the engine is plain Node; the Keychain
      layer is the only platform-specific piece).

## How it works

```
Agent (Claude Code / Desktop / Cursor …)
   │  MCP over stdio or HTTP (127.0.0.1)
   ▼
AnyMail MCP engine  (local Node process)
   │  one provider per account, chosen from the account's `provider`
   │
   ├─ GmailProvider  ── ImapFlow → imap.gmail.com:993     (+ X-GM-* : labels, threads, raw search)
   │                    Nodemailer→ smtp.gmail.com:465
   │
   └─ ImapProvider   ── ImapFlow → imap.mail.me.com:993   (iCloud / Fastmail / any host)
                        Nodemailer→ smtp.mail.me.com:587    folders, IMAP SEARCH
   ▼
Each account authenticated with its own App Password, read from the Keychain
```

`GmailProvider` extends `ImapProvider`, so Gmail is the generic IMAP behaviour plus
the `X-GM-*` extensions. Adding a provider means extending `ImapProvider` and adding
a preset — see [`src/providers/`](src/providers/).

Why IMAP/SMTP + App Passwords instead of the Gmail HTTP API: full-CRUD Gmail API
access needs *restricted* OAuth scopes, which for personal `@gmail.com` accounts
forces Google app verification + an annual CASA security assessment (or a 7-day
token expiry in Testing mode). App Passwords + IMAP sidestep all of it and run
fine in a local process — and IMAP needs a long-lived TCP socket, so this can't
be a serverless function anyway. See [`app/BUILD.md`](app/BUILD.md) for the
macOS app internals.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Release process
is in [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE) © Marcin Walendowski
