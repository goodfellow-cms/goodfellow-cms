import { describe, expect, it } from "vitest";
import { CURRENT_VERSION } from "./migrations/index.js";
import { parseSiteDescription, siteVersionProblem } from "./site-description.js";

const description = {
  version: 1,
  goodfellow: "0.3.1",
  content: CURRENT_VERSION,
  root: { fields: { title: { type: "text", label: "Page title" } } },
  blocks: {
    Heading: { label: "Heading", fields: { text: { type: "text" } }, defaultProps: { text: "Heading" } },
    EntryField: { fields: {}, templateOnly: true },
  },
};

describe("parseSiteDescription", () => {
  it("reads what builds write", () => {
    const result = parseSiteDescription(JSON.stringify(description));
    expect(result).toEqual({ ok: true, description });
  });

  it("refuses anything else", () => {
    expect(parseSiteDescription("<!doctype html>")).toEqual({ ok: false });
    expect(parseSiteDescription(JSON.stringify({ ...description, version: 2 }))).toEqual({ ok: false });
    expect(parseSiteDescription(JSON.stringify({ ...description, goodfellow: "next" }))).toEqual({ ok: false });
    expect(parseSiteDescription(JSON.stringify({ ...description, blocks: { Heading: { label: 3 } } }))).toEqual({
      ok: false,
    });
  });
});

describe("siteVersionProblem", () => {
  it("writes to sites on the same minor release or the one before", () => {
    expect(siteVersionProblem({ goodfellow: "0.3.0", content: CURRENT_VERSION }, "0.3.4")).toBeUndefined();
    expect(siteVersionProblem({ goodfellow: "0.2.7", content: CURRENT_VERSION }, "0.3.4")).toBeUndefined();
    expect(siteVersionProblem({ goodfellow: "1.0.0", content: CURRENT_VERSION }, "1.1.0")).toBeUndefined();
  });

  it("asks older sites to update, and says when the tool is the older one", () => {
    expect(siteVersionProblem({ goodfellow: "0.1.9", content: CURRENT_VERSION }, "0.3.0")).toBe("site-too-old");
    expect(siteVersionProblem({ goodfellow: "0.9.0", content: CURRENT_VERSION }, "1.0.0")).toBe("site-too-old");
    expect(siteVersionProblem({ goodfellow: "0.4.0", content: CURRENT_VERSION }, "0.3.9")).toBe("tool-too-old");
    expect(siteVersionProblem({ goodfellow: "1.0.0", content: CURRENT_VERSION }, "0.9.0")).toBe("tool-too-old");
  });

  it("needs the site to read the content versions the tool writes", () => {
    const tool = { ...CURRENT_VERSION, page: 2 };
    expect(siteVersionProblem({ goodfellow: "0.3.0", content: CURRENT_VERSION }, "0.3.0", tool)).toBe("site-too-old");
    expect(siteVersionProblem({ goodfellow: "0.3.0", content: { ...CURRENT_VERSION, page: 3 } }, "0.3.0", tool)).toBe(
      "tool-too-old",
    );
    const { menus: _missing, ...partial } = CURRENT_VERSION;
    expect(siteVersionProblem({ goodfellow: "0.3.0", content: partial }, "0.3.0")).toBe("site-too-old");
  });
});
