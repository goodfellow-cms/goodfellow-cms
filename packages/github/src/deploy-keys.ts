/**
 * Deploy keys and Actions secrets, for connecting a site's private code and
 * content repositories: each workflow reads the other repository with a
 * deploy key, whose private half is a secret of the repository it runs in.
 * Loaded only by the setup page, when it connects them.
 */
import { hsalsa, xsalsa20poly1305 } from "@noble/ciphers/salsa.js";
import { blake2b } from "@noble/hashes/blake2.js";

export { type DeployKey, newDeployKey } from "@goodfellow-cms/core";

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
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
