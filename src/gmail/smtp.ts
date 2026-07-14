import nodemailer, { type Transporter } from "nodemailer";
import { getAppPassword } from "../keychain.js";
import { getImap } from "./pool.js";
import { getSpecialMailboxes, requireBox } from "./mailboxes.js";

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;

const transporters = new Map<string, Transporter>();

function getTransport(email: string): Transporter {
  let t = transporters.get(email);
  if (!t) {
    t = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: true,
      auth: { user: email, pass: getAppPassword(email) },
    });
    transporters.set(email, t);
  }
  return t;
}

export function dropTransport(email: string): void {
  transporters.delete(email);
}

export async function verifySmtp(email: string): Promise<boolean> {
  return getTransport(email).verify();
}

export interface AttachmentInput {
  filename?: string;
  /** Absolute path to a local file. */
  path?: string;
  /** Base64-encoded content (used when no path is given). */
  contentBase64?: string;
  contentType?: string;
}

function toAttachments(atts?: AttachmentInput[]) {
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

export interface ComposeInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  /** RFC822 Message-ID of the message being replied to (threads in Gmail). */
  inReplyTo?: string;
  attachments?: AttachmentInput[];
}

export async function sendMessage(
  email: string,
  input: ComposeInput,
): Promise<{ messageId: string; accepted: string[]; rejected: string[]; response: string }> {
  const info = await getTransport(email).sendMail({
    from: email,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    html: input.html,
    inReplyTo: input.inReplyTo,
    references: input.inReplyTo ? [input.inReplyTo] : undefined,
    attachments: toAttachments(input.attachments),
  });
  // Gmail's SMTP automatically files a copy in [Gmail]/Sent Mail — no APPEND needed.
  return {
    messageId: info.messageId,
    accepted: info.accepted as string[],
    rejected: info.rejected as string[],
    response: info.response,
  };
}

export async function createDraft(
  email: string,
  input: ComposeInput,
): Promise<{ mailbox: string; uid: number | null }> {
  // Build the raw MIME without sending (stream transport, buffered), then APPEND
  // it into the Drafts mailbox with the \Draft flag.
  const generator = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "\r\n",
  });
  const built = await generator.sendMail({
    from: email,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    html: input.html,
    inReplyTo: input.inReplyTo,
    references: input.inReplyTo ? [input.inReplyTo] : undefined,
    attachments: toAttachments(input.attachments),
  });
  const raw = (built as unknown as { message: Buffer }).message;

  const client = await getImap(email);
  const boxes = await getSpecialMailboxes(client, email);
  const drafts = requireBox(boxes, "drafts");
  const resp = await client.append(drafts, raw, ["\\Draft"]);
  return { mailbox: drafts, uid: resp && resp.uid != null ? resp.uid : null };
}
