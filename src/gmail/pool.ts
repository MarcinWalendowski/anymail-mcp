import { ImapFlow } from "imapflow";
import { getAppPassword } from "../keychain.js";
import { resolveEmail } from "../registry.js";
import { logger } from "../logger.js";

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const IDLE_CLOSE_MS = 5 * 60 * 1000;

interface Pooled {
  client: ImapFlow;
  lastUsed: number;
}

const pool = new Map<string, Pooled>();
const connecting = new Map<string, Promise<ImapFlow>>();
let sweeper: NodeJS.Timeout | undefined;

/**
 * Get a live, authenticated ImapFlow connection for `email`, reusing an open
 * one when possible. One connection per account (Gmail caps simultaneous IMAP
 * connections); ImapFlow's mailbox locks serialize operations on it.
 */
export async function getImap(email: string): Promise<ImapFlow> {
  const existing = pool.get(email);
  if (existing && existing.client.usable) {
    existing.lastUsed = Date.now();
    return existing.client;
  }
  pool.delete(email);

  const inflight = connecting.get(email);
  if (inflight) return inflight;

  const connect = (async () => {
    const pass = getAppPassword(email);
    const client = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: true,
      auth: { user: email, pass },
      logger: false,
    });
    client.on("error", (err: Error) => {
      logger.warn({ email, err: err.message }, "imap connection error");
    });
    client.on("close", () => {
      pool.delete(email);
    });
    await client.connect();
    pool.set(email, { client, lastUsed: Date.now() });
    logger.debug({ email }, "imap connected");
    return client;
  })();

  connecting.set(email, connect);
  try {
    return await connect;
  } finally {
    connecting.delete(email);
  }
}

/** Convenience: resolve an optional account arg to a live connection. */
export async function getImapFor(account?: string): Promise<{ email: string; client: ImapFlow }> {
  const email = resolveEmail(account);
  return { email, client: await getImap(email) };
}

export function startIdleSweep(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [email, entry] of pool) {
      if (now - entry.lastUsed > IDLE_CLOSE_MS) {
        pool.delete(email);
        entry.client.logout().catch(() => entry.client.close());
        logger.debug({ email }, "imap idle-closed");
      }
    }
  }, 60_000);
  sweeper.unref?.();
}

export async function closeAll(): Promise<void> {
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = undefined;
  }
  await Promise.allSettled(
    [...pool.values()].map((e) => e.client.logout().catch(() => e.client.close())),
  );
  pool.clear();
}
