/**
 * Deploy keys and Actions secrets, for connecting a site's private code and
 * content repositories: each workflow reads the other repository with a
 * deploy key, whose private half is a secret of the repository it runs in.
 * Loaded only by the setup page, when it connects them.
 */
import { encodeBase64Bytes } from "@goodfellow-cms/core";
import { hsalsa, xsalsa20poly1305 } from "@noble/ciphers/salsa.js";
import { blake2b } from "@noble/hashes/blake2.js";

export interface DeployKey {
  /** For the repository being read: `ssh-ed25519 …`. */
  publicKey: string;
  /** For the workflow reading it, in OpenSSH's format, as `actions/checkout`'s `ssh-key` takes it. */
  privateKey: string;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

/** SSH's encoding of a number: four bytes, most significant first. */
function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

/** SSH's encoding of a string of bytes: its length, then the bytes. */
function sshString(value: Uint8Array | string): Uint8Array {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return concat(uint32(bytes.length), bytes);
}

/** A new Ed25519 key pair, made with the browser's own Web Crypto, as `ssh-keygen -t ed25519 -N ""` would make it. */
export async function newDeployKey(comment: string): Promise<DeployKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  // An Ed25519 key's PKCS #8 form ends with its 32-byte seed.
  const seed = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).slice(-32);
  const publicBlob = concat(sshString("ssh-ed25519"), sshString(publicKey));
  const check = crypto.getRandomValues(new Uint8Array(4));
  let secret = concat(
    check,
    check,
    sshString("ssh-ed25519"),
    sshString(publicKey),
    sshString(concat(seed, publicKey)),
    sshString(comment),
  );
  // Padded to the cipher's block size, which is 8 for an unencrypted key.
  const padding = Array.from({ length: (8 - (secret.length % 8)) % 8 }, (_, index) => index + 1);
  secret = concat(secret, new Uint8Array(padding));
  const body = concat(
    new TextEncoder().encode("openssh-key-v1\0"),
    sshString("none"),
    sshString("none"),
    sshString(""),
    uint32(1),
    sshString(publicBlob),
    sshString(secret),
  );
  const lines = encodeBase64Bytes(body).match(/.{1,70}/g) ?? [];
  seed.fill(0);
  secret.fill(0);
  return {
    publicKey: `ssh-ed25519 ${encodeBase64Bytes(publicBlob)} ${comment}`,
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join("\n")}\n-----END OPENSSH PRIVATE KEY-----\n`,
  };
}

const SIGMA = new TextEncoder().encode("expand 32-byte k");

function words(bytes: Uint8Array): Uint32Array {
  return new Uint32Array(bytes.slice().buffer);
}

/**
 * Encrypts a value for an Actions secret, as libsodium's `crypto_box_seal`
 * does, which is what GitHub expects: an X25519 key of its own, the Web
 * Crypto key agreement with the repository's public key, and XSalsa20-Poly1305.
 */
export async function sealSecret(value: string, recipient: Uint8Array): Promise<Uint8Array> {
  const ephemeral = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const recipientKey = await crypto.subtle.importKey("raw", recipient.slice(), { name: "X25519" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "X25519", public: recipientKey }, ephemeral.privateKey, 256),
  );
  // crypto_box's key is HSalsa20 of the shared secret, and a sealed box's nonce is a hash of both public keys.
  const key = new Uint32Array(8);
  hsalsa(words(SIGMA), words(shared), new Uint32Array(4), key);
  const nonce = blake2b(concat(ephemeralPublic, recipient), { dkLen: 24 });
  const keyBytes = new Uint8Array(key.buffer);
  const sealed = xsalsa20poly1305(keyBytes, nonce).encrypt(new TextEncoder().encode(value));
  shared.fill(0);
  keyBytes.fill(0);
  return concat(ephemeralPublic, sealed);
}

/** Opens a sealed value with the recipient's X25519 key pair, as GitHub does with a secret. For the fake. */
export async function openSealedSecret(sealed: Uint8Array, recipient: CryptoKeyPair): Promise<string> {
  const ephemeralPublic = sealed.slice(0, 32);
  const recipientPublic = new Uint8Array(await crypto.subtle.exportKey("raw", recipient.publicKey));
  const ephemeralKey = await crypto.subtle.importKey("raw", ephemeralPublic, { name: "X25519" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "X25519", public: ephemeralKey }, recipient.privateKey, 256),
  );
  const key = new Uint32Array(8);
  hsalsa(words(SIGMA), words(shared), new Uint32Array(4), key);
  const nonce = blake2b(concat(ephemeralPublic, recipientPublic), { dkLen: 24 });
  return new TextDecoder().decode(xsalsa20poly1305(new Uint8Array(key.buffer), nonce).decrypt(sealed.slice(32)));
}
