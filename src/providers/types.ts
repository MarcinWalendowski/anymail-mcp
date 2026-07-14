// The provider abstraction. Every account is served by one MailProvider; Gmail
// is one implementation (IMAP + X-GM-* extensions), and any other IMAP/SMTP host
// (iCloud, Fastmail, generic) is served by the base ImapProvider. Adding a
// provider = implement this interface (usually by extending ImapProvider).

export type ProviderId = "gmail" | "icloud" | "fastmail" | "imap";

/** IMAP + SMTP endpoints for an account. Presets fill this for known providers. */
export interface ConnectionConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** true = implicit TLS (465); false = STARTTLS (587). */
  smtpSecure: boolean;
}

/** What a provider can do, so the tool layer / model doesn't assume Gmail. */
export interface ProviderCapabilities {
  /** Gmail-style multi-labels (a message can carry many). False = single-folder model. */
  labels: boolean;
  /** Threads resolvable server-side (Gmail X-GM-THRID). */
  threads: boolean;
  /** Rich native search (Gmail X-GM-RAW). False = a limited IMAP-SEARCH subset. */
  nativeSearch: boolean;
}

/** Special-use mailboxes, discovered by IMAP flag (never hard-coded — they are localized). */
export interface SpecialMailboxes {
  inbox: string;
  all?: string;
  archive?: string;
  trash?: string;
  drafts?: string;
  sent?: string;
  junk?: string;
}

export interface MessageSummary {
  /** Opaque, provider-defined message id. Gmail: X-GM-MSGID. Generic IMAP: folder+uidvalidity+uid. */
  gmMsgId: string | null;
  /** Opaque thread id (Gmail X-GM-THRID); null on providers without server-side threads. */
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

export interface FullMessage extends MessageSummary {
  text: string | null;
  html: string | null;
  attachments: { index: number; filename: string; contentType: string; size: number }[];
}

export interface Folder {
  path: string;
  name: string;
  specialUse: string | null;
}

export interface AttachmentInput {
  filename?: string;
  /** Absolute path to a local file. */
  path?: string;
  /** Base64-encoded content (used when no path is given). */
  contentBase64?: string;
  contentType?: string;
}

export interface ComposeInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  /** RFC822 Message-ID of the message being replied to (sets In-Reply-To/References). */
  inReplyTo?: string;
  attachments?: AttachmentInput[];
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
}

export type AttachmentResult =
  | { filename: string; contentType: string; size: number; contentBase64: string }
  | { filename: string; contentType: string; size: number; saved: string };

/** A small status object returned by write ops. Always carries the message id. */
export interface MutationResult {
  gmMsgId: string;
  [key: string]: unknown;
}

export interface MailProvider {
  readonly id: ProviderId;
  readonly email: string;
  readonly capabilities: ProviderCapabilities;

  /** Log in over IMAP + SMTP and discover special mailboxes. Used by add/test. */
  verify(): Promise<SpecialMailboxes>;

  // read
  search(query: string, limit: number, folder?: string): Promise<MessageSummary[]>;
  getMessage(id: string): Promise<FullMessage>;
  getThread(threadId: string): Promise<MessageSummary[]>;
  listFolders(): Promise<Folder[]>;
  getAttachment(id: string, index: number, savePath?: string): Promise<AttachmentResult>;

  // create
  send(input: ComposeInput): Promise<SendResult>;
  createDraft(input: ComposeInput): Promise<{ mailbox: string; uid: number | null }>;
  createFolder(name: string): Promise<{ path: string; created: boolean }>;

  // update
  modifyLabels(id: string, add: string[], remove: string[]): Promise<MutationResult>;
  markRead(id: string, on: boolean): Promise<MutationResult>;
  star(id: string, on: boolean): Promise<MutationResult>;
  archive(id: string): Promise<MutationResult>;
  move(id: string, target: string): Promise<MutationResult>;

  // delete
  trash(id: string): Promise<MutationResult>;
  delete(id: string): Promise<MutationResult>;

  // lifecycle (connection pooling / idle sweep, driven by the registry)
  close(): Promise<void>;
  closeIfIdle(maxIdleMs: number): Promise<void>;
}
