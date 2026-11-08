import type { Fields } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { answeredBlocks, countBlocks, valuesReport } from "./ai-report.js";

describe("what an answer changed", () => {
  it("counts blocks, those in slots included", () => {
    const content = [
      { type: "Heading", props: { id: "a" } },
      { type: "Section", props: { id: "b", content: [{ type: "Text", props: { id: "c" } }] } },
    ];
    expect(countBlocks(content)).toBe(3);
    expect(answeredBlocks({ blocks: [{}, {}, {}, {}] })).toBe(4);
  });

  it("counts settings that changed, and values left out since they didn't fit", () => {
    const fields: Fields = { title: { type: "text" }, date: { type: "text" }, kind: { type: "text" } };
    const before = { title: "Old", date: "2026-01-01", kind: "news" };
    const after = { title: "New", date: "2026-01-01", kind: "news" };
    // The date was answered but didn't fit; the kind was answered as it was.
    expect(valuesReport({ title: "New", date: "next Tuesday", kind: "news" }, fields, before, after)).toEqual({
      settings: 1,
      skipped: 1,
    });
  });

  it("doesn't count an event answered as it was as left out, though the answer leaves its repeat out", () => {
    const fields: Fields = { when: { type: "text" } };
    const before = { when: { start: "2026-12-06T10:00", end: "2026-12-06T11:00", repeat: { every: "week" } } };
    expect(
      valuesReport({ when: { end: "2026-12-06T11:00", start: "2026-12-06T10:00" } }, fields, before, before),
    ).toEqual({
      settings: 0,
      skipped: 0,
    });
    // A new time that didn't fit is still left out.
    expect(valuesReport({ when: { start: "next week" } }, fields, before, before)).toEqual({ settings: 0, skipped: 1 });
  });
});
