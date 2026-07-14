import { Entry } from "@napi-rs/keyring";

// @napi-rs/keyring ships prebuilt native binaries (no node-gyp) and is backed
// by the macOS Security framework (login Keychain) on darwin.
const SERVICE = "gmail-mcp";

// Cache passwords in memory for the process lifetime. Reading the Keychain on
// every IMAP/SMTP (re)connect would trigger a "node wants to use your keychain"
// prompt each time; reading once keeps it quiet.
const cache = new Map<string, string>();

function entry(email: string): Entry {
  return new Entry(SERVICE, email.toLowerCase());
}

export function setAppPassword(email: string, appPassword: string): void {
  entry(email).setPassword(appPassword);
  cache.set(email.toLowerCase(), appPassword);
}

export function getAppPassword(email: string): string {
  const key = email.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const pass = entry(email).getPassword();
    if (!pass) throw new Error("empty");
    cache.set(key, pass);
    return pass;
  } catch {
    throw new Error(
      `No App Password found in Keychain for ${email}. Run: anymail-mcp add ${email}`,
    );
  }
}

export function hasAppPassword(email: string): boolean {
  if (cache.has(email.toLowerCase())) return true;
  try {
    return Boolean(entry(email).getPassword());
  } catch {
    return false;
  }
}

export function deleteAppPassword(email: string): void {
  cache.delete(email.toLowerCase());
  try {
    entry(email).deletePassword();
  } catch {
    // Nothing stored — treat as already deleted.
  }
}
