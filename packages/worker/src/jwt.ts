/**
 * The JSON Web Token a GitHub App signs with its private key to call GitHub
 * as the app itself, such as to find its installation on a repository and
 * create installation tokens.
 */
import { base64UrlDecode, base64UrlEncode } from "./seal.js";

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, content: Uint8Array): Uint8Array {
  const length = derLength(content.length);
  const out = new Uint8Array(1 + length.length + content.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(content, 1 + length.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** `rsaEncryption`'s algorithm identifier, as PKCS #8 names it. */
const RSA_ALGORITHM = new Uint8Array([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

/**
 * GitHub gives apps PKCS #1 keys (`BEGIN RSA PRIVATE KEY`), which Web Crypto
 * can't read, so they're wrapped in PKCS #8 (`BEGIN PRIVATE KEY`), which it can.
 */
export function pkcs8FromPkcs1(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const wrapped = der(0x30, concat(new Uint8Array([0x02, 0x01, 0x00]), RSA_ALGORITHM, der(0x04, pkcs1)));
  return new Uint8Array(wrapped);
}

/** Reads a PEM private key, either kind, as pasted into a secret: real line breaks or `\n`s. */
export function privateKeyBytes(pem: string): Uint8Array<ArrayBuffer> {
  const text = pem.replace(/\\n/g, "\n").trim();
  const match = text.match(/-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (RSA )?PRIVATE KEY-----/);
  if (!match) throw new Error("The GitHub App's private key must be in PEM format.");
  const bytes = base64UrlDecode((match[2] ?? "").replace(/\s+/g, ""));
  return match[1] ? pkcs8FromPkcs1(bytes) : bytes;
}

const keys = new Map<string, Promise<CryptoKey>>();

function signingKey(pem: string): Promise<CryptoKey> {
  let key = keys.get(pem);
  if (!key) {
    key = crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes(pem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    key.catch(() => keys.delete(pem));
    keys.set(pem, key);
  }
  return key;
}

/** A token for calling GitHub as the app, valid for nine minutes (GitHub allows ten). */
export async function appJwt(appId: string, privateKey: string, now = Date.now()): Promise<string> {
  const encode = (value: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
  const seconds = Math.floor(now / 1000);
  // A minute early, in case GitHub's clock is behind.
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: appId })}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await signingKey(privateKey),
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}
