// Web APIs that exist in both Node and browsers. Declared here because core
// doesn't include the DOM type library.
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare function btoa(data: string): string;
declare function atob(data: string): string;
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: Uint8Array): string;
}
/** A Web Crypto key, opaque to core. */
interface CryptoKeyLike {
  readonly type: string;
}
type EcdhParams = { name: "ECDH"; namedCurve: "P-256" };
declare const crypto: {
  subtle: {
    digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
    generateKey(
      algorithm: EcdhParams,
      extractable: boolean,
      usages: string[],
    ): Promise<{ publicKey: CryptoKeyLike; privateKey: CryptoKeyLike }>;
    exportKey(format: "jwk", key: CryptoKeyLike): Promise<Record<string, unknown>>;
    importKey(
      format: "jwk",
      key: Record<string, unknown>,
      algorithm: EcdhParams,
      extractable: boolean,
      usages: string[],
    ): Promise<CryptoKeyLike>;
    deriveKey(
      algorithm: { name: "ECDH"; public: CryptoKeyLike },
      base: CryptoKeyLike,
      derived: { name: "AES-GCM"; length: 256 },
      extractable: boolean,
      usages: string[],
    ): Promise<CryptoKeyLike>;
    encrypt(algorithm: { name: "AES-GCM"; iv: Uint8Array }, key: CryptoKeyLike, data: Uint8Array): Promise<ArrayBuffer>;
    decrypt(algorithm: { name: "AES-GCM"; iv: Uint8Array }, key: CryptoKeyLike, data: Uint8Array): Promise<ArrayBuffer>;
  };
  getRandomValues<T extends Uint8Array>(array: T): T;
};
declare class URL {
  constructor(url: string, base?: string | URL);
  readonly href: string;
  readonly host: string;
  readonly username: string;
  readonly password: string;
  readonly origin: string;
  readonly hostname: string;
  readonly protocol: string;
  readonly pathname: string;
  readonly hash: string;
  readonly search: string;
  readonly searchParams: URLSearchParams;
}

declare class URLSearchParams {
  constructor(init?: Record<string, string>);
  get(name: string): string | null;
  set(name: string, value: string): void;
  toString(): string;
}
