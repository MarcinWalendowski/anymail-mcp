# Security

AnyMail MCP runs entirely on your Mac and can read, send, and delete your mail, so
it is built to keep credentials on-device and the local server closed to
everything but your agent.

## Where credentials live

- **App Passwords** are stored **only in the macOS Keychain** (service
  `gmail-mcp`, keyed by email). They are never written to disk, never placed in
  environment variables that persist, never logged, and never returned in any
  API/tool response.
- **Non-secret account config** (which emails are connected, which is default,
  read-only flags) lives in `~/.gmail-mcp/accounts.json`.
- **The local server's bearer token** lives in `~/.gmail-mcp/server.json`
  (`0600`).

None of these are inside the repository, and `~/.gmail-mcp/` is ignored by git
as a belt-and-suspenders measure.

## Local server hardening

- **Loopback only** — binds `127.0.0.1`; it never listens on a routable
  interface, so nothing off-machine can reach it.
- **Bearer token** required on every request, including the admin API.
- **Origin validation** rejects browser-style `Origin` headers (defends against
  DNS-rebinding from a malicious web page).
- **Permanent delete** requires an explicit `confirm: true`; `trash_message` is
  the reversible default.
- **Per-account read-only mode** refuses all write operations for accounts you
  only want to triage.

## App Password blast radius

A Gmail App Password grants **full, unscoped mailbox access** — there is no
per-scope limit. Treat it like a password:

- Use a **dedicated** App Password per machine so you can revoke narrowly.
- If a Mac is lost or compromised, revoke the App Password immediately at
  <https://myaccount.google.com/apppasswords>. That instantly cuts AnyMail MCP off
  from the account, no matter what else is going on.
- Prefer **read-only** for accounts the agent only needs to search.

## Reporting a vulnerability

Please report security issues privately by opening a
[GitHub security advisory](https://github.com/MarcinWalendowski/anymail-mcp/security/advisories/new)
rather than a public issue. You'll get an acknowledgement as soon as possible.
