import { describe, expect, it } from "vitest";
import { durableLimiter, Limits, memoryLimiter } from "./limits.js";

/** Durable Object storage, in memory. */
function storage() {
  const values = new Map<string, unknown>();
  return {
    values,
    async get(keys: string | string[]) {
      if (typeof keys === "string") return values.get(keys);
      return new Map(keys.filter((key) => values.has(key)).map((key) => [key, values.get(key)]));
    },
    async put(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
    },
    async deleteAll() {
      values.clear();
    },
  };
}

describe("daily limits", () => {
  it("counts every limit together, and counts nothing once one is reached", async () => {
    const store = storage();
    const object = new Limits({ storage: store as never });
    const limiter = durableLimiter({
      idFromName: (name) => name,
      get: () => ({ fetch: (_, init) => object.fetch(new Request("https://limits/take", init)) }),
    });
    expect(
      await limiter.take([
        ["editor:1", 2],
        ["all", 10],
      ]),
    ).toBeUndefined();
    expect(
      await limiter.take([
        ["editor:1", 2],
        ["all", 10],
      ]),
    ).toBeUndefined();
    expect(
      await limiter.take([
        ["editor:1", 2],
        ["all", 10],
      ]),
    ).toBe("editor:1");
    expect(
      await limiter.take([
        ["editor:2", 2],
        ["all", 10],
      ]),
    ).toBeUndefined();
    expect(store.values.get("count:all")).toBe(3);
  });

  it("starts again each day", async () => {
    let now = Date.parse("2026-10-14T23:59:00Z");
    const limiter = memoryLimiter(() => now);
    expect(await limiter.take([["site:a", 1]])).toBeUndefined();
    expect(await limiter.take([["site:a", 1]])).toBe("site:a");
    now += 120_000;
    expect(await limiter.take([["site:a", 1]])).toBeUndefined();
  });
});
