# Contributing to AnyMail MCP

Thanks for your interest! AnyMail MCP is a local macOS tool that connects multiple
email accounts to an MCP-capable agent. Issues and pull requests are welcome.

## Project layout

```
src/            # Node/TypeScript engine (the MCP server + CLI)
  gmail/        #   IMAP (ImapFlow) + SMTP (Nodemailer)
  mcp/          #   MCP server + tool definitions
  http/         #   always-on local HTTP + admin API
  cli.ts        #   add / list / test / install / …
app/            # macOS menu-bar app (Swift/AppKit) — see app/BUILD.md
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

There is no automated mail test suite yet — Gmail round-trips need a real account
and App Password. If you add tests, keep credential-dependent tests opt-in.

Before opening a PR:

- `npm run typecheck` must pass.
- Never commit secrets. Account config and the server token live in
  `~/.anymail-mcp/` (outside the repo); App Passwords live in the Keychain. See
  [SECURITY.md](SECURITY.md).

## Good first contributions

The [roadmap in the README](README.md#roadmap) is the priority list — provider
support (Microsoft 365, generic IMAP) and an OAuth sign-in flow are the biggest
open pieces. Smaller wins: better error messages, additional agent install
targets, docs.

## Code style

Match the surrounding code. TypeScript is `strict`; keep secrets out of logs
(pino redaction is already configured) and out of tool/API responses.
