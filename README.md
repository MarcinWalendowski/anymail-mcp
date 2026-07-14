# AnyMail MCP

**Connect all your email accounts to your AI agent — not just one.**

AnyMail MCP is a local [MCP](https://modelcontextprotocol.io) server that gives an
agent (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, …) full read /
send / organize / delete access across **multiple Gmail accounts at once**, over
IMAP/SMTP. Per-account **App Passwords** live in the macOS Keychain — nothing is
hosted, and your credentials never leave your Mac.

![platform: macOS](https://img.shields.io/badge/platform-macOS%2013%2B-black)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![status: v0.2.0](https://img.shields.io/badge/status-v0.2.0%20%C2%B7%20Gmail-orange)

---

## Why AnyMail MCP exists

Today, connecting your mail to an AI agent generally means **one account at a
time** — a single Gmail, or a single Microsoft 365 mailbox. But most people live
across several inboxes: personal, work, a side project, an old address that still
gets the important stuff. The agent can only ever see one of them.

AnyMail MCP removes that limit. Connect every Gmail account you have, and your agent
can search, triage, draft, send, label, and clean up across **all of them** in a
single session — while every credential stays on your machine.

> Multi-provider support (Microsoft 365 / Outlook, generic IMAP, iCloud) and
> OAuth sign-in are on the [roadmap](#roadmap). v0.2.0 is Gmail + App Passwords
> (generic IMAP providers are included but experimental).

## What it can do

Full CRUD across every connected account:

| Kind | Operations |
|------|-----------|
| **Read** | list accounts · search (native Gmail syntax) · read message · read thread · list labels · fetch attachments |
| **Create** | send · save draft · create label |
| **Update** | add/remove labels · read/unread · star/unstar · archive · move |
| **Delete** | trash (reversible) · permanent delete (explicit `confirm:true`) |

Every tool takes an optional `account` (the email address); omit it to use your
default account.

---

## Get started

AnyMail MCP runs two ways from one engine. Pick the track that fits you.

### Prerequisite (every account, one-time)

1. Turn on **2-Step Verification** on the Google account.
2. Create a 16-character **App Password** at
   <https://myaccount.google.com/apppasswords>.
   (IMAP is always-on for Gmail — nothing else to toggle.)

> An App Password grants **full mailbox access** and is stored only in your
> Keychain. If a machine is lost, revoke it at the URL above — that instantly
> cuts AnyMail MCP off from that account. See [SECURITY.md](SECURITY.md).

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

# other providers (experimental — folder-based, limited search, no threads):
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
server token live in `~/.gmail-mcp/` (outside the repo), passwords live in the
Keychain.

---

## Roadmap

- [x] **Generic IMAP providers** — iCloud, Fastmail, and any IMAP host now work via
      `--provider` (experimental: folder-based, limited search, no threads).
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
   │  ImapFlow  → imap.gmail.com:993   (search, labels, threads, delete)
   │  Nodemailer→ smtp.gmail.com:465   (send, drafts)
   ▼
Gmail — authenticated per account with an App Password from the Keychain
```

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
