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
declare const crypto: {
  subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
};
declare class URL {
  constructor(url: string, base?: string);
  readonly href: string;
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
