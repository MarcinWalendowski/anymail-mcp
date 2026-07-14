import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ImapFlow } from "imapflow";
import nodemailer, { type Transporter } from "nodemailer";
import { simpleParser } from "mailparser";
import { getAppPassword } from "../keychain.js";
import { logger } from "../logger.js";
import type {
  AttachmentInput,
  AttachmentResult,
  ComposeInput,
  ConnectionConfig,
  Folder,
  FullMessage,
  MailProvider,
  MessageSummary,
  MutationResult,
  ProviderCapabilities,
  ProviderId,
  SendResult,
  SpecialMailboxes,
} from "./types.js";

// ---------- shared helpers (also used by GmailProvider) ----------

export type FetchMsg = Awaited<ReturnType<ImapFlow["fetchAll"]>>[number];
export type Address = { name?: string; address?: string };

export const MAX_INLINE_ATTACHMENT = 5_000_000; // require a savePath above this

/** Summary fetch fields available on any IMAP server. */
export const BASE_SUMMARY_QUERY = {
  uid: true,
  envelope: true,
  flags: true,
  internalDate: true,
  size: true,
} as const;

export async function withMailbox<T>(
  client: ImapFlow,
  path: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await client.getMailboxLock(path);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

export function fmtAddr(list?: Address[]): string {
  if (!list?.length) return "";
  return list
    .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : (a.address ?? "")))
    .join(", ");
}

export function toIso(d?: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Build a MessageSummary from a fetch result. `emailId`/`threadId`/`labels` are
 * Gmail extensions; on a plain IMAP server they are simply absent (null/[]).
 */
export function formatSummary(msg: FetchMsg): MessageSummary {
  const env = msg.envelope ?? ({} as NonNullable<FetchMsg["envelope"]>);
  const flags = msg.flags ?? new Set<string>();
  return {
    gmMsgId: msg.emailId ?? null,
    gmThrId: msg.threadId ?? null,
    uid: msg.uid,
    subject: env.subject ?? "",
    from: fmtAddr(env.from as Address[] | undefined),
    to: fmtAddr(env.to as Address[] | undefined),
    cc: fmtAddr(env.cc as Address[] | undefined),
    date: toIso(env.date ?? msg.internalDate),
    messageId: env.messageId ?? null,
    inReplyTo: env.inReplyTo ?? null,
    labels: msg.labels ? [...msg.labels] : [],
    flags: [...flags],
    unread: !flags.has("\\Seen"),
    size: msg.size ?? null,
  };
}

export function byDateDesc(a: MessageSummary, b: MessageSummary): number {
  return (b.date ?? "").localeCompare(a.date ?? "");
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`Message ${id} not found in this account (it may have moved — re-run search).`);
  }
}

// ---------- base provider ----------

const ID_SEP = "\t"; // IMAP mailbox names never contain a tab

/**
 * Generic IMAP + SMTP provider. Works against any standard IMAP/SMTP host
 * (iCloud, Fastmail, self-hosted). Folder-based (no labels), best-effort search,
 * no server-side threads — GmailProvider extends this and overrides the ops that
 * use Gmail's X-GM-* extensions.
 *
 * Message ids are opaque "uidvalidity|uid|folder" composites: unique and
 * cheap for the search→act flow, though they don't survive a message being moved
 * (re-run search after a move). Gmail overrides ids with the stable X-GM-MSGID.
 */
export class ImapProvider implements MailProvider {
  readonly id: ProviderId;
  readonly email: string;
  readonly capabilities: ProviderCapabilities = {
    labels: false,
    threads: false,
    nativeSearch: false,
  };

  protected readonly conn: ConnectionConfig;

  private client?: ImapFlow;
  private connecting?: Promise<ImapFlow>;
  private transporter?: Transporter;
  private boxesCache?: SpecialMailboxes;
  private lastUsed = 0;

  constructor(email: string, conn: ConnectionConfig, id: ProviderId = "imap") {
    this.email = email;
    this.conn = conn;
    this.id = id;
  }

  // ----- connection / lifecycle -----

  protected async getClient(): Promise<ImapFlow> {
    if (this.client && this.client.usable) {
      this.lastUsed = Date.now();
      return this.client;
    }
    this.client = undefined;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const client = new ImapFlow({
        host: this.conn.imapHost,
        port: this.conn.imapPort,
        secure: true,
        auth: { user: this.email, pass: getAppPassword(this.email) },
        logger: false,
      });
      client.on("error", (err: Error) => {
        logger.warn({ email: this.email, err: err.message }, "imap connection error");
      });
      client.on("close", () => {
        if (this.client === client) this.client = undefined;
      });
      await client.connect();
      this.client = client;
      this.lastUsed = Date.now();
      logger.debug({ email: this.email, provider: this.id }, "imap connected");
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  protected getTransport(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.conn.smtpHost,
        port: this.conn.smtpPort,
        secure: this.conn.smtpSecure,
        auth: { user: this.email, pass: getAppPassword(this.email) },
      });
    }
    return this.transporter;
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = undefined;
    this.transporter = undefined;
    if (c) await c.logout().catch(() => c.close());
  }

  async closeIfIdle(maxIdleMs: number): Promise<void> {
    if (this.client && Date.now() - this.lastUsed > maxIdleMs) {
      await this.close();
      logger.debug({ email: this.email }, "imap idle-closed");
    }
  }

  // ----- mailbox discovery -----

  protected async boxes(): Promise<SpecialMailboxes> {
    if (this.boxesCache) return this.boxesCache;
    const client = await this.getClient();
    const boxes: SpecialMailboxes = { inbox: "INBOX" };
    for (const mb of await client.list()) {
      switch (mb.specialUse) {
        case "\\All":
          boxes.all = mb.path;
          break;
        case "\\Archive":
          boxes.archive = mb.path;
          break;
        case "\\Trash":
          boxes.trash = mb.path;
          break;
        case "\\Drafts":
          boxes.drafts = mb.path;
          break;
        case "\\Sent":
          boxes.sent = mb.path;
          break;
        case "\\Junk":
          boxes.junk = mb.path;
          break;
      }
    }
    this.boxesCache = boxes;
    return boxes;
  }

  protected requireBox(
    boxes: SpecialMailboxes,
    key: "all" | "archive" | "trash" | "drafts" | "sent" | "junk",
  ): string {
    const path = boxes[key];
    if (!path) throw new Error(`This account has no ${key} mailbox exposed over IMAP.`);
    return path;
  }

  /** The mailbox to open for whole-account browsing (All Mail if present, else INBOX). */
  protected searchScope(boxes: SpecialMailboxes): string {
    return boxes.all ?? boxes.inbox;
  }

  // ----- id encoding (generic) -----

  protected makeId(path: string, uidValidity: bigint | number | string, uid: number): string {
    // uidvalidity + uid first (numeric, separator-free); path last (may contain the separator).
    return `${String(uidValidity)}${ID_SEP}${uid}${ID_SEP}${path}`;
  }

  private parseId(id: string): { path: string; uidValidity: string; uid: number } {
    const parts = id.split(ID_SEP);
    if (parts.length < 3 || !parts[1]) {
      throw new Error(`Malformed message id "${id}" for a non-Gmail account. Re-run search.`);
    }
    return { uidValidity: parts[0], uid: Number(parts[1]), path: parts.slice(2).join(ID_SEP) };
  }

  /** Open the folder an id points at, verify UIDVALIDITY, run `fn(client, uid)`. */
  protected async withMessage<T>(
    id: string,
    fn: (client: ImapFlow, uid: number) => Promise<T>,
  ): Promise<T> {
    const { path, uidValidity, uid } = this.parseId(id);
    const client = await this.getClient();
    return withMailbox(client, path, async () => {
      if (client.mailbox && String(client.mailbox.uidValidity) !== uidValidity) {
        throw new Error(`Message id is stale (folder "${path}" changed). Re-run search.`);
      }
      return fn(client, uid);
    });
  }

  // ----- shared: verify / send / draft / folders (identical for Gmail) -----

  async verify(): Promise<SpecialMailboxes> {
    const boxes = await this.boxes(); // forces IMAP connect + LIST
    await this.getTransport().verify(); // forces SMTP login
    return boxes;
  }

  private toAttachments(atts?: AttachmentInput[]) {
    return (atts ?? []).map((a) =>
      a.path
        ? { filename: a.filename, path: a.path, contentType: a.contentType }
        : {
            filename: a.filename,
            content: Buffer.from(a.contentBase64 ?? "", "base64"),
            contentType: a.contentType,
          },
    );
  }

  async send(input: ComposeInput): Promise<SendResult> {
    const info = await this.getTransport().sendMail({
      from: this.email,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      html: input.html,
      inReplyTo: input.inReplyTo,
      references: input.inReplyTo ? [input.inReplyTo] : undefined,
      attachments: this.toAttachments(input.attachments),
    });
    return {
      messageId: info.messageId,
      accepted: info.accepted as string[],
      rejected: info.rejected as string[],
      response: info.response,
    };
  }

  async createDraft(input: ComposeInput): Promise<{ mailbox: string; uid: number | null }> {
    // Build raw MIME without sending (stream transport), then APPEND to Drafts.
    const generator = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "\r\n",
    });
    const built = await generator.sendMail({
      from: this.email,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      html: input.html,
      inReplyTo: input.inReplyTo,
      references: input.inReplyTo ? [input.inReplyTo] : undefined,
      attachments: this.toAttachments(input.attachments),
    });
    const raw = (built as unknown as { message: Buffer }).message;

    const client = await this.getClient();
    const boxes = await this.boxes();
    const drafts = this.requireBox(boxes, "drafts");
    const resp = await client.append(drafts, raw, ["\\Draft"]);
    return { mailbox: drafts, uid: resp && resp.uid != null ? resp.uid : null };
  }

  async createFolder(name: string): Promise<{ path: string; created: boolean }> {
    const client = await this.getClient();
    const res = await client.mailboxCreate(name);
    return { path: res.path, created: res.created };
  }

  async listFolders(): Promise<Folder[]> {
    const client = await this.getClient();
    const list = await client.list();
    return list.map((mb) => ({ path: mb.path, name: mb.name, specialUse: mb.specialUse ?? null }));
  }

  // ----- generic read ops -----

  async search(query: string, limit = 25, folder?: string): Promise<MessageSummary[]> {
    const client = await this.getClient();
    const boxes = await this.boxes();
    const scope = folder ?? this.searchScope(boxes);
    return withMailbox(client, scope, async () => {
      // Best-effort: full-text server-side SEARCH. Not Gmail syntax (capabilities.nativeSearch = false).
      const criteria = query.trim() ? { text: query.trim() } : { all: true };
      const uids = await client.search(criteria, { uid: true });
      if (!uids || uids.length === 0) return [];
      const chosen = uids.slice(-Math.max(1, limit));
      const uidValidity = client.mailbox ? client.mailbox.uidValidity : 0;
      const msgs = await client.fetchAll(chosen, BASE_SUMMARY_QUERY, { uid: true });
      return msgs
        .map((m) => {
          const s = formatSummary(m);
          s.gmMsgId = this.makeId(scope, uidValidity, m.uid);
          return s;
        })
        .sort(byDateDesc);
    });
  }

  async getMessage(id: string): Promise<FullMessage> {
    return this.withMessage(id, async (client, uid) => {
      const msg = await client.fetchOne(String(uid), { ...BASE_SUMMARY_QUERY, source: true }, { uid: true });
      if (!msg) throw new NotFoundError(id);
      const summary = formatSummary(msg);
      summary.gmMsgId = id;
      const parsed = await simpleParser(msg.source as Buffer);
      return {
        ...summary,
        text: parsed.text ?? null,
        html: typeof parsed.html === "string" ? parsed.html : null,
        attachments: (parsed.attachments ?? []).map((a, index) => ({
          index,
          filename: a.filename ?? `attachment-${index}`,
          contentType: a.contentType,
          size: a.size,
        })),
      };
    });
  }

  async getThread(_threadId: string): Promise<MessageSummary[]> {
    throw new Error(
      "This provider has no server-side threads. Fetch messages individually with get_message.",
    );
  }

  async getAttachment(id: string, index: number, savePath?: string): Promise<AttachmentResult> {
    return this.withMessage(id, async (client, uid) => {
      const msg = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!msg) throw new NotFoundError(id);
      const parsed = await simpleParser(msg.source as Buffer);
      const att = parsed.attachments?.[index];
      if (!att) {
        throw new Error(`No attachment at index ${index} (message has ${parsed.attachments?.length ?? 0}).`);
      }
      const filename = att.filename ?? `attachment-${index}`;
      if (savePath) {
        await mkdir(dirname(savePath), { recursive: true });
        await writeFile(savePath, att.content);
        return { filename, contentType: att.contentType, size: att.size, saved: savePath };
      }
      if (att.size > MAX_INLINE_ATTACHMENT) {
        throw new Error(`Attachment is ${att.size} bytes; too large to inline. Pass savePath to write it to disk.`);
      }
      return {
        filename,
        contentType: att.contentType,
        size: att.size,
        contentBase64: att.content.toString("base64"),
      };
    });
  }

  // ----- generic write ops (folder-based) -----

  async modifyLabels(_id: string, _add: string[], _remove: string[]): Promise<MutationResult> {
    throw new Error("This provider is folder-based (no labels). Use move to relocate a message.");
  }

  private async setFlag(id: string, flag: string, on: boolean): Promise<MutationResult> {
    return this.withMessage(id, async (client, uid) => {
      if (on) await client.messageFlagsAdd(String(uid), [flag], { uid: true });
      else await client.messageFlagsRemove(String(uid), [flag], { uid: true });
      return { gmMsgId: id, flag, on };
    });
  }

  markRead(id: string, on: boolean): Promise<MutationResult> {
    return this.setFlag(id, "\\Seen", on);
  }

  star(id: string, on: boolean): Promise<MutationResult> {
    return this.setFlag(id, "\\Flagged", on);
  }

  async archive(id: string): Promise<MutationResult> {
    const boxes = await this.boxes();
    const archive = this.requireBox(boxes, "archive");
    return this.move(id, archive);
  }

  async move(id: string, target: string): Promise<MutationResult> {
    return this.withMessage(id, async (client, uid) => {
      await client.messageMove(String(uid), target, { uid: true });
      return { gmMsgId: id, movedTo: target };
    });
  }

  async trash(id: string): Promise<MutationResult> {
    const boxes = await this.boxes();
    const trash = this.requireBox(boxes, "trash");
    return this.withMessage(id, async (client, uid) => {
      await client.messageMove(String(uid), trash, { uid: true });
      return { gmMsgId: id, trashed: true };
    });
  }

  async delete(id: string): Promise<MutationResult> {
    // Standard IMAP permanent delete: \Deleted + EXPUNGE in place.
    return this.withMessage(id, async (client, uid) => {
      await client.messageDelete(String(uid), { uid: true });
      return { gmMsgId: id, deleted: true };
    });
  }
}
