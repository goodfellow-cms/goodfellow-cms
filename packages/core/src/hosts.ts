/**
 * Addresses that aren't another site's: this computer, and the private
 * networks around it. Builds read other sites' calendars and feeds, which
 * editors name, and those reads run on CI's and developers' computers, so
 * they must never reach what only those computers can. Names are read as
 * `new URL()` spells them, so `0x7f.1` and `2130706433` are already
 * `127.0.0.1`; names that only DNS says are private can't be told from here.
 */

function ipv4(host: string): number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return undefined;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : undefined;
}

/** An IPv6 address's IPv4 one, where it's IPv4-mapped (`[::ffff:7f00:1]`, `[::ffff:127.0.0.1]`). */
function mappedIpv4(host: string): number[] | undefined {
  const dotted = /^\[::ffff:(\d+\.\d+\.\d+\.\d+)\]$/.exec(host);
  if (dotted?.[1]) return ipv4(dotted[1]);
  const hex = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(host);
  if (!hex?.[1] || !hex[2]) return undefined;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255];
}

function hostName(host: string): string {
  return host.toLowerCase().replace(/\.+$/, "");
}

/** Whether a host name is this computer: `localhost` and its subdomains, `127.0.0.0/8`, `0.0.0.0`, `[::1]`, `[::]`. */
export function isLoopbackHost(input: string): boolean {
  const host = hostName(input);
  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || host === "[::]") return true;
  const v4 = ipv4(host) ?? mappedIpv4(host);
  return v4 !== undefined && (v4[0] === 127 || v4.every((byte) => byte === 0));
}

/**
 * Whether a host name is this computer or a private network's address:
 * loopback, `0.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, link-local
 * (`169.254/16`, where clouds keep their metadata, and `fe80::/10`), shared
 * (`100.64/10`) and unique local (`fc00::/7`) addresses.
 */
export function isPrivateHost(input: string): boolean {
  if (isLoopbackHost(input)) return true;
  const host = hostName(input);
  const v4 = ipv4(host) ?? mappedIpv4(host);
  if (v4) {
    const [a = 0, b = 0] = v4;
    return (
      a === 0 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return /^\[f[cd][0-9a-f]{0,2}:/.test(host) || /^\[fe[89ab][0-9a-f]?:/.test(host);
}

/** Why another site's file couldn't be read, in plain words. */
export class RemoteFileError extends Error {
  override name = "RemoteFileError";
}

/** The part of `fetch`'s answer `readRemoteText()` uses. */
interface RemoteResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
}

export type RemoteFetch = (
  url: string,
  init: { headers: Record<string, string>; redirect: "manual"; signal?: unknown },
) => Promise<RemoteResponse>;

export interface RemoteTextOptions {
  /** What the file is, for errors: "calendar", "feed". */
  what: string;
  accept: string;
  /** The most bytes read; anything larger is refused. */
  limit: number;
  fetch?: RemoteFetch;
  /** How long to wait for an answer, in milliseconds. */
  timeout?: number;
}

const MAX_REDIRECTS = 5;

/** An address another site's file may be read from: `https://`, on a host that isn't this computer or a private network's. */
function remoteUrl(address: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new RemoteFileError(`The ${what}'s address isn't a web address.`);
  }
  if (url.protocol !== "https:") throw new RemoteFileError(`The ${what}'s address must start with https://.`);
  if (url.username || url.password) throw new RemoteFileError(`The ${what}'s address can't hold a password.`);
  if (isPrivateHost(url.hostname)) {
    throw new RemoteFileError(
      `The ${what}'s address is on this computer or a private network, which builds never read.`,
    );
  }
  return url;
}

/**
 * Another site's text file, as builds read calendars and feeds: only from
 * `https://` addresses that aren't this computer's or a private network's,
 * following at most a few redirects, each checked the same way, and reading
 * no more than `limit` bytes.
 */
export async function readRemoteText(address: string, options: RemoteTextOptions): Promise<string> {
  const fetcher = options.fetch ?? (globalThis as unknown as { fetch: RemoteFetch }).fetch;
  const timeout = (globalThis as unknown as { AbortSignal: { timeout(ms: number): unknown } }).AbortSignal.timeout(
    options.timeout ?? 20_000,
  );
  let url = remoteUrl(address, options.what);
  for (let redirects = 0; ; redirects++) {
    const response = await fetcher(url.href, {
      headers: { accept: options.accept },
      redirect: "manual",
      signal: timeout,
    });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (location) {
      await response.body?.getReader().cancel();
      if (redirects >= MAX_REDIRECTS) throw new RemoteFileError(`The ${options.what}'s address redirects too often.`);
      url = remoteUrl(new URL(location, url).href, options.what);
      continue;
    }
    if (!response.ok) throw new RemoteFileError(`The ${options.what}'s address answered ${response.status}.`);
    const length = Number(response.headers.get("content-length"));
    if (length > options.limit) throw new RemoteFileError(`The ${options.what} is too large to read.`);
    return readLimited(response, options);
  }
}

async function readLimited(response: RemoteResponse, options: RemoteTextOptions): Promise<string> {
  const { TextDecoder: Decoder } = globalThis as unknown as {
    TextDecoder: new () => { decode(bytes: Uint8Array, options?: { stream: boolean }): string };
  };
  const decoder = new Decoder();
  const reader = response.body?.getReader();
  if (!reader) return "";
  let read = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    read += value.byteLength;
    if (read > options.limit) {
      await reader.cancel();
      throw new RemoteFileError(`The ${options.what} is too large to read.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode(new Uint8Array());
}
