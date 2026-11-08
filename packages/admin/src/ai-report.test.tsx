import type { Fields } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { answeredBlocks, countBlocks, valuesReport } from "./ai-report.js";

const eventFields: Fields = {
  when: { type: "custom", render: () => <></>, metadata: { ai: { type: "event" } } },
};

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
    const fields: Fields = {
      title: { type: "text" },
      kind: {
        type: "select",
        options: [
          { label: "News", value: "news" },
          { label: "Event", value: "event" },
        ],
      },
      size: { type: "select", options: [{ label: "Small", value: "small" }] },
    };
    const before = { title: "Old", kind: "news", size: "small" };
    const after = { title: "New", kind: "news", size: "small" };
    // The kind was answered with no such choice; the size was answered as it was.
    expect(valuesReport({ title: "New", kind: "gossip", size: "small" }, fields, before, after)).toEqual({
      settings: 1,
      skipped: 1,
    });
  });

  it("counts an event as left out only where putting it in would leave it out", () => {
    const repeating = { when: { start: "2026-12-06T10:00", end: "2026-12-06T11:00", repeat: { every: "week" } } };
    const report = (when: unknown, before: Record<string, unknown> = repeating) =>
      valuesReport({ when }, eventFields, before, before);
    // Its own start and end, without its repeat or in another order, are as it was.
    expect(report({ end: "2026-12-06T11:00", start: "2026-12-06T10:00" })).toEqual({ settings: 0, skipped: 0 });
    // An empty end is left out of an event that has none.
    const once = { when: { start: "2026-12-06T10:00" } };
    expect(report({ start: "2026-12-06T10:00", end: "" }, once)).toEqual({ settings: 0, skipped: 0 });
    // An event with no start, or nothing at all, or a start that isn't a time, isn't one.
    expect(report({ start: "", end: "2026-12-06T11:00" })).toEqual({ settings: 0, skipped: 1 });
    expect(report({})).toEqual({ settings: 0, skipped: 1 });
    expect(report({ start: "next week" })).toEqual({ settings: 0, skipped: 1 });
  });
});
