import { type Collection, collectionFileSchema } from "@goodfellow-cms/core";
import type { Config } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { applyEntry, isHtmlField } from "./entry.js";

const config = {
  components: {
    Heading: { fields: { text: { type: "text" } }, render: () => null },
    Html: { fields: { html: { type: "textarea", metadata: { html: true } } }, render: () => null },
  },
} as unknown as Config;

const news: Collection = {
  id: "news",
  file: "content/collections/news/_collection.json",
  settings: collectionFileSchema.parse({
    version: 1,
    name: "News",
    entryName: "Story",
    fields: [{ name: "title", label: "Title", type: "text" }],
  }),
  entries: [],
};

describe("filling in an item's values", () => {
  it("escapes them in HTML a block shows as it is, so writing an item never writes the page's markup", () => {
    expect(isHtmlField({ type: "textarea", metadata: { html: true } })).toBe(true);
    expect(isHtmlField({ type: "textarea" })).toBe(false);
    const filled = applyEntry(
      {
        root: { props: {} },
        content: [
          { type: "Heading", props: { id: "h", text: "{title}" } },
          { type: "Html", props: { id: "x", html: '<div class="news">{title}</div>' } },
        ],
      },
      config,
      news,
      {
        collection: "news",
        slug: "a",
        file: "content/collections/news/a.json",
        path: "/news/a",
        content: { version: 1, fields: { title: '<img src=x onerror="alert(1)">' } },
      },
    );
    expect(filled.content[0]?.props.text).toBe('<img src=x onerror="alert(1)">');
    expect(filled.content[1]?.props.html).toBe(
      '<div class="news">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</div>',
    );
  });
});
