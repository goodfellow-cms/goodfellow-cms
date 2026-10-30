import { describe, expect, it } from "vitest";
import { KEPT_EDIT_DAYS, keptEditKey, memoryEditKeeper, readKeptEdit } from "./kept-edits.js";

const DAY = 24 * 60 * 60 * 1000;
const data = { root: { props: { title: "About" } }, content: [] };

describe("keptEditKey", () => {
  it("tells apart sites, drafts and what's edited", () => {
    const page = { kind: "page", path: "/about" };
    const keys = [
      keptEditKey("https://example.org/", page),
      keptEditKey("https://example.com/", page),
      keptEditKey("https://example.org/", page, "20260101-news"),
      keptEditKey("https://example.org/", { kind: "page", path: "/news" }),
      keptEditKey("https://example.org/", { kind: "header", path: "/" }),
      keptEditKey("https://example.org/", { kind: "header", path: "/es", language: "es" }),
      keptEditKey("https://example.org/", { kind: "entry", path: "/news/a", collection: "news", entry: "a" }),
      keptEditKey("https://example.org/", { kind: "entry", path: "/news/a", collection: "news", entry: "b" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps a template's changes whichever item it shows them on", () => {
    expect(keptEditKey("s", { kind: "template", path: "/news/a", collection: "news" })).toBe(
      keptEditKey("s", { kind: "template", path: "/news/b", collection: "news" }),
    );
  });
});

describe("readKeptEdit", () => {
  const now = Date.UTC(2026, 9, 30);

  it("reads what was kept", () => {
    const edit = { data, published: "{}", savedAt: now - DAY };
    expect(readKeptEdit(edit, now)).toEqual(edit);
  });

  it("leaves out changes older than the limit, or from the future", () => {
    expect(readKeptEdit({ data, published: "{}", savedAt: now - (KEPT_EDIT_DAYS + 1) * DAY }, now)).toBeUndefined();
    expect(readKeptEdit({ data, published: "{}", savedAt: now + DAY }, now)).toBeUndefined();
  });

  it("leaves out anything else", () => {
    for (const value of [
      undefined,
      null,
      "text",
      [],
      { data, savedAt: now },
      { data: [], published: "", savedAt: now },
    ]) {
      expect(readKeptEdit(value, now)).toBeUndefined();
    }
  });
});

describe("memoryEditKeeper", () => {
  it("keeps, removes and forgets changes", async () => {
    let now = Date.UTC(2026, 9, 30);
    const keeper = memoryEditKeeper(() => now);
    const edit = { data, published: "{}", savedAt: now };
    await keeper.save("a", edit);
    await keeper.save("b", edit);
    expect(await keeper.load("a")).toEqual(edit);
    // A copy, so later changes to what's edited don't reach it.
    edit.data.root.props.title = "Changed";
    expect((await keeper.load("a"))?.data.root.props).toEqual({ title: "About" });
    await keeper.remove("a");
    expect(await keeper.load("a")).toBeUndefined();
    now += (KEPT_EDIT_DAYS + 1) * DAY;
    expect(await keeper.load("b")).toBeUndefined();
    await keeper.save("c", { ...edit, savedAt: now });
    await keeper.clear();
    expect(await keeper.load("c")).toBeUndefined();
  });
});
