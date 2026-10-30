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
  props: { id, html: "<p>Hi</p>", ...props },
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
