/**
 * Git hosts limit how many requests a sign-in may make in a minute, and
 * answer the rest with 429 (GitLab, Bitbucket and GitHub) or 403 (GitHub,
 * with headers saying so) until the limit resets. Many changes in a row, such
 * as Claude's, can reach it, so backends wait and try again where the wait is
 * short, rather than failing part-way through.
 */

/** How long one wait may be: longer limits, such as GitHub's hourly one, fail with `RateLimitError` instead. */
export const MAX_RATE_LIMIT_WAIT_MS = 60_000;

/** How many times one request is tried again after being limited. */
const RETRIES = 3;

/** A host's limit on requests was reached, and lasts longer than is worth waiting. */
export class RateLimitError extends Error {
  override name = "RateLimitError";
  readonly status: number;
  /** When the host says requests are allowed again, if it says. */
  readonly resetsAt?: Date;

  constructor(status: number, resetsAt: Date | undefined, host: string) {
    super(
      `${host} is limiting how many requests this sign-in can make${resetsAt ? ` until ${resetsAt.toISOString()}` : " for now"}.`,
    );
    this.status = status;
    if (resetsAt) this.resetsAt = resetsAt;
  }
}

/** The parts of an answer the limits are read from, so core needs no DOM types. */
export interface LimitedHeaders {
  get(name: string): string | null;
  has(name: string): boolean;
}

interface LimitedResponse {
  status: number;
  headers: LimitedHeaders;
  body?: { cancel(): Promise<void> } | null;
}

/** How long the host asks to wait, in milliseconds, from its headers, or `undefined` if they don't say. */
export function rateLimitWait(headers: LimitedHeaders, now = Date.now()): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  // GitLab's RateLimit-Reset and GitHub's x-ratelimit-reset are Unix times, in seconds.
  const reset = headers.get("ratelimit-reset") ?? headers.get("x-ratelimit-reset");
  if (reset && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1000 - now);
  return undefined;
}

/** Whether an answer says the limit was reached, rather than that the sign-in isn't allowed. */
function isLimited(response: LimitedResponse): boolean {
  if (response.status === 429) return true;
  return (
    response.status === 403 &&
    (response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0")
  );
}

export interface RateLimitOptions {
  /** The host's name, for the error. */
  host: string;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * `fetch`, waiting and trying again when the host limits requests: as long as
 * it asks, up to `MAX_RATE_LIMIT_WAIT_MS` at a time, or a few seconds more each
 * time where its answer doesn't say (browsers can't always read the headers).
 * A limit that lasts longer throws `RateLimitError`. Limited requests weren't
 * carried out, so sending them again is safe, publishing included.
 */
// biome-ignore lint/suspicious/noExplicitAny: any fetch, the browser's, Node's or a fake's
export function withRateLimits<Fetch extends (input: any, init?: any) => Promise<LimitedResponse>>(
  fetcher: Fetch,
  options: RateLimitOptions,
): Fetch {
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((done) =>
        (globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }).setTimeout(done, ms),
      ));
  const now = options.now ?? Date.now;
  /** A body that's a stream can only be sent once. */
  const isStream = (body: unknown) => typeof (body as { getReader?: unknown } | null)?.getReader === "function";
  return (async (input: unknown, init?: { body?: unknown }) => {
    const retryable = !isStream(init?.body) && !isStream((input as { body?: unknown } | null)?.body);
    for (let attempt = 0; ; attempt++) {
      const response = await fetcher(input, init);
      if (!retryable || !isLimited(response)) return response;
      const asked = rateLimitWait(response.headers, now());
      // At least a second, since a reset time can be a moment behind the host's clock.
      const wait = Math.max(asked ?? 5_000 * 2 ** attempt, 1_000);
      if (attempt >= RETRIES || wait > MAX_RATE_LIMIT_WAIT_MS) {
        throw new RateLimitError(
          response.status,
          asked === undefined ? undefined : new Date(now() + asked),
          options.host,
        );
      }
      await response.body?.cancel().catch(() => {});
      await sleep(wait);
    }
  }) as Fetch;
}
