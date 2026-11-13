/**
 * SSH keys made in the browser or Node with Web Crypto, for a host to let a job
 * that holds the private half read or publish one repository: GitHub's deploy
 * keys connecting a site's code and content, and GitLab's that a publishing job
 * pushes with.
 */
import { encodeBase64Bytes } from "./git.js";

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
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
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
