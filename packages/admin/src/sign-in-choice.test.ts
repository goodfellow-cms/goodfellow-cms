import { describe, expect, it } from "vitest";
import { keepRememberChoice, REMEMBER_CHOICE_KEY, rememberChoice } from "./sign-in.js";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe("staying signed in", () => {
  it("is on until the editor turns it off", () => {
    expect(rememberChoice(memoryStorage())).toBe(true);
    expect(rememberChoice(undefined)).toBe(true);
  });

  it("stays off after a sign-in that comes back with a problem, in the same tab", () => {
    const storage = memoryStorage();
    keepRememberChoice(false, storage);
    expect(storage.items.get(REMEMBER_CHOICE_KEY)).toBe("off");
    // The page loads again after the host sends the editor back.
    expect(rememberChoice(storage)).toBe(false);
    keepRememberChoice(true, storage);
    expect(storage.items.has(REMEMBER_CHOICE_KEY)).toBe(false);
    expect(rememberChoice(storage)).toBe(true);
  });

  it("is on where storage can't be read", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(rememberChoice(broken)).toBe(true);
  });
});
