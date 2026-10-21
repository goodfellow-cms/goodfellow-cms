import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { relinkSite } from "./links.js";
import { type ContentSource, loadSiteContent } from "./load.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const page = (title: string, content: unknown[] = [], props: Record<string, unknown> = {}) => ({
  version: 1,
  data: { root: { props: { title, ...props } }, content },
});

const blocks = {
  Button: { fields: { href: { type: "text" } }, render: () => null },
  Text: { fields: { text: { type: "richtext" } }, render: () => null },
} as unknown as Record<string, ComponentConfig>;

describe("relinkSite", () => {
  it("points links everywhere at moved addresses, keeping the rest of each link", async () => {
    const content = await loadSiteContent(
      memorySource({
        "content/site.json": { version: 1, title: "Parish" },
        "content/pages/index.json": page("Home", [
          { type: "Button", props: { id: "Button-1", href: "/talks/advent?play=1" } },
          { type: "Text", props: { id: "Text-1", text: "<p><a href='/talks/advent'>Advent</a></p>" } },
          // A template's placeholder is filled in later, so it's left alone.
          { type: "Button", props: { id: "Button-2", href: "/talks/{slug}" } },
        ]),
        "content/layout/footer.json": {
          version: 1,
          data: { root: {}, content: [{ type: "Button", props: { id: "B", href: "/talks/advent" } }] },
        },
        "content/collections/talks/_collection.json": {
          version: 1,
          name: "Talks",
          entryName: "Talk",
          path: "/talks/{slug}",
          markdown: { body: "body" },
          fields: [
            { name: "title", label: "Title", type: "text" },
            { name: "next", label: "Next", type: "link" },
            { name: "body", label: "Body", type: "richtext" },
          ],
          template: { root: { props: {} }, content: [] },
        },
        "content/collections/talks/lent.md": [
          "---",
          "version: 1",
          "title: Lent",
          "next: /talks/advent",
          "---",
          "After [Advent](/talks/advent#end), and [see also][advent].",
          "",
          "```",
          "[not a link](/talks/advent)",
          "```",
          "",
          "Code like `[x](/talks/advent)` stays as written.",
          "",
          "[advent]: /talks/advent",
          "",
        ].join("\n"),
        "content/collections/talks/advent.md": "---\nversion: 1\ntitle: Advent\n---\nAdvent.\n",
        "content/redirects.json": { version: 1, redirects: [{ from: "/advent", to: "/talks/advent" }] },
      }),
    );
    const relinked = relinkSite(content, [{ from: "/talks/advent", to: "/talks/advent-2026" }], blocks);
    expect(relinked.files).toEqual([
      "content/pages/index.json",
      "content/layout/footer.json",
      "content/collections/talks/lent.md",
      "content/redirects.json",
    ]);
    const [home] = relinked.content.pages;
    expect(home?.content.data.content.map((block) => block.props.href ?? block.props.text)).toEqual([
      "/talks/advent-2026?play=1",
      "<p><a href='/talks/advent-2026'>Advent</a></p>",
      "/talks/{slug}",
    ]);
    const lent = relinked.content.collections[0]?.entries.find((entry) => entry.slug === "lent");
    expect(lent?.content.fields.next).toBe("/talks/advent-2026");
    expect(lent?.content.fields.body).toBe(
      [
        "After [Advent](/talks/advent-2026#end), and [see also][advent].",
        "",
        "```",
        "[not a link](/talks/advent)",
        "```",
        "",
        "Code like `[x](/talks/advent)` stays as written.",
        "",
        "[advent]: /talks/advent-2026",
      ].join("\n"),
    );
    expect(relinked.content.redirects).toEqual([{ from: "/advent", to: "/talks/advent-2026" }]);
  });

  it("changes nothing when nothing moves", async () => {
    const content = await loadSiteContent(memorySource({ "content/site.json": { version: 1, title: "Parish" } }));
    expect(relinkSite(content, [{ from: "/a", to: "/a" }])).toEqual({ content, files: [] });
  });
});
