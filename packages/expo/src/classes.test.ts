import { siteSettingsSchema } from "@goodfellow-cms/core";
import { describe, expect, it, vi } from "vitest";

// twrnc needs React Native, so a stand-in that throws on a class it can't read, as twrnc may on content's.
vi.mock("twrnc", () => ({
  create: () => ({
    style: (...classes: Array<string | string[]>) => {
      const names = classes.flat().flatMap((name) => name.split(/\s+/));
      if (names.includes("p-[")) throw new Error("can't read p-[");
      return Object.fromEntries(names.map((name) => [name === "text-center" ? "textAlign" : "padding", name]));
    },
  }),
}));

const { classStyle } = await import("./classes.js");
const { nativeTheme } = await import("./theme.js");

describe("classStyle", () => {
  it("keeps the classes it can read when another can't be", () => {
    const settings = siteSettingsSchema.parse({ version: 1 });
    const style = classStyle("p-4 p-[ text-center", { settings, theme: nativeTheme(settings, false), width: 400 });
    expect(style).toEqual({ view: { padding: "p-4" }, text: { textAlign: "text-center" } });
  });
});
