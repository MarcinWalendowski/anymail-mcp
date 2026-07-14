import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { closeAll, startIdleSweep } from "../providers/index.js";
import { logger } from "../logger.js";

const INSTRUCTIONS = [
  "Multi-account, multi-provider email over IMAP/SMTP (Gmail, plus iCloud / Fastmail / generic IMAP).",
  "Every tool takes an optional `account` (email address); omit it to use the default account. list_accounts shows each account's provider.",
  "Message ids (gmMsgId) and thread ids (gmThrId) are opaque strings returned by search_messages / get_message — pass them back verbatim, never construct them.",
  "On Gmail: search uses native Gmail query syntax (add 'in:anywhere' for Trash/Spam) and messages carry labels. On other providers: search is a limited server-side text match, there are no labels (use move/archive instead of modify_labels), and get_thread is unavailable.",
  "Use trash_message for a reversible delete; delete_message is permanent and needs confirm:true.",
].join(" ");

/** Build a fully-registered MCP server. Shared by the stdio and HTTP transports. */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "anymail-mcp", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  registerTools(server);
  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = buildServer();
  startIdleSweep();

  const shutdown = () => {
    void closeAll().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("anymail-mcp stdio server ready");
}
