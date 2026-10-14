/**
 * Sealed values: JSON encrypted with AES-GCM under a key only the worker has,
 * so the browser can hold sign-in state it can neither read nor change. Each
 * sealed value has a kind, which is checked when it's opened, so a value made
 * for one purpose can't be used for another, and an expiry.
 */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (char) => char.charCodeAt(0));
}

/** What sealed values are for: OAuth's `state`, a sign-in on its way back to the admin panel, and a signed-in session. */
export type SealKind = "state" | "grant" | "session";

export interface Sealer {
  seal(kind: SealKind, value: unknown, lifetimeMs: number): Promise<string>;
  /** The value, or `undefined` if it isn't one this worker sealed for `kind`, or it has expired. */
  open<T>(kind: SealKind, sealed: unknown): Promise<T | undefined>;
}

const IV_BYTES = 12;

/** Seals values with `key`: 32 random bytes, base64-encoded, such as from `openssl rand -base64 32`. */
export async function createSealer(key: string, now: () => number = Date.now): Promise<Sealer> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = base64UrlDecode(key.trim());
  } catch {
    throw new Error("SESSION_KEY must be base64.");
  }
  if (raw.length !== 32) throw new Error("SESSION_KEY must be 32 bytes, such as from `openssl rand -base64 32`.");
  const cryptoKey = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  const encoder = new TextEncoder();

  return {
    async seal(kind, value, lifetimeMs) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const plain = encoder.encode(JSON.stringify({ expires: now() + lifetimeMs, value }));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(kind) }, cryptoKey, plain),
      );
      const out = new Uint8Array(IV_BYTES + sealed.length);
      out.set(iv);
      out.set(sealed, IV_BYTES);
      return base64UrlEncode(out);
    },

    async open<T>(kind: SealKind, sealed: unknown): Promise<T | undefined> {
      if (typeof sealed !== "string" || sealed.length > 16_384 || !/^[\w-]+$/.test(sealed)) return undefined;
      try {
        const bytes = base64UrlDecode(sealed);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: bytes.subarray(0, IV_BYTES), additionalData: encoder.encode(kind) },
          cryptoKey,
          bytes.subarray(IV_BYTES),
        );
        const { expires, value } = JSON.parse(new TextDecoder().decode(plain)) as { expires: number; value: T };
        return typeof expires === "number" && expires > now() ? value : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/** PKCE's S256: the challenge the admin panel sends is the hash of a verifier only it knows. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}
