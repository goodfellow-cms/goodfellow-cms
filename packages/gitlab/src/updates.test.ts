import { describe, expect, it } from "vitest";
import { protects } from "./updates.js";

describe("protects", () => {
  it("matches the whole branch name, with * for any characters", () => {
    expect(protects("main", "main")).toBe(true);
    expect(protects("ma*", "main")).toBe(true);
    expect(protects("*", "main")).toBe(true);
    expect(protects("*a*n", "main")).toBe(true);
    expect(protects("m*x", "main")).toBe(false);
    expect(protects("mai", "main")).toBe(false);
    expect(protects("main-*", "main")).toBe(false);
    expect(protects("ma.n", "main")).toBe(false);
    expect(protects(undefined, "main")).toBe(false);
  });

  it("answers quickly for names with many wildcards", () => {
    const started = Date.now();
    expect(protects(`${"*a".repeat(2000)}b`, "a".repeat(4000))).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
