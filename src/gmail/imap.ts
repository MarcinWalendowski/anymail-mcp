import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getImap } from "./pool.js";
import { getSpecialMailboxes, requireBox, searchScope } from "./mailboxes.js";

// Derive the fetch result element type straight from the method so we don't
// depend on a specific exported type name.
type FetchMsg = Awaited<ReturnType<ImapFlow["fetchAll"]>>[number];
type Address = { name?: string; address?: string };

const SUMMARY_QUERY = {
  uid: true,
  envelope: true,
  emailId: true,
  threadId: true,
  labels: true,
  flags: true,
  internalDate: true,
  size: true,
} as const;

const FULL_QUERY = { ...SUMMARY_QUERY, source: true } as const;

const MAX_INLINE_ATTACHMENT = 5_000_000; // require a savePath above this

export interface MessageSummary {
  gmMsgId: string | null;
  gmThrId: string | null;
  uid: number;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  labels: string[];
  flags: string[];
  unread: boolean;
  size: number | null;
}

// ---------- helpers ----------

async function withMailbox<T>(client: ImapFlow, path: string, fn: () => Promise<T>): Promise<T> {
  const lock = await client.getMailboxLock(path);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

/**
 * Resolve a Gmail message id (X-GM-MSGID, exposed by ImapFlow as `emailId`) to
 * a UID in the currently-open mailbox. ImapFlow maps the `emailId` search key
 * to X-GM-MSGID when the server advertises X-GM-EXT-1 (Gmail does).
 */
async function resolveUid(client: ImapFlow, gmMsgId: string): Promise<number | undefined> {
  const uids = await client.search({ emailId: gmMsgId }, { uid: true });
  if (uids && uids.length) return uids[uids.length - 1];
  return undefined;
}

function fmtAddr(list?: Address[]): string {
  if (!list?.length) return "";
  return list
    .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : (a.address ?? "")))
    .join(", ");
}

function toIso(d?: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

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

function byDateDesc(a: MessageSummary, b: MessageSummary): number {
  return (b.date ?? "").localeCompare(a.date ?? "");
}

class NotFoundError extends Error {
  constructor(gmMsgId: string) {
    super(`Message ${gmMsgId} not found in this account (it may be in Trash/Spam — try in:anywhere).`);
  }
}

// ---------- read ----------

export async function searchMessages(
  email: string,
  query: string,
  limit = 25,
  label?: string,
): Promise<MessageSummary[]> {
  const client = await getImap(email);
  const boxes = await getSpecialMailboxes(client, email);
  const scope = label ?? searchScope(boxes);
  return withMailbox(client, scope, async () => {
    const uids = await client.search({ gmraw: query }, { uid: true });
    if (!uids || uids.length === 0) return [];
    const chosen = uids.slice(-Math.max(1, limit)); // newest UIDs are highest
    const msgs = await client.fetchAll(chosen, SUMMARY_QUERY, { uid: true });
    return msgs.map(formatSummary).sort(byDateDesc);
  });
}

export interface FullMessage extends MessageSummary {
  text: string | null;
  html: string | null;
  attachments: { index: number; filename: string; contentType: string; size: number }[];
}

export async function getMessage(email: string, gmMsgId: string): Promise<FullMessage> {
  const client = await getImap(email);
  const boxes = await getSpecialMailboxes(client, email);
  return withMailbox(client, searchScope(boxes), async () => {
    const uid = await resolveUid(client, gmMsgId);
    if (uid === undefined) throw new NotFoundError(gmMsgId);
    const msg = await client.fetchOne(String(uid), FULL_QUERY, { uid: true });
    if (!msg) throw new NotFoundError(gmMsgId);
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

export async function getThread(email: string, gmThrId: string): Promise<MessageSummary[]> {
  const client = await getImap(email);
  const boxes = await getSpecialMailboxes(client, email);
  return withMailbox(client, searchScope(boxes), async () => {
    const uids = await client.search({ threadId: gmThrId }, { uid: true });
    if (!uids || uids.length === 0) return [];
    const msgs = await client.fetchAll(uids, SUMMARY_QUERY, { uid: true });
    return msgs.map(formatSummary).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  });
}

export async function listLabels(
  email: string,
): Promise<{ path: string; name: string; specialUse: string | null }[]> {
  const client = await getImap(email);
  const list = await client.list();
  return list.map((mb) => ({
    path: mb.path,
    name: mb.name,
    specialUse: mb.specialUse ?? null,
  }));
}

export async function getAttachment(
  email: string,
  gmMsgId: string,
  index: number,
  savePath?: string,
): Promise<
  | { filename: string; contentType: string; size: number; contentBase64: string }
  | { filename: string; contentType: string; size: number; saved: string }
> {
  const client = await getImap(email);
  const boxes = await getSpecialMailboxes(client, email);
  return withMailbox(client, searchScope(boxes), async () => {
    const uid = await resolveUid(client, gmMsgId);
    if (uid === undefined) throw new NotFoundError(gmMsgId);
    const msg = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
    if (!msg) throw new NotFoundError(gmMsgId);
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
      throw new Error(
        `Attachment is ${att.size} bytes; too large to inline. Pass savePath to write it to disk.`,
      );
    }
    return {
      filename,
      contentType: att.contentType,
      size: att.size,
      contentBase64: att.content.toString("base64"),
    };
  });
}

// ---------- update ----------

export async function modifyLabels(
  email: string,
  gmMsgId: string,
  add: string[] = [],
  remove: string[] = [],
): Promise<{ gmMsgId: string; added: string[]; removed: string[] }> {
  const client = await getImap(email);
  const boxes = await getSpecialMailboxes(client, email);
  return withMailbox(client, searchScope(boxes), async () => {
    const uid = await resolveUid(client, gmMsgId);
    if (uid === undefined) throw new NotFoundError(gmMsgId);
    if (add.length) await client.messageFlagsAdd(String(uid), add, { uid: true, useLabels: true });
    if (remove.length)
      await client.messageFlagsRemove(String(uid), remove, { uid: true, useLabels: true });
    return { gmMsgId, added: add, removed: remove };
  });
}

async function setFlag(
  email: string,
  gmMsgId: string,
  flag: string,
  on: boolean,
): Promise<{ gmMsgId: string; flag: string; on: boolean }> {
  const client = await getImap(email);
  const boxes = await getSpecialMailboxes(client, email);
  return withMailbox(client, searchScope(boxes), async () => {
    const uid = await resolveUid(client, gmMsgId);
    if (uid === undefined) throw new NotFoundError(gmMsgId);
    if (on) await client.messageFlagsAdd(String(uid), [flag], { uid: true });
    else await client.messageFlagsRemove(String(uid), [flag], { uid: true });
    return { gmMsgId, flag, on };
  });
}

export const markRead = (email: string, id: string) => setFlag(email, id, "\\Seen", true);
export const markUnread = (email: string, id: string) => setFlag(email, id, "\\Seen", false);
// Gmail surfaces the IMAP \Flagged flag as a star.
export const star = (email: string, id: string) => setFlag(email, id, "\\Flagged", true);
export const unstar = (email: string, id: string) => setFlag(email, id, "\\Flagged", false);

/** Archive = drop the Inbox label (Gmail keeps the message in All Mail). */
export const archive = (email: string, id: string) => modifyLabels(email, id, [], ["\\Inbox"]);

/** Move = apply a label and remove from the Inbox (Gmail is label-based). */
export const moveMessage = (email: string, id: string, targetLabel: string) =>
  modifyLabels(email, id, [targetLabel], ["\\Inbox"]);

export async function createLabel(email: string, name: string): Promise<{ path: string; created: boolean }> {
  const client = await getImap(email);
  const res = await client.mailboxCreate(name);
  return { path: res.path, created: res.created };
}

// ---------- delete ----------

export async function trashMessage(email: string, gmMsgId: string): Promise<{ gmMsgId: string; trashed: boolean }> {
  const client = await getImap(email);
  const boxes = await getSpecialMailboxes(client, email);
  const trash = requireBox(boxes, "trash");
  return withMailbox(client, searchScope(boxes), async () => {
    const uid = await resolveUid(client, gmMsgId);
    if (uid === undefined) throw new NotFoundError(gmMsgId);
    await client.messageMove(String(uid), trash, { uid: true });
    return { gmMsgId, trashed: true };
  });
}

/**
 * Permanent delete: ensure the message is in Trash, then EXPUNGE it there.
 * Gmail only honors a real delete from within the Trash mailbox; a \Deleted +
 * EXPUNGE anywhere else just removes that one label.
 */
export async function deleteMessage(email: string, gmMsgId: string): Promise<{ gmMsgId: string; deleted: boolean }> {
  const client = await getImap(email);
  const boxes = await getSpecialMailboxes(client, email);
  const trash = requireBox(boxes, "trash");

  // Step 1: move into Trash if it's still elsewhere.
  await withMailbox(client, searchScope(boxes), async () => {
    const uid = await resolveUid(client, gmMsgId);
    if (uid !== undefined) await client.messageMove(String(uid), trash, { uid: true });
  });

  // Step 2: permanently remove it from Trash.
  return withMailbox(client, trash, async () => {
    const uid = await resolveUid(client, gmMsgId);
    if (uid === undefined) return { gmMsgId, deleted: true }; // already gone
    await client.messageDelete(String(uid), { uid: true });
    return { gmMsgId, deleted: true };
  });
}
