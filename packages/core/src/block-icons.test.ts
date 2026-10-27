import { describe, expect, it } from "vitest";
import { cleanBlockIcon } from "./block-icons.js";
import { parseSiteDescription } from "./site-description.js";

describe("block icons", () => {
  it("keeps Lucide's icon data, without its keys", () => {
    const heading = [
      ["path", { d: "M6 12h12", key: "8npq4p" }],
      ["path", { d: "M6 20V4", key: "1w1bmo" }],
      ["circle", { cx: 12, cy: 12, r: 3 }],
    ];
    expect(cleanBlockIcon(heading)).toEqual([
      ["path", { d: "M6 12h12" }],
      ["path", { d: "M6 20V4" }],
      ["circle", { cx: "12", cy: "12", r: "3" }],
    ]);
  });

  it("leaves out what could load or run anything", () => {
    expect(
      cleanBlockIcon([
        ["script", { d: "M0 0" }],
        ["image", { x: "0", href: "https://example.org/a.png" }],
        ["path", { d: "M0 0", onload: "alert(1)", style: "fill:url(#x)" }],
        ["rect", { x: "url(#a)", width: "4" }],
        ["path", { d: "<svg>" }],
        "path",
      ]),
    ).toEqual([
      ["path", { d: "M0 0" }],
      ["rect", { width: "4" }],
    ]);
    expect(cleanBlockIcon("M0 0")).toBeUndefined();
    expect(cleanBlockIcon([["script", {}]])).toBeUndefined();
  });

  it("drops an icon a description can't use, rather than the description", () => {
    const parsed = parseSiteDescription(
      JSON.stringify({
        version: 1,
        goodfellow: "0.7.0",
        content: {},
        root: { fields: {} },
        blocks: { Heading: { fields: {}, icon: "not an icon" }, Text: { fields: {}, icon: [["line", { x1: 1 }]] } },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.description.blocks.Heading?.icon).toBeUndefined();
    expect(parsed.description.blocks.Text?.icon).toEqual([["line", { x1: "1" }]]);
  });
});
