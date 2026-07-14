import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { closeAll, startIdleSweep } from "../gmail/pool.js";
import { logger } from "../logger.js";

const INSTRUCTIONS = [
  "Multi-account Gmail over IMAP/SMTP.",
  "Every tool takes an optional `account` (Gmail address); omit it to use the default account (see list_accounts).",
  "Message ids are Gmail X-GM-MSGID strings returned by search_messages / get_message; thread ids are X-GM-THRID.",
  "Search uses native Gmail query syntax; add 'in:anywhere' to include Trash/Spam.",
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
