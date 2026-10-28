import { describe, expect, it } from "vitest";
import { type ContentSource, loadSiteContent, type Page } from "../content/load.js";
import { markdownParts } from "../content/markdown.js";
import { pageHead } from "../head.js";
import type { SiteDescription } from "../site-description.js";
import { type ApiCollectionsFile, type ApiManifest, type ApiPageFile, apiPageFile, contentApiFiles } from "./files.js";
import { isMarkdownParts, markdownPartsNodes, richTextNodes } from "./rich-text.js";

describe("richTextNodes", () => {
  it("reads paragraphs, headings and marked text", () => {
    expect(
      richTextNodes(
        '<h2 id="times">Mass  times</h2><p>Come <strong>early</strong>, <em>or <a href="/about">read</a></em><br>on.</p>',
      ),
    ).toEqual([
      { type: "heading", level: 2, id: "times", children: [{ type: "text", text: "Mass times" }] },
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Come " },
          { type: "text", text: "early", bold: true },
          { type: "text", text: ", " },
          { type: "text", text: "or ", italic: true },
          { type: "text", text: "read", italic: true, link: "/about" },
          { type: "break" },
          { type: "text", text: "on." },
        ],
      },
    ]);
  });

  it("reads lists, quotes, code, rules, tables and pictures", () => {
    expect(
      richTextNodes(
        [
          '<ol start="3"><li>One</li><li><p>Two</p><ul><li>Inner</li></ul></li></ol>',
          "<blockquote><p>Peace</p></blockquote>",
          '<pre><code class="language-ts">const a = 1;\n</code></pre>',
          "<hr>",
          "<table><thead><tr><th>Day</th></tr></thead><tbody><tr><td>Sunday</td></tr></tbody></table>",
          '<figure><img src="/media/church.jpg" alt="The church"><figcaption>In <b>May</b></figcaption></figure>',
          '<p><img src="/media/logo.png" alt=""></p>',
        ].join(""),
      ),
    ).toEqual([
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [
          [{ type: "paragraph", children: [{ type: "text", text: "One" }] }],
          [
            { type: "paragraph", children: [{ type: "text", text: "Two" }] },
            {
              type: "list",
              ordered: false,
              items: [[{ type: "paragraph", children: [{ type: "text", text: "Inner" }] }]],
            },
          ],
        ],
      },
      { type: "quote", children: [{ type: "paragraph", children: [{ type: "text", text: "Peace" }] }] },
      { type: "code", code: "const a = 1;", language: "ts" },
      { type: "rule" },
      {
        type: "table",
        rows: [
          { header: true, cells: [[{ type: "text", text: "Day" }]] },
          { header: false, cells: [[{ type: "text", text: "Sunday" }]] },
        ],
      },
      {
        type: "image",
        src: "/media/church.jpg",
        alt: "The church",
        caption: [
          { type: "text", text: "In " },
          { type: "text", text: "May", bold: true },
        ],
      },
      { type: "image", src: "/media/logo.png", alt: "" },
    ]);
  });

  it("keeps only what a page would show, and links' new tabs", () => {
    expect(
      richTextNodes(
        '<script>alert(1)</script><p onclick="x()"><a href="javascript:alert(1)">Bad</a> <a href="https://example.org/" target="_blank">Good</a></p>',
      ),
    ).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Bad " },
          { type: "text", text: "Good", link: "https://example.org/", newTab: true },
        ],
      },
    ]);
  });

  it("reads Markdown as the Entry field block renders it", () => {
    const parts = markdownParts("# Hello\n\nSome *text*.\n\n```js\nlet a;\n```\n");
    expect(isMarkdownParts(parts)).toBe(true);
    expect(isMarkdownParts([{ kind: "html" }])).toBe(false);
    expect(markdownPartsNodes(parts)).toEqual([
      { type: "heading", level: 1, id: "hello", children: [{ type: "text", text: "Hello" }] },
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Some " },
          { type: "text", text: "text", italic: true },
          { type: "text", text: "." },
        ],
      },
      { type: "code", code: "let a;", language: "js" },
    ]);
  });
});

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const field = (name: string, type: string) => ({ name, label: name, type });

const description: SiteDescription = {
  version: 1,
  goodfellow: "1.2.3",
  content: { page: 1, site: 1 },
  root: { fields: { title: { type: "text" } } },
  blocks: {
    Text: { fields: { text: { type: "richtext" } } },
    Section: { fields: { content: { type: "slot" } } },
    Cards: { fields: { items: { type: "array", arrayFields: { body: { type: "richtext" } } } } },
    EntryField: { fields: { value: { type: "richtext" } } },
  },
};

describe("contentApiFiles", () => {
  it("writes each page, each language's site, collections, header and footer, and a manifest of them", async () => {
    const content = await loadSiteContent(
      memorySource({
        "content/site.json": {
          version: 1,
          title: "St. Joseph",
          url: "https://parish.example/",
          languages: [{ code: "es" }],
        },
        "content/pages/index.json": { version: 1, data: { root: { props: { title: "Home" } } } },
        "content/pages/es/index.json": { version: 1, data: { root: { props: { title: "Inicio" } } } },
        "content/collections/news/_collection.json": {
          version: 1,
          name: "News",
          entryName: "Story",
          path: "/news/{slug}",
          fields: [field("title", "text"), field("text", "richtext")],
        },
        "content/collections/news/fair.json": {
          version: 1,
          fields: {
            title: "The fair",
            text: '<p>Games <a href="https://example.org">here</a></p><script>x()</script>',
          },
        },
        "content/collections/notes/_collection.json": {
          version: 1,
          name: "Notes",
          entryName: "Note",
          markdown: { body: "body" },
          fields: [field("title", "text"), field("body", "richtext")],
        },
        "content/collections/notes/first.md": "---\nversion: 1\ntitle: First\n---\n\nHello **there**.\n",
      }),
    );
    const page = (path: string) => content.pages.find((candidate) => candidate.path === path) as Page;
    const home = page("/");
    const files = await contentApiFiles({
      content,
      description,
      pages: [
        {
          page: home,
          head: pageHead(content, home),
          data: {
            root: { props: { title: "Home", id: "root" } },
            content: [
              {
                type: "Section",
                props: {
                  id: "Section-1",
                  content: [{ type: "Text", props: { id: "Text-1", text: '<p onclick="x()">Hi</p>' } }],
                },
              },
              { type: "Cards", props: { id: "Cards-1", items: [{ body: "<p>One</p>" }] } },
              { type: "EntryField", props: { id: "Entry-1", markdown: markdownParts("Some *Markdown*") } },
            ],
          },
          credits: [{ url: "/media/a.jpg", title: "A", creator: "B", source: "Openverse", license: "CC BY 4.0" }],
        },
        { page: page("/es"), head: pageHead(content, page("/es")), data: { root: { props: {} }, content: [] } },
      ],
      layouts: [
        {
          language: "en",
          header: { root: { props: {} }, content: [{ type: "Text", props: { id: "T", text: "<p>Top</p>" } }] },
          footer: { root: { props: {} }, content: [] },
        },
        { language: "es", header: { root: { props: {} }, content: [] }, footer: { root: { props: {} }, content: [] } },
      ],
      base: "/site/",
    });
    const byPath = Object.fromEntries(files.map((file) => [file.path, JSON.parse(file.content)]));
    expect(Object.keys(byPath).sort()).toEqual([
      "/api/collections.json",
      "/api/es/collections.json",
      "/api/es/footer.json",
      "/api/es/header.json",
      "/api/es/site.json",
      "/api/footer.json",
      "/api/header.json",
      "/api/manifest.json",
      "/api/pages/es.json",
      "/api/pages/index.json",
      "/api/site.json",
    ]);

    const manifest = byPath["/api/manifest.json"] as ApiManifest;
    expect(manifest).toMatchObject({
      version: 1,
      goodfellow: "1.2.3",
      content: { page: 1, site: 1 },
      base: "/site/",
      url: "https://parish.example/",
      mainLanguage: "en",
      blocks: ["Cards", "EntryField", "Section", "Text"],
    });
    expect(manifest).not.toHaveProperty("redirects");
    expect(manifest.languages.es?.site.file).toBe("es/site.json");
    expect(manifest.pages.map(({ path, file, language }) => ({ path, file, language }))).toEqual([
      { path: "/", file: "pages/index.json", language: "en" },
      { path: "/es", file: "pages/es.json", language: "es" },
    ]);
    // Each file's hash is its text's.
    const indexText = files.find((file) => file.path === "/api/pages/index.json")?.content ?? "";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(indexText));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(manifest.pages[0]?.hash).toBe(hex);

    const index = byPath["/api/pages/index.json"] as ApiPageFile;
    expect(index.head.title).toBe("Home");
    expect(index.head).not.toHaveProperty("favicon");
    expect(index.credits).toHaveLength(1);
    // Rich text is sanitized as pages show it, and also given as a simple structure.
    expect(JSON.stringify(index.data)).not.toContain("onclick");
    expect(index.richText).toEqual({
      "Text-1": { text: [{ type: "paragraph", children: [{ type: "text", text: "Hi" }] }] },
      "Cards-1": { "items.0.body": [{ type: "paragraph", children: [{ type: "text", text: "One" }] }] },
      "Entry-1": {
        markdown: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Some " },
              { type: "text", text: "Markdown", italic: true },
            ],
          },
        ],
      },
    });
    expect(byPath["/api/header.json"].richText).toEqual({
      T: { text: [{ type: "paragraph", children: [{ type: "text", text: "Top" }] }] },
    });

    const collections = byPath["/api/collections.json"] as ApiCollectionsFile;
    const news = collections.collections.find((collection) => collection.id === "news");
    expect(news?.settings).not.toHaveProperty("template");
    expect(news?.entries[0]).toMatchObject({ slug: "fair", path: "/news/fair" });
    expect(news?.entries[0]?.fields.text).not.toContain("script");
    expect(news?.entries[0]?.richText.text).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Games " },
          { type: "text", text: "here", link: "https://example.org" },
        ],
      },
    ]);
    const notes = collections.collections.find((collection) => collection.id === "notes");
    expect(notes?.entries[0]?.fields.body).toBe("<p>Hello <strong>there</strong>.</p>\n");
    expect(byPath["/api/es/site.json"]).toMatchObject({ language: "es", settings: { language: "es" } });
    expect(byPath["/api/site.json"].pages).toEqual([{ path: "/", title: "Home" }]);
  });

  it("lists the redirects builds send, leaving out old addresses pages have", async () => {
    const content = await loadSiteContent(
      memorySource({
        "content/site.json": { version: 1, title: "St. Joseph" },
        "content/pages/index.json": { version: 1, data: { root: { props: { title: "Home" } } } },
        "content/pages/about.json": { version: 1, data: { root: { props: { title: "About" } } } },
        "content/redirects.json": {
          version: 1,
          redirects: [
            { from: "/who-we-are/", to: "/about#history" },
            { from: "https://old.example.org/visit", to: " https://example.org/visit " },
            // The page wins, so visitors never reach this one.
            { from: "/about", to: "/" },
          ],
        },
      }),
    );
    const pages = content.pages.map((page) => ({
      page,
      head: pageHead(content, page),
      data: { root: { props: {} }, content: [] },
    }));
    const files = await contentApiFiles({ content, description, pages, layouts: [] });
    const manifest = JSON.parse(files.find((file) => file.path === "/api/manifest.json")?.content ?? "{}");
    expect((manifest as ApiManifest).redirects).toEqual([
      { from: "/who-we-are", to: "/about#history" },
      { from: "/visit", to: "https://example.org/visit" },
    ]);
  });

  it("names pages' files from their addresses", () => {
    expect(apiPageFile("/")).toBe("pages/index.json");
    expect(apiPageFile("/news/page/2")).toBe("pages/news/page/2.json");
  });
});
