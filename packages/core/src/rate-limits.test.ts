import { describe, expect, it } from "vitest";
import { RateLimitError, rateLimitWait, withRateLimits } from "./rate-limits.js";

/** An answer as `withRateLimits()` reads one: its status and headers. */
function answer(status: number, headers: Record<string, string> = {}) {
  const named = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    status,
    ok: status < 400,
    headers: { get: (name: string) => named.get(name.toLowerCase()) ?? null, has: (name: string) => named.has(name) },
    body: null,
  };
}

const limited = (headers: Record<string, string>, status = 429) => answer(status, headers);
const headersOf = (headers: Record<string, string>) => answer(200, headers).headers;

function fakeHost(answers: Array<ReturnType<typeof answer>>) {
  const sent: string[] = [];
  const slept: number[] = [];
  const fetcher = withRateLimits(
    async (input: string, init?: { method?: string; body?: string }) => {
      sent.push(`${init?.method ?? "GET"} ${input} ${init?.body ?? ""}`);
      return answers.shift() ?? answer(200);
    },
    { host: "GitLab", sleep: async (ms) => void slept.push(ms), now: () => Date.UTC(2026, 9, 27, 12) },
  );
  return { fetcher, sent, slept };
}

describe("rate limits", () => {
  it("waits as long as the host asks, then sends the same request again", async () => {
    const host = fakeHost([limited({ "retry-after": "7" })]);
    const response = await host.fetcher("https://gitlab.com/api/v4/commits", { method: "POST", body: "{}" });
    expect(response.ok).toBe(true);
    expect(host.slept).toEqual([7000]);
    expect(host.sent).toEqual([
      "POST https://gitlab.com/api/v4/commits {}",
      "POST https://gitlab.com/api/v4/commits {}",
    ]);
  });

  it("reads GitLab's and GitHub's reset times, and GitHub's limits answered with 403", async () => {
    const now = Date.UTC(2026, 9, 27, 12);
    expect(rateLimitWait(headersOf({ "ratelimit-reset": String(now / 1000 + 20) }), now)).toBe(20_000);
    const host = fakeHost([
      limited({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 30) }, 403),
    ]);
    expect((await host.fetcher("https://api.github.com/repos/a/b")).ok).toBe(true);
    expect(host.slept).toEqual([30_000]);
  });

  it("waits longer each time where the host doesn't say, and gives up after a few tries", async () => {
    const host = fakeHost([limited({}), limited({}), limited({}), limited({})]);
    const error = await host.fetcher("https://api.bitbucket.org/2.0/x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(host.slept).toEqual([5_000, 10_000, 20_000]);
  });

  it("doesn't wait for a limit that lasts longer than a minute", async () => {
    const host = fakeHost([limited({ "retry-after": "1800" })]);
    const error = (await host
      .fetcher("https://gitlab.com/api/v4/x")
      .catch((caught: unknown) => caught)) as RateLimitError;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.resetsAt?.toISOString()).toBe("2026-10-27T12:30:00.000Z");
    expect(host.slept).toEqual([]);
  });

  it("leaves other answers as they are, a 403 that isn't a limit included", async () => {
    const host = fakeHost([answer(403)]);
    expect((await host.fetcher("https://gitlab.com/api/v4/x")).status).toBe(403);
    expect(host.slept).toEqual([]);
  });
});
