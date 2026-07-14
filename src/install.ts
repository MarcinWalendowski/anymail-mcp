import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ensureServerConfig } from "./server-config.js";

/**
 * One-click MCP registration — the engine-level primitive the menu-bar app's
 * "Install into agents" button calls. HTTP agents get the always-on server URL
 * plus a bearer token; Claude Desktop (stdio-only) gets the stdio command,
 * which spawns its own engine sharing the same Keychain + registry.
 */
export interface InstallCtx {
  nodePath: string;
  entryJs: string;
  url: string;
  token: string;
}

export interface AgentTarget {
  id: string;
  name: string;
  configPath: string;
  /** Top-level key holding the server map. */
  key: "mcpServers" | "servers";
  transport: "http" | "stdio";
  buildEntry: (ctx: InstallCtx) => Record<string, unknown>;
}

const HOME = homedir();
const APP_SUPPORT = join(HOME, "Library", "Application Support");

function bearer(ctx: InstallCtx): Record<string, string> {
  return { Authorization: `Bearer ${ctx.token}` };
}

export const AGENTS: AgentTarget[] = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    configPath: join(APP_SUPPORT, "Claude", "claude_desktop_config.json"),
    key: "mcpServers",
    transport: "stdio",
    buildEntry: (ctx) => ({ command: ctx.nodePath, args: [ctx.entryJs] }),
  },
  {
    id: "claude-code",
    name: "Claude Code (user scope)",
    configPath: join(HOME, ".claude.json"),
    key: "mcpServers",
    transport: "http",
    buildEntry: (ctx) => ({ type: "http", url: ctx.url, headers: bearer(ctx) }),
  },
  {
    id: "cursor",
    name: "Cursor",
    configPath: join(HOME, ".cursor", "mcp.json"),
    key: "mcpServers",
    transport: "http",
    buildEntry: (ctx) => ({ url: ctx.url, headers: bearer(ctx) }),
  },
  {
    id: "windsurf",
    name: "Windsurf",
    configPath: join(HOME, ".codeium", "windsurf", "mcp_config.json"),
    key: "mcpServers",
    transport: "http",
    buildEntry: (ctx) => ({ serverUrl: ctx.url, headers: bearer(ctx) }),
  },
  {
    id: "vscode",
    name: "VS Code (Copilot, user)",
    configPath: join(APP_SUPPORT, "Code", "User", "mcp.json"),
    key: "servers",
    transport: "http",
    buildEntry: (ctx) => ({ type: "http", url: ctx.url, headers: bearer(ctx) }),
  },
];

/** True when the agent looks installed (its config or parent app dir exists). */
export function detected(t: AgentTarget): boolean {
  return existsSync(t.configPath) || existsSync(dirname(t.configPath));
}

export function installInto(
  target: AgentTarget,
  serverName: string,
  entry: Record<string, unknown>,
): { created: boolean } {
  const created = !existsSync(target.configPath);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = {};
  if (!created) {
    const raw = readFileSync(target.configPath, "utf8").trim();
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        // Never clobber an existing config we can't parse.
        throw new Error(`existing config at ${target.configPath} is not valid JSON; left untouched`);
      }
    }
  }

  if (!json[target.key] || typeof json[target.key] !== "object") json[target.key] = {};
  json[target.key][serverName] = entry;

  mkdirSync(dirname(target.configPath), { recursive: true });
  writeFileSync(target.configPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  return { created };
}

export function runInstall(opts: { entryJs: string; all?: boolean }): { lines: string[]; url: string } {
  const cfg = ensureServerConfig();
  const ctx: InstallCtx = {
    nodePath: process.execPath,
    entryJs: opts.entryJs,
    url: cfg.url,
    token: cfg.token,
  };
  const lines: string[] = [];
  for (const t of AGENTS) {
    if (!opts.all && !detected(t)) {
      lines.push(`·  ${t.name}: not detected (skipped; use --all to force)`);
      continue;
    }
    try {
      const { created } = installInto(t, "anymail-mcp", t.buildEntry(ctx));
      lines.push(`✓  ${t.name} [${t.transport}]: ${created ? "created" : "updated"} ${t.configPath}`);
    } catch (e) {
      lines.push(`✗  ${t.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { lines, url: cfg.url };
}
