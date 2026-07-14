import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  ImapProvider,
  MAX_INLINE_ATTACHMENT,
  NotFoundError,
  byDateDesc,
  formatSummary,
  withMailbox,
} from "./imap.js";
import type {
  AttachmentResult,
  ConnectionConfig,
  FullMessage,
  MessageSummary,
  MutationResult,
  ProviderCapabilities,
} from "./types.js";

// Gmail exposes X-GM-MSGID / X-GM-THRID / labels via these fetch keys.
const GMAIL_SUMMARY_QUERY = {
  uid: true,
  envelope: true,
  emailId: true,
  threadId: true,
  labels: true,
  flags: true,
  internalDate: true,
  size: true,
} as const;

const GMAIL_FULL_QUERY = { ...GMAIL_SUMMARY_QUERY, source: true } as const;

/**
 * Gmail provider: IMAP + Gmail's X-GM-* extensions. This is the original,
 * battle-tested Gmail implementation moved behind the MailProvider interface —
 * search via X-GM-RAW, stable X-GM-MSGID ids, X-GM-THRID threads, and Gmail's
 * label model (archive = drop \Inbox). Only the ops that differ from plain IMAP
 * are overridden; connection, SMTP, drafts, folder create/list, and verify are
 * inherited unchanged from ImapProvider.
 */
export class GmailProvider extends ImapProvider {
  readonly capabilities: ProviderCapabilities = {
    labels: true,
    threads: true,
    nativeSearch: true,
  };

  constructor(email: string, conn: ConnectionConfig) {
    super(email, conn, "gmail");
  }

  /**
   * Resolve a Gmail message id (X-GM-MSGID, exposed by ImapFlow as `emailId`) to
   * a UID in the currently-open mailbox. ImapFlow maps the `emailId` search key
   * to X-GM-MSGID when the server advertises X-GM-EXT-1 (Gmail does).
   */
  private async resolveUid(client: ImapFlow, gmMsgId: string): Promise<number | undefined> {
    const uids = await client.search({ emailId: gmMsgId }, { uid: true });
    if (uids && uids.length) return uids[uids.length - 1];
    return undefined;
  }

  // ---------- read ----------

  async search(query: string, limit = 25, folder?: string): Promise<MessageSummary[]> {
    const client = await this.getClient();
    const boxes = await this.boxes();
    const scope = folder ?? this.searchScope(boxes);
    return withMailbox(client, scope, async () => {
      const uids = await client.search({ gmraw: query }, { uid: true });
      if (!uids || uids.length === 0) return [];
      const chosen = uids.slice(-Math.max(1, limit)); // newest UIDs are highest
      const msgs = await client.fetchAll(chosen, GMAIL_SUMMARY_QUERY, { uid: true });
      return msgs.map(formatSummary).sort(byDateDesc);
    });
  }

  async getMessage(id: string): Promise<FullMessage> {
    const client = await this.getClient();
    const boxes = await this.boxes();
    return withMailbox(client, this.searchScope(boxes), async () => {
      const uid = await this.resolveUid(client, id);
      if (uid === undefined) throw new NotFoundError(id);
      const msg = await client.fetchOne(String(uid), GMAIL_FULL_QUERY, { uid: true });
      if (!msg) throw new NotFoundError(id);
      const summary = formatSummary(msg);
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

  async getThread(threadId: string): Promise<MessageSummary[]> {
    const client = await this.getClient();
    const boxes = await this.boxes();
    return withMailbox(client, this.searchScope(boxes), async () => {
      const uids = await client.search({ threadId }, { uid: true });
      if (!uids || uids.length === 0) return [];
      const msgs = await client.fetchAll(uids, GMAIL_SUMMARY_QUERY, { uid: true });
      return msgs.map(formatSummary).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    });
  }

  async getAttachment(id: string, index: number, savePath?: string): Promise<AttachmentResult> {
    const client = await this.getClient();
    const boxes = await this.boxes();
    return withMailbox(client, this.searchScope(boxes), async () => {
      const uid = await this.resolveUid(client, id);
      if (uid === undefined) throw new NotFoundError(id);
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

  // ---------- update (label-based) ----------

  async modifyLabels(id: string, add: string[] = [], remove: string[] = []): Promise<MutationResult> {
    const client = await this.getClient();
    const boxes = await this.boxes();
    return withMailbox(client, this.searchScope(boxes), async () => {
      const uid = await this.resolveUid(client, id);
      if (uid === undefined) throw new NotFoundError(id);
      if (add.length) await client.messageFlagsAdd(String(uid), add, { uid: true, useLabels: true });
      if (remove.length) await client.messageFlagsRemove(String(uid), remove, { uid: true, useLabels: true });
      return { gmMsgId: id, added: add, removed: remove };
    });
  }

  private async flagMessage(id: string, flag: string, on: boolean): Promise<MutationResult> {
    const client = await this.getClient();
    const boxes = await this.boxes();
    return withMailbox(client, this.searchScope(boxes), async () => {
      const uid = await this.resolveUid(client, id);
      if (uid === undefined) throw new NotFoundError(id);
      if (on) await client.messageFlagsAdd(String(uid), [flag], { uid: true });
      else await client.messageFlagsRemove(String(uid), [flag], { uid: true });
      return { gmMsgId: id, flag, on };
    });
  }

  markRead(id: string, on: boolean): Promise<MutationResult> {
    return this.flagMessage(id, "\\Seen", on);
  }

  // Gmail surfaces the IMAP \Flagged flag as a star.
  star(id: string, on: boolean): Promise<MutationResult> {
    return this.flagMessage(id, "\\Flagged", on);
  }

  /** Archive = drop the Inbox label (Gmail keeps the message in All Mail). */
  archive(id: string): Promise<MutationResult> {
    return this.modifyLabels(id, [], ["\\Inbox"]);
  }

  /** Move = apply a label and remove from the Inbox (Gmail is label-based). */
  move(id: string, targetLabel: string): Promise<MutationResult> {
    return this.modifyLabels(id, [targetLabel], ["\\Inbox"]);
  }

  // ---------- delete ----------

  async trash(id: string): Promise<MutationResult> {
    const client = await this.getClient();
    const boxes = await this.boxes();
    const trash = this.requireBox(boxes, "trash");
    return withMailbox(client, this.searchScope(boxes), async () => {
      const uid = await this.resolveUid(client, id);
      if (uid === undefined) throw new NotFoundError(id);
      await client.messageMove(String(uid), trash, { uid: true });
      return { gmMsgId: id, trashed: true };
    });
  }

  /**
   * Permanent delete: ensure the message is in Trash, then EXPUNGE it there.
   * Gmail only honors a real delete from within the Trash mailbox; a \Deleted +
   * EXPUNGE anywhere else just removes that one label.
   */
  async delete(id: string): Promise<MutationResult> {
    const client = await this.getClient();
    const boxes = await this.boxes();
    const trash = this.requireBox(boxes, "trash");

    // Step 1: move into Trash if it's still elsewhere.
    await withMailbox(client, this.searchScope(boxes), async () => {
      const uid = await this.resolveUid(client, id);
      if (uid !== undefined) await client.messageMove(String(uid), trash, { uid: true });
    });

    // Step 2: permanently remove it from Trash.
    return withMailbox(client, trash, async () => {
      const uid = await this.resolveUid(client, id);
      if (uid === undefined) return { gmMsgId: id, deleted: true }; // already gone
      await client.messageDelete(String(uid), { uid: true });
      return { gmMsgId: id, deleted: true };
    });
  }
}
