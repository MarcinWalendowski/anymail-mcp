import {
  deleteAppPassword,
  hasAppPassword,
  setAppPassword,
} from "./keychain.js";
import {
  type Account,
  getAccount,
  loadAccounts,
  removeAccount as removeFromRegistry,
  upsertAccount,
} from "./registry.js";
import { getImap } from "./gmail/pool.js";
import { getSpecialMailboxes, type SpecialMailboxes } from "./gmail/mailboxes.js";
import { dropTransport, verifySmtp } from "./gmail/smtp.js";

// Single source of truth for account management, shared by the CLI and the HTTP
// admin API. Never returns or logs the App Password.

export interface PublicAccount {
  email: string;
  displayName: string | null;
  default: boolean;
  readOnly: boolean;
  credentialPresent: boolean;
}

export interface AddAccountInput {
  email: string;
  appPassword: string;
  displayName?: string;
  default?: boolean;
  readOnly?: boolean;
}

function toPublic(a: Account): PublicAccount {
  return {
    email: a.email,
    displayName: a.displayName ?? null,
    default: Boolean(a.default),
    readOnly: Boolean(a.readOnly),
    credentialPresent: hasAppPassword(a.email),
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function listPublic(): PublicAccount[] {
  return loadAccounts().map(toPublic);
}

/**
 * Store the App Password, verify IMAP + SMTP actually log in, then persist the
 * account. On failure the password is rolled back so we never keep a bad one.
 */
export async function addAccount(input: AddAccountInput): Promise<PublicAccount> {
  const email = input.email.trim();
  const pass = (input.appPassword ?? "").replace(/\s+/g, "");
  if (!email) throw new Error("email is required");
  if (!pass) throw new Error("appPassword is required");

  setAppPassword(email, pass);
  try {
    const client = await getImap(email);
    await getSpecialMailboxes(client, email);
    await verifySmtp(email);
  } catch (e) {
    deleteAppPassword(email);
    dropTransport(email);
    throw new Error(`Login failed for ${email}: ${errMsg(e)}. App Password was not saved.`);
  }

  const account: Account = {
    email,
    displayName: input.displayName,
    default: input.default,
    readOnly: input.readOnly,
  };
  upsertAccount(account);
  return toPublic(account);
}

export async function testAccount(email: string): Promise<{ ok: true; mailboxes: SpecialMailboxes }> {
  const client = await getImap(email);
  const mailboxes = await getSpecialMailboxes(client, email);
  await verifySmtp(email);
  return { ok: true, mailboxes };
}

export function removeAccount(email: string): void {
  deleteAppPassword(email);
  dropTransport(email);
  removeFromRegistry(email);
}

export function setDefault(email: string): PublicAccount {
  const account = getAccount(email);
  upsertAccount({ ...account, default: true });
  return toPublic({ ...account, default: true });
}
