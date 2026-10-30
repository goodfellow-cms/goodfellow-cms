import type { ComponentData, Data } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import type { SiteDescription } from "../site-description.js";
import { checkEditedData, checkPuckData, MAX_EDITED_DATA } from "./edited-data.js";

const description: Pick<SiteDescription, "blocks" | "root"> = {
  root: {
    fields: { title: { type: "text" }, noIndex: { type: "radio", options: [{ value: false }, { value: true }] } },
  },
  blocks: {
    Heading: {
      fields: {
        text: { type: "text" },
        level: { type: "select", options: [{ value: "h2" }, { value: "h3" }] },
        className: { type: "custom" },
      },
    },
    Section: { fields: { content: { type: "slot" }, padding: { type: "number" } } },
    Cards: { fields: { cards: { type: "array", arrayFields: { title: { type: "text" } } } } },
    EntryField: { fields: { field: { type: "text" } }, templateOnly: true },
    List: {
      fields: { dateField: { type: "select", options: [{ value: "" }] }, limit: { type: "number" } },
      resolvesFields: true,
    },
  },
};

const opened = {
  root: { props: { title: "Visit", legacy: "kept" } },
  content: [
    {
      type: "Section",
      props: {
        id: "s1",
        padding: 4,
        resolved: "<p>filled in</p>",
        content: [{ type: "Heading", props: { id: "h1", text: "Welcome", level: "h2", className: "" } }],
      },
    },
  ],
} as unknown as Data;

/** A copy to change. Core's types have no DOM, so no `structuredClone()`. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A block at a place in `data`, which the test's own data always has. */
function at(list: unknown, index: number): ComponentData {
  const found = (list as ComponentData[])[index];
  if (!found) throw new Error(`No block at ${index}`);
  return found;
}

const check = (edited: unknown, kind: "page" | "header" | "template" = "page") =>
  checkEditedData(edited, { description, kind, opened });

describe("checkEditedData", () => {
  it("keeps a page whose blocks and values fit, with what was already there", () => {
    const edited = copy(opened);
    at(at(edited.content, 0).props.content, 0).props.text = "Hello";
    edited.content.push({ type: "Cards", props: { id: "c1", cards: [{ title: "One", extra: 1 }] } });
    const result = check(edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.root.props).toEqual({ title: "Visit", legacy: "kept" });
    expect(result.data.content[0]?.props.resolved).toBe("<p>filled in</p>");
    expect(JSON.stringify(result.data)).toContain('"text":"Hello"');
  });

  it("refuses blocks the site doesn't have, and template-only blocks outside templates", () => {
    const edited = { root: {}, content: [{ type: "Script", props: { id: "x" } }] };
    expect(check(edited)).toEqual({
      ok: false,
      problems: [{ path: "content[0]", message: `uses "Script", which isn't one of the site's blocks here` }],
    });
    const field = { root: { props: {} }, content: [{ type: "EntryField", props: { id: "e", field: "title" } }] };
    expect(check(field).ok).toBe(false);
    expect(check(field, "template").ok).toBe(true);
  });

  it("refuses values that don't fit their fields, inside slots and lists too", () => {
    const edited = {
      root: { props: { title: 3, noIndex: "maybe" } },
      content: [
        {
          type: "Section",
          props: {
            id: "s1",
            padding: "lots",
            content: [{ type: "Heading", props: { id: "h1", text: "Hi", level: "h1" } }],
          },
        },
        { type: "Cards", props: { id: "c1", cards: [{ title: false }, "card"] } },
      ],
    };
    const result = check(edited);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.path)).toEqual([
      "root.props.title",
      "root.props.noIndex",
      "content[0].props.padding",
      "content[0].props.content[0].props.level",
      "content[1].props.cards[0].title",
      "content[1].props.cards[1]",
    ]);
    // Named in words, for saying where: the block, and its setting.
    expect(result.problems.map(({ block, field }) => [block, field])).toEqual([
      [undefined, "title"],
      [undefined, "noIndex"],
      ["Section", "padding"],
      ["Heading", "level"],
      ["Cards", "cards"],
      ["Cards", "cards"],
    ]);
  });

  it("keeps choices blocks fill in themselves, and values left as they were", () => {
    // A list's choice of its collection's fields comes from `resolveFields`, which the description can't list.
    const list = { type: "List", props: { id: "l1", dateField: "date", limit: 3 } };
    expect(check({ ...copy(opened), content: [...copy(opened).content, list] }).ok).toBe(true);
    const nested = { ...list, props: { ...list.props, dateField: { field: "date" } } };
    expect(check({ ...copy(opened), content: [nested] }).ok).toBe(false);
    // A choice the site no longer offers, as Puck saved it, stays when it isn't changed.
    const before = copy(opened);
    at(at(before.content, 0).props.content, 0).props.level = "h1";
    const kept = checkEditedData(copy(before), { description, kind: "page", opened: before });
    expect(kept.ok).toBe(true);
  });

  it("refuses settings a block doesn't have unless they were there already, unchanged", () => {
    const added = copy(opened);
    at(added.content, 0).props.onclick = "alert(1)";
    expect(check(added)).toMatchObject({ ok: false, problems: [{ path: "content[0].props.onclick" }] });
    const changed = copy(opened);
    at(changed.content, 0).props.resolved = "<script></script>";
    expect(check(changed)).toMatchObject({ ok: false, problems: [{ path: "content[0].props.resolved" }] });
  });

  it("refuses blocks without ids, or with another block's", () => {
    const edited = {
      root: { props: {} },
      content: [
        { type: "Heading", props: { id: "a", text: "" } },
        { type: "Heading", props: { id: "a", text: "" } },
        { type: "Heading", props: { text: "" } },
      ],
    };
    const result = check(edited);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.problems.map((problem) => problem.path)).toEqual(["content[1].props.id", "content[2].props.id"]);
  });

  it("gives the header and footer no page settings", () => {
    expect(check({ root: { props: { title: "Header" } }, content: [] }, "header")).toMatchObject({
      ok: false,
      problems: [{ path: "root.props.title" }],
    });
  });

  it("refuses what isn't a page, or is too long", () => {
    expect(check("page").ok).toBe(false);
    expect(check({ root: { props: {} }, content: {} }).ok).toBe(false);
    const long = { root: { props: { title: "x".repeat(MAX_EDITED_DATA) } }, content: [] };
    expect(check(long)).toEqual({ ok: false, problems: [{ path: "", message: "is too long to publish" }] });
  });

  it("keeps Puck's older drop zones as they were", () => {
    const withZones = { ...opened, zones: { "s1:left": [] } } as Data;
    const edited = { ...copy(withZones), zones: { "s1:left": [{ type: "Heading", props: { id: "z" } }] } };
    expect(checkEditedData(edited, { description, kind: "page", opened: withZones }).ok).toBe(false);
    const kept = checkEditedData(
      { root: opened.root, content: opened.content },
      { description, kind: "page", opened: withZones },
    );
    expect(kept.ok && kept.data.zones).toEqual({ "s1:left": [] });
  });
});

describe("checkPuckData", () => {
  it("keeps Puck's data as plain JSON, values as they are", () => {
    const data = { ...opened, zones: { "s1:extra": [{ type: "Heading", props: { id: "h2", odd: 1 } }] } };
    expect(checkPuckData(data, { description, kind: "page" })).toEqual({ ok: true, data });
    const withUndefined = { root: { props: { title: undefined } }, content: [] };
    expect(checkPuckData(withUndefined, { description, kind: "page" })).toEqual({
      ok: true,
      data: { root: { props: {} }, content: [] },
    });
  });

  it("refuses two blocks with one id, which checks of the page would see only one of", () => {
    const twice = {
      root: { props: {} },
      content: [
        { type: "Heading", props: { id: "h1" } },
        { type: "Section", props: { id: "s1", content: [{ type: "Heading", props: { id: "h1" } }] } },
      ],
    };
    const checked = checkPuckData(twice, { description, kind: "page" });
    expect(checked.ok).toBe(false);
    if (!checked.ok)
      expect(checked.problems.map((problem) => problem.path)).toEqual(["content[1].props.content[0].props.id"]);
  });

  it("refuses blocks that aren't the site's, in slots and drop zones too, and what isn't data", () => {
    const nested = {
      root: { props: {} },
      content: [{ type: "Section", props: { id: "s1", content: [{ type: "Script", props: { id: "x" } }] } }],
      zones: { "s1:extra": [{ type: "EntryField", props: { id: "e" } }] },
    };
    const checked = checkPuckData(nested, { description, kind: "page" });
    expect(checked.ok).toBe(false);
    if (!checked.ok)
      expect(checked.problems.map((problem) => problem.path)).toEqual([
        "content[0].props.content[0]",
        "zones.s1:extra[0]",
      ]);
    expect(
      checkPuckData(
        { root: { props: {} }, content: [{ type: "EntryField", props: { id: "e" } }] },
        { description, kind: "template" },
      ).ok,
    ).toBe(true);
    expect(checkPuckData({ content: "no" }, { description, kind: "page" }).ok).toBe(false);
    const looped: Record<string, unknown> = { content: [] };
    looped.root = looped;
    expect(checkPuckData(looped, { description, kind: "page" }).ok).toBe(false);
  });
});
