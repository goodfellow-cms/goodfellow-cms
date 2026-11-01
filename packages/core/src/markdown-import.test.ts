import { describe, expect, it } from "vitest";
import { checkSite } from "./content/checks.js";
import { type ContentSource, loadSiteContent } from "./content/load.js";
import type { FileChange } from "./content/store.js";
import { MarkdownImportError, markdownFolders, planMarkdownImport, rewriteMarkdown } from "./markdown-import.js";

/** A small site to import into, like the starter: a home page, an about page and a main menu. */
const STARTER: Record<string, string> = {
  "content/site.json": JSON.stringify({ version: 1, title: "My site", url: "https://new.example.org/" }),
  "content/menus.json": JSON.stringify({ version: 1, menus: { main: [{ label: "Home", href: "/" }], footer: [] } }),
  "content/pages/index.json": JSON.stringify({ version: 1, data: { root: { props: { title: "Home" } }, content: [] } }),
  "content/pages/contact.json": JSON.stringify({
    version: 1,
    data: { root: { props: { title: "Contact" } }, content: [] },
  }),
};

/** A made-up parish's old static site: pages at the top, posts and events in folders, and a picture. */
const FOLDER: Record<string, string> = {
  "index.md": "---\ntitle: Welcome\n---\n\nHello from the old site.\n",
  "about.md": [
    "---",
    "title: About us",
    "description: Who we are",
    "weight: 2",
    "aliases: [/who-we-are]",
    "---",
    "",
    "# About us",
    "",
    "We meet on Sundays. See [our news](posts/_index.md), [the fête](posts/2026-06-01-fete.md#when) and [contact us](/contact/).",
    "",
    "![The church](images/church.jpg)",
    "",
    "| Day | Time |",
    "| --- | ---- |",
    "| Sunday | 10:00 |",
  ].join("\n"),
  "visit/index.md":
    "---\ntitle: Visit\nweight: 1\nnoindex: true\n---\n\nFind us [here](../about.md). Old [link](missing.md).\n",
  "contact.md": "---\ntitle: Contact the parish\n---\n\nWrite to us.\n",
  "secret.md": "---\ntitle: Not yet\ndraft: true\n---\n\nComing soon.\n",
  "posts/_index.md": "---\ntitle: Parish news\n---\n\nThe latest from the parish.\n",
  "posts/2026-06-01-fete.md": [
    "---",
    "title: Parish fête",
    "tags: [summer, events]",
    "categories: News",
    "image: ../images/church.jpg",
    "summary: Games and cakes",
    "colour: blue",
    "---",
    "",
    "# Parish fête",
    "",
    "## When",
    "",
    'Saturday. Read [about us](../about.md). <b>Bold</b> {{< figure src="x" >}}',
    "",
    "```",
    "[not a link](nowhere.md)",
    "```",
  ].join("\n"),
  "posts/2026-05-01-choir.md": "---\ntitle: New choir\ndate: 2026-05-02\ntags: summer\n---\n\nSing with us.\n",
  "images/church.jpg": "",
};
const FILES = Object.keys(FOLDER);

function source(files: Record<string, string>): ContentSource {
  return {
    read: async (path) => files[path],
    list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
  };
}

function applied(files: Record<string, string>, changes: FileChange[]): Record<string, string> {
  const result = { ...files };
  for (const change of changes) {
    if ("delete" in change && change.delete) delete result[change.path];
    else if ("content" in change && typeof change.content === "string") result[change.path] = change.content;
  }
  return result;
}

async function importFolder(options: Parameters<typeof planMarkdownImport>[3] = {}) {
  const content = await loadSiteContent(source(STARTER));
  const plan = planMarkdownImport(FILES, (file) => FOLDER[file], content, options);
  const files = applied(STARTER, plan.changes);
  return { plan, files, site: await loadSiteContent(source(files)) };
}

const json = (text: string | undefined) => JSON.parse(text ?? "{}");

describe("markdownFolders", () => {
  it("lists the folders with Markdown in them, the top's as pages and the rest as collections", () => {
    expect(markdownFolders(FILES)).toEqual([
      { name: "", files: 4, suggested: "pages" },
      { name: "posts", files: 3, suggested: "collection" },
      { name: "visit", files: 1, suggested: "collection" },
    ]);
  });
});

describe("planMarkdownImport", () => {
  it("makes pages of the files at the top, at their addresses, with their words as blocks", async () => {
    const { plan, files } = await importFolder({ folders: { visit: "pages" } });
    expect(plan.summary.pages).toEqual(["/about", "/posts", "/visit"]);
    const about = json(files["content/pages/about.json"]);
    expect(about.data.root.props).toMatchObject({ title: "About us", description: "Who we are" });
    const text = JSON.stringify(about.data.content);
    // Its own first heading, so no second one; links to the other files at their new addresses; the picture copied.
    expect(text.match(/"level":"h1"/g)).toHaveLength(1);
    expect(text).toContain('href=\\"/posts\\"');
    expect(text).toContain('href=\\"/posts/fete#when\\"');
    expect(text).toContain('href=\\"/contact\\"');
    expect(text).toContain("/media/church.jpg");
    expect(text).toContain('"type":"Table"');
    expect(plan.media).toEqual([{ file: "images/church.jpg", path: "public/media/church.jpg" }]);
    // A folder's own page, and noindex.
    expect(json(files["content/pages/visit.json"]).data.root.props).toMatchObject({ title: "Visit", noIndex: true });
  });

  it("leaves the home page, pages the site has and drafts alone unless asked", async () => {
    const { plan, files } = await importFolder();
    expect(files["content/pages/index.json"]).toBe(STARTER["content/pages/index.json"]);
    expect(files["content/pages/contact.json"]).toBe(STARTER["content/pages/contact.json"]);
    expect(plan.notes).toContainEqual({ kind: "taken", files: ["contact.md", "index.md"] });
    expect(plan.notes).toContainEqual({ kind: "drafts", files: ["secret.md"] });
    expect(files["content/pages/secret.json"]).toBeUndefined();

    const all = await importFolder({ replaceHome: true, replacePages: true, drafts: true });
    expect(json(all.files["content/pages/index.json"]).data.root.props.title).toBe("Welcome");
    expect(json(all.files["content/pages/contact.json"]).data.root.props.title).toBe("Contact the parish");
    expect(all.plan.summary.replaced).toEqual(["/", "/contact"]);
    expect(all.plan.summary.drafts).toBe(1);
    expect(all.files["content/pages/secret.json"]).toBeDefined();
  });

  it("makes a collection of each other folder, keeping its items' Markdown and front matter", async () => {
    const { plan, files, site } = await importFolder({ folders: { visit: "pages" } });
    expect(plan.summary.collections).toEqual([
      { id: "posts", name: "Posts", path: "/posts/{slug}", items: 2, list: "/posts" },
    ]);
    const posts = site.collections.find((collection) => collection.id === "posts");
    expect(posts?.settings.entryName).toBe("Post");
    expect(posts?.settings.fields.map((field) => field.name)).toEqual([
      "title",
      "date",
      "summary",
      "image",
      "categories",
      "tags",
      "body",
    ]);
    // Dates from front matter or the file's name, newest first.
    expect(posts?.entries.map((entry) => [entry.slug, entry.content.fields.date])).toEqual([
      ["fete", "2026-06-01"],
      ["choir", "2026-05-02"],
    ]);
    const fete = files["content/collections/posts/fete.md"] ?? "";
    expect(fete).toContain("image: /media/church.jpg");
    expect(fete).toContain("- summer");
    expect(fete).not.toMatch(/^# Parish fête/m);
    expect(fete).toContain("Read [about us](/about).");
    // Code stays as it is.
    expect(fete).toContain("[not a link](nowhere.md)");
    // The folder's own page lists its items.
    expect(JSON.stringify(json(files["content/pages/posts.json"]).data)).toContain('"collection":"posts"');
    expect(plan.notes).toContainEqual({ kind: "html", files: ["posts/2026-06-01-fete.md"] });
    expect(plan.notes).toContainEqual({ kind: "template-code", files: ["posts/2026-06-01-fete.md"] });
    expect(plan.notes).toContainEqual({ kind: "fields", names: ["colour"] });
    expect(plan.notes).toContainEqual({ kind: "missing-links", files: ["visit/index.md"] });
  });

  it("keeps front matter of its own as fields when asked", async () => {
    const { site } = await importFolder({ keepFields: true });
    const posts = site.collections.find((collection) => collection.id === "posts");
    expect(posts?.settings.fields.find((field) => field.name === "colour")).toMatchObject({ type: "text" });
    expect(posts?.entries.find((entry) => entry.slug === "fete")?.content.fields.colour).toBe("blue");
  });

  it("adds the top-level pages to the main menu in their weight's order, when asked", async () => {
    const { files } = await importFolder({ folders: { visit: "pages" }, menu: true });
    expect(json(files["content/menus.json"]).menus.main).toEqual([
      { label: "Home", href: "/" },
      { label: "Visit", href: "/visit" },
      { label: "About us", href: "/about" },
      { label: "Parish news", href: "/posts" },
    ]);
  });

  it("sends old addresses that changed to the new ones", async () => {
    const { files } = await importFolder({ folders: { visit: "pages" } });
    expect(json(files["content/redirects.json"]).redirects).toEqual([
      { from: "/posts/2026-05-01-choir", to: "/posts/choir" },
      { from: "/posts/2026-06-01-fete", to: "/posts/fete" },
      { from: "/who-we-are", to: "/about" },
    ]);
  });

  it("leaves the site with no broken links", async () => {
    const { site, plan } = await importFolder({ folders: { visit: "pages" } });
    const media = ["/media/logo.svg", ...plan.media.map((copy) => `/${copy.path.slice("public/".length)}`)];
    expect(checkSite(site, { media }).filter((problem) => problem.severity === "error")).toEqual([]);
  });

  it("needs the built-in blocks pages are made of", async () => {
    const content = await loadSiteContent(source(STARTER));
    expect(() => planMarkdownImport(FILES, (file) => FOLDER[file], content, { blocks: ["Text"] })).toThrow(
      MarkdownImportError,
    );
  });
});

describe("rewriteMarkdown", () => {
  it("changes links' and pictures' addresses, outside code, making links that go nowhere their words", () => {
    const markdown = [
      '[Kept](a.md "Title") and [gone](b.md) and ![pic](p.jpg) and ![gone](q.jpg)',
      "`[code](a.md)`",
      "",
      "[ref]: a.md",
    ].join("\n");
    const out = rewriteMarkdown(
      markdown,
      (address) => (address === "a.md" ? "/a" : ""),
      (address) => (address === "p.jpg" ? "/media/p.jpg" : ""),
    );
    expect(out).toBe(
      ['[Kept](/a "Title") and gone and ![pic](/media/p.jpg) and ', "`[code](a.md)`", "", "[ref]: /a"].join("\n"),
    );
  });
});
