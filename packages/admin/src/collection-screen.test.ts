import type { Entry } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { inSentence, isViewable } from "./collection-screen.js";

describe("inSentence", () => {
  it("lowercases ordinary words but not abbreviations", () => {
    expect(inSentence("Video")).toBe("video");
    expect(inSentence("News story")).toBe("news story");
    expect(inSentence("FAQ")).toBe("FAQ");
    expect(inSentence("X")).toBe("X");
  });
});

describe("isViewable", () => {
  const item = (content: Partial<Entry["content"]>, path: string | null = "/jobs/welder"): Entry =>
    ({
      slug: "welder",
      path: path ?? undefined,
      content: { version: 1, fields: { title: "Welder" }, ...content },
    }) as Entry;
  const now = new Date("2026-11-14T12:00:00Z");

  it("links only to items the site shows now, a source's as much as files'", () => {
    expect(isViewable(item({}), now, "UTC")).toBe(true);
    // Shown from next week, or hidden since yesterday: the site leaves them out, so View would open "Page not found".
    expect(isViewable(item({ showFrom: "2026-11-21T09:00" }), now, "UTC")).toBe(false);
    expect(isViewable(item({ hideAfter: "2026-11-13T09:00" }), now, "UTC")).toBe(false);
    expect(isViewable(item({ showFrom: "2026-11-01T09:00", hideAfter: "2026-12-01T09:00" }), now, "UTC")).toBe(true);
    expect(isViewable(item({ notPublished: true }), now, "UTC")).toBe(false);
    expect(isViewable(item({}, null), now, "UTC")).toBe(false);
  });
});
