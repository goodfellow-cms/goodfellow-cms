import { describe, expect, it } from "vitest";
import { serializeContent } from "./serialize.js";

describe("serializeContent", () => {
  it("writes version, type, and id first, then the rest alphabetically", () => {
    const text = serializeContent({ zeta: 1, data: { props: { title: "Hi", id: "a" }, type: "Heading" }, version: 1 });
    expect(text).toBe(
      `{
  "version": 1,
  "data": {
    "type": "Heading",
    "props": {
      "id": "a",
      "title": "Hi"
    }
  },
  "zeta": 1
}
`,
    );
  });

  it("produces identical output regardless of input key order", () => {
    expect(serializeContent({ b: 1, a: { d: 2, c: 3 } })).toBe(serializeContent({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("keeps array order and drops undefined values", () => {
    expect(JSON.parse(serializeContent({ list: [3, 1, 2], gone: undefined }))).toEqual({ list: [3, 1, 2] });
  });
});
