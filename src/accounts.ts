import { deleteAppPassword, hasAppPassword, setAppPassword } from "./keychain.js";
import {
  type Account,
  getAccount,
  loadAccounts,
  removeAccount as removeFromRegistry,
  upsertAccount,
} from "./registry.js";
import { buildProvider, dropProvider, getProvider, resolveConnection } from "./providers/index.js";
import type { ConnectionConfig, ProviderId, SpecialMailboxes } from "./providers/types.js";

// Single source of truth for account management, shared by the CLI and the HTTP
// admin API. Never returns or logs the App Password.

export interface PublicAccount {
  email: string;
  displayName: string | null;
  provider: ProviderId;
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
  /** Defaults to "gmail". */
  provider?: ProviderId;
  /** Required only for provider "imap" (custom host). Presets cover the rest. */
  connection?: ConnectionConfig;
}

function toPublic(a: Account): PublicAccount {
  return {
    email: a.email,
    displayName: a.displayName ?? null,
    provider: a.provider ?? "gmail",
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

  const providerId = input.provider ?? "gmail";
  const conn = resolveConnection(providerId, input.connection);

  setAppPassword(email, pass);
  const probe = buildProvider(email, providerId, conn);
  try {
    await probe.verify(); // IMAP login + special-mailbox discovery + SMTP login
  } catch (e) {
    deleteAppPassword(email);
    await probe.close();
    throw new Error(`Login failed for ${email}: ${errMsg(e)}. App Password was not saved.`);
  }
  await probe.close();

  const account: Account = {
    email,
    displayName: input.displayName,
    default: input.default,
    readOnly: input.readOnly,
    provider: providerId,
    connection: providerId === "imap" ? conn : undefined,
  };
  upsertAccount(account);
  return toPublic(account);
}

export async function testAccount(email: string): Promise<{ ok: true; mailboxes: SpecialMailboxes }> {
  const mailboxes = await getProvider(email).verify();
  return { ok: true, mailboxes };
}

export function removeAccount(email: string): void {
  deleteAppPassword(email);
  dropProvider(email);
  removeFromRegistry(email);
}

export function setDefault(email: string): PublicAccount {
  const account = getAccount(email);
  upsertAccount({ ...account, default: true });
  return toPublic({ ...account, default: true });
}
