// GitHub gives an app's private key as PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`), but Web Crypto, which signs the
// app's tokens on Workers, reads only PKCS#8 (`-----BEGIN PRIVATE KEY-----`). Workers' secrets hold whatever was
// pasted, often on one line with `\n` for each line break. This gives the PKCS#8 form of either, as PEM.

/** rsaEncryption's AlgorithmIdentifier, `SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }`, as DER. */
const RSA_ALGORITHM = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];

/** A DER length. */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function derOf(tag: number, content: Uint8Array | number[]): number[] {
  return [tag, ...derLength(content.length), ...content];
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function pem(label: string, der: Uint8Array): string {
  const lines = toBase64(der).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/**
 * The key as PKCS#8 PEM, as Web Crypto reads it: a PKCS#1 key is wrapped as `PrivateKeyInfo` (version 0, rsaEncryption,
 * and the key itself), and line breaks written as `\n` are made line breaks. Anything else is given back as it came,
 * with its line breaks, for the signing library to refuse in its own words.
 */
export function pkcs8Key(key: string): string {
  const text = key.replace(/\\n/g, "\n").replace(/\r\n?/g, "\n").trim();
  const pkcs1 = /^-----BEGIN RSA PRIVATE KEY-----\n([\s\S]+?)\n-----END RSA PRIVATE KEY-----$/.exec(text);
  if (!pkcs1) return `${text}\n`;
  const rsaKey = fromBase64((pkcs1[1] ?? "").replace(/\s+/g, ""));
  const info = [...[0x02, 0x01, 0x00], ...RSA_ALGORITHM, ...derOf(0x04, rsaKey)];
  return pem("PRIVATE KEY", Uint8Array.from(derOf(0x30, info)));
}

/** For tests: the PKCS#1 form of a PKCS#8 RSA key's DER, as GitHub gives an app's key. */
export function pkcs1Pem(pkcs8: Uint8Array): string {
  // A 2048-bit key's PrivateKeyInfo: its SEQUENCE's header, version, algorithm, then the key as an OCTET STRING.
  const at = 4 + 3 + RSA_ALGORITHM.length;
  if (pkcs8[at] !== 0x04 || pkcs8[at + 1] !== 0x82) throw new Error("Not a 2048-bit RSA key's PKCS#8 form.");
  return pem("RSA PRIVATE KEY", pkcs8.slice(at + 4));
}
