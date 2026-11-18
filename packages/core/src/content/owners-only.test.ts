import { describe, expect, it } from "vitest";
import { isOwnersOnlyField, ownersOnlyChanges, ownersOnlyFields } from "./owners-only.js";

const blocks = {
  "custom-html": {
    fields: { html: { type: "textarea" }, sanitize: { type: "radio", metadata: { owners: true } } },
    defaultProps: { html: "", sanitize: true },
  },
  Text: { fields: { text: { type: "richtext" } } },
};
const fields = ownersOnlyFields(blocks);

const block = (id: string, props: Record<string, unknown> = {}) => ({
  type: "custom-html",
  props: { id, html: "<p>Hi</p>", sanitize: true, ...props },
});
const page = (...content: unknown[]) => JSON.stringify({ version: 1, data: { root: { props: {} }, content } });

describe("owners-only settings", () => {
  it("are fields marked as owners', by block, with the block's starting values", () => {
    expect(isOwnersOnlyField({ type: "text", metadata: { owners: true } })).toBe(true);
    expect(isOwnersOnlyField({ type: "text", metadata: { owners: "yes" } })).toBe(false);
    expect(isOwnersOnlyField({ type: "text" })).toBe(false);
    expect(fields).toEqual({ "custom-html": { fields: ["sanitize"], defaults: { html: "", sanitize: true } } });
  });

  it("find the files where one changed: on a block that was there, or a new block's from its starting value", async () => {
    const before = new Map([
      ["content/pages/about.json", page(block("a"))],
      ["content/layout/header.json", page({ type: "Section", props: { id: "s", content: [block("b")] } })],
    ]);
    const read = async (path: string) => before.get(path);
    const check = (path: string, content: string) => ownersOnlyChanges([{ path, content }], fields, read);

    expect(await check("content/pages/about.json", page(block("a", { html: "<p>Changed</p>" })))).toEqual([]);
    expect(await check("content/pages/about.json", page(block("a", { sanitize: true })))).toEqual([]);
    expect(await check("content/pages/about.json", page(block("a"), block("new")))).toEqual([]);
    expect(await check("content/pages/about.json", page(block("a", { sanitize: false })))).toEqual([
      "content/pages/about.json",
    ]);
    expect(await check("content/pages/new.json", page(block("c", { sanitize: false })))).toEqual([
      "content/pages/new.json",
    ]);
    expect(
      await check(
        "content/layout/header.json",
        page({ type: "Section", props: { id: "s", content: [block("b", { sanitize: false })] } }),
      ),
    ).toEqual(["content/layout/header.json"]);
  });

  it("read a setting left out as its starting value, as pages draw it, and null as a value of its own", async () => {
    const read = async () => page(block("a"));
    const check = (content: string) => ownersOnlyChanges([{ path: "content/pages/a.json", content }], fields, read);
    const without = (id: string) => ({ type: "custom-html", props: { id, html: "<script>x</script>" } });
    // A new block that leaves the setting out is drawn with its starting value; one with null isn't.
    expect(await check(page(block("a"), without("new")))).toEqual([]);
    expect(await check(page(block("a"), block("new", { sanitize: null })))).toEqual(["content/pages/a.json"]);
    // A block that was there, its setting taken out or set to null.
    expect(await check(page(without("a")))).toEqual([]);
    expect(await check(page(block("a", { sanitize: null })))).toEqual(["content/pages/a.json"]);
  });

  it("keep a block saved before its setting existed as it was, and let editors change the rest of it", async () => {
    const old = { type: "custom-html", props: { id: "a", html: "<p>Old</p>" } };
    const read = async () => page(old);
    const check = (content: string) => ownersOnlyChanges([{ path: "content/pages/a.json", content }], fields, read);
    expect(await check(page({ ...old, props: { ...old.props, html: "<p>New</p>" } }))).toEqual([]);
    expect(await check(page(block("a", { sanitize: false })))).toEqual(["content/pages/a.json"]);
  });

  it("let a new block hold a setting with no starting value by leaving it out", async () => {
    const noDefault = ownersOnlyFields({ Embed: { fields: { code: { type: "text", metadata: { owners: true } } } } });
    const check = (content: string) =>
      ownersOnlyChanges([{ path: "content/pages/a.json", content }], noDefault, async () => undefined);
    expect(await check(page({ type: "Embed", props: { id: "e" } }))).toEqual([]);
    expect(await check(page({ type: "Embed", props: { id: "e", code: "<script>x</script>" } }))).toEqual([
      "content/pages/a.json",
    ]);
  });

  it("compare an owner's block whatever order its settings are saved in", async () => {
    const owners = { type: "custom-html", props: { id: "a", html: "<b>x</b>", sanitize: false, className: "" } };
    const read = async () => page(owners);
    const check = (content: string) => ownersOnlyChanges([{ path: "content/pages/a.json", content }], fields, read);
    const reordered = { type: "custom-html", props: { className: "", sanitize: false, id: "a", html: "<b>x</b>" } };
    expect(await check(page(reordered))).toEqual([]);
    expect(await check(page({ ...reordered, props: { ...reordered.props, html: "<i>x</i>" } }))).toEqual([
      "content/pages/a.json",
    ]);
  });

  it("count a block with owners-only settings and no id as a change, unless it starts as its default or was there", async () => {
    const owners = { type: "custom-html", props: { html: "x", sanitize: false } };
    const section = (inside: unknown) => ({ type: "Section", props: { id: "s", content: [inside] } });
    const check = (content: string, before?: string) =>
      ownersOnlyChanges([{ path: "content/pages/a.json", content }], fields, async () => before);
    expect(await check(page(section(owners)))).toEqual(["content/pages/a.json"]);
    expect(await check(page(section({ type: "custom-html", props: { id: 7, html: "x", sanitize: false } })))).toEqual([
      "content/pages/a.json",
    ]);
    // Nothing is gained by one that's made safe, nor by one that was already in the file.
    expect(await check(page({ type: "custom-html", props: { html: "x", sanitize: true } }))).toEqual([]);
    expect(
      await check(page(section(owners), { type: "Text", props: { id: "t", text: "Edited" } }), page(section(owners))),
    ).toEqual([]);
    expect(
      await check(
        page(section({ ...owners, props: { ...owners.props, html: "<script>y</script>" } })),
        page(section(owners)),
      ),
    ).toEqual(["content/pages/a.json"]);
    // Blocks with nothing owners-only may have none.
    expect(await check(page({ type: "Text", props: { text: "x" } }))).toEqual([]);
  });

  it("leave other files and blocks alone", async () => {
    const read = async () => undefined;
    expect(await ownersOnlyChanges([{ path: "content/pages/a.json", content: page(block("a")) }], {}, read)).toEqual(
      [],
    );
    expect(
      await ownersOnlyChanges(
        [
          { path: "content/pages/a.md", content: "sanitize: false" },
          { path: "content/pages/b.json", content: "not JSON" },
          { path: "content/pages/c.json", content: page({ type: "Text", props: { id: "t", sanitize: false } }) },
        ],
        fields,
        read,
      ),
    ).toEqual([]);
  });

  it("hold a block moved from another file to its starting value", async () => {
    const read = async (path: string) =>
      path === "content/pages/a.json" ? page(block("a", { sanitize: false })) : undefined;
    const changes = [
      { path: "content/pages/a.json", content: page() },
      { path: "content/pages/b.json", content: page(block("a", { sanitize: false })) },
    ];
    expect(await ownersOnlyChanges(changes, fields, read)).toEqual(["content/pages/b.json"]);
  });

  it("read a page sent as bytes, and count two blocks with one id as a change", async () => {
    const read = async () => page(block("a"));
    const bytes = new TextEncoder().encode(page(block("a", { sanitize: false, html: "<script>x</script>" })));
    expect(await ownersOnlyChanges([{ path: "content/pages/a.json", bytes }], fields, read)).toEqual([
      "content/pages/a.json",
    ]);
    // The first one is drawn too, though the second looks like the one that was there.
    const twice = page(block("a", { sanitize: false, html: "<script>x</script>" }), block("a"));
    expect(await ownersOnlyChanges([{ path: "content/pages/a.json", content: twice }], fields, read)).toEqual([
      "content/pages/a.json",
    ]);
  });

  it("keep an owner's block used exactly as written as the owner left it, every setting of it", async () => {
    const read = async () => page(block("a", { sanitize: false, html: "<p>As written</p>" }));
    const check = (content: string) => ownersOnlyChanges([{ path: "content/pages/a.json", content }], fields, read);
    expect(await check(page(block("a", { sanitize: false, html: "<script>x</script>" })))).toEqual([
      "content/pages/a.json",
    ]);
    expect(await check(page(block("a", { sanitize: false, html: "<p>As written</p>" })))).toEqual([]);
    // Taking it away is fine: what's left can't run anything.
    expect(await check(page())).toEqual([]);
  });
});
