import type { ImapFlow } from "imapflow";

/**
 * Gmail's special mailboxes are localized (e.g. `[Gmail]/Kosz` in Polish), so
 * we never hard-code names — we discover them by their IMAP special-use flag.
 */
export interface SpecialMailboxes {
  inbox: string;
  all?: string;
  trash?: string;
  drafts?: string;
  sent?: string;
  junk?: string;
}

const cache = new Map<string, SpecialMailboxes>();

export async function getSpecialMailboxes(
  client: ImapFlow,
  email: string,
): Promise<SpecialMailboxes> {
  const cached = cache.get(email);
  if (cached) return cached;

  const boxes: SpecialMailboxes = { inbox: "INBOX" };
  for (const mb of await client.list()) {
    switch (mb.specialUse) {
      case "\\All":
        boxes.all = mb.path;
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
  cache.set(email, boxes);
  return boxes;
}

/** The mailbox to run whole-account searches against (All Mail, else INBOX). */
export function searchScope(boxes: SpecialMailboxes): string {
  return boxes.all ?? boxes.inbox;
}

export function requireBox(
  boxes: SpecialMailboxes,
  key: "all" | "trash" | "drafts" | "sent" | "junk",
): string {
  const path = boxes[key];
  if (!path) {
    throw new Error(`This account has no ${key} mailbox exposed over IMAP.`);
  }
  return path;
}
