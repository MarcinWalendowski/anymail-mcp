# Contributing to AnyMail MCP

Thanks for your interest! AnyMail MCP is a local MCP server that connects multiple
email accounts to an MCP-capable agent. The CLI and engine run on macOS, Windows,
and Linux; the menu-bar app is macOS-only. Issues and pull requests are welcome.

## Project layout

```
src/              # Node/TypeScript engine (the MCP server + CLI)
  providers/      #   per-provider IMAP/SMTP: gmail.ts extends imap.ts
  mcp/            #   MCP server + tool definitions
  http/           #   always-on local HTTP + admin API
  keychain.ts     #   OS credential store (Keychain / Credential Manager / Secret Service)
  install.ts      #   per-OS agent-config install (Claude Desktop, VS Code, ...)
  cli.ts          #   add / list / test / install / ...
app/              # macOS menu-bar app (Swift/AppKit), see app/BUILD.md
```

The engine holds **all** mail and Keychain logic; the Swift app is a thin shell
that talks to the engine's admin API over `127.0.0.1`.

## Developing the engine

```bash
npm install
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
npm run dev         # tsx src/index.ts (no build step)
```

There is no automated mail test suite yet; Gmail round-trips need a real account
and App Password. If you add tests, keep credential-dependent tests opt-in.

Before opening a PR:

- `npm run typecheck` must pass.
- Never commit secrets. Account config and the server token live in
  `~/.anymail-mcp/` (outside the repo); App Passwords live in the Keychain. See
  [SECURITY.md](SECURITY.md).

## Good first contributions

The [roadmap in the README](README.md#roadmap) is the priority list. The biggest
open pieces are a **Microsoft 365 / Outlook provider** (needs OAuth), **OAuth
sign-in** as an alternative to App Passwords, and **richer IMAP search** (mapping
the common Gmail-style operators onto IMAP SEARCH so non-Gmail accounts behave the
same). Generic IMAP (iCloud, Fastmail, any host) already shipped. Smaller wins:
better error messages, additional agent install targets, docs.

## Code style

Match the surrounding code. TypeScript is `strict`; keep secrets out of logs
(pino redaction is already configured) and out of tool/API responses.
