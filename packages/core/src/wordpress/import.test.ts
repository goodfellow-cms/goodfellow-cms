import { describe, expect, it } from "vitest";
import { checkSite } from "../content/checks.js";
import { type ContentSource, loadSiteContent } from "../content/load.js";
import type { FileChange } from "../content/store.js";
import { fakeWordPress, SAMPLE_WORDPRESS_URL, sampleWordPressExport } from "../testing.js";
import { blockHtml, parseBlocks } from "./blocks.js";
import { readWordPressExport } from "./export-file.js";
import { planWordPressImport, WordPressImportError } from "./import.js";
import { WordPressReadError } from "./model.js";
import { fetchWordPressSite, wordPressAddress } from "./rest.js";

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

async function importSample(options: Parameters<typeof planWordPressImport>[2] = {}) {
  const content = await loadSiteContent(source(STARTER));
  const plan = planWordPressImport(readWordPressExport(sampleWordPressExport()), content, options);
  const files = applied(STARTER, plan.changes);
  return { plan, files, site: await loadSiteContent(source(files)) };
}

const json = (text: string | undefined) => JSON.parse(text ?? "{}");

describe("WordPress's blocks", () => {
  it("reads nested blocks, ones with no HTML and HTML between them", () => {
    const blocks = parseBlocks(
      '<p>Classic</p>\n<!-- wp:columns --><div><!-- wp:column {"width":"50%"} --><div><!-- wp:spacer {"height":"40px"} /--></div><!-- /wp:column --></div><!-- /wp:columns -->',
    );
    expect(blocks.map((block) => block.name)).toEqual(["core/freeform", "core/columns"]);
    const column = blocks[1]?.innerBlocks[0];
    expect(column?.attrs).toEqual({ width: "50%" });
    expect(column?.innerBlocks[0]?.name).toBe("core/spacer");
    expect(blocks[1] && blockHtml(blocks[1])).toBe("<div><div></div></div>");
  });
});

describe("WordPress export files", () => {
  it("reads pages, posts, categories, tags, menus, media and what isn't imported", () => {
    const site = readWordPressExport(sampleWordPressExport());
    expect(site).toMatchObject({ title: "St. Brendan's Parish", url: SAMPLE_WORDPRESS_URL, language: "en-US" });
    expect(site.items.filter((item) => item.type === "page")).toHaveLength(5);
    expect(site.items.find((item) => item.id === 20)).toMatchObject({
      type: "post",
      date: "2026-06-14T12:00",
      categories: ["events"],
      tags: ["summer"],
      image: 11,
    });
    expect(site.categories.map((category) => category.slug)).toEqual(["news", "events", "uncategorized"]);
    expect(site.media.find((file) => file.id === 10)).toMatchObject({ alt: "St. Brendan's church" });
    expect(site.menus?.[0]?.items.find((item) => item.id === 53)).toMatchObject({
      target: { kind: "category", id: 7 },
      url: `${SAMPLE_WORDPRESS_URL}/category/news/`,
    });
    expect(site.reusableBlocks[30]).toContain("Everyone is welcome.");
    expect(site.other).toEqual({ comments: 2, tribe_events: 1 });
  });

  it("refuses files that aren't WordPress export files", () => {
    expect(() => readWordPressExport("<html><body>Hello</body></html>")).toThrow(WordPressReadError);
    // An export file always says which site it's from, which addresses are worked out from.
    expect(() => readWordPressExport("<rss><channel><wp:wxr_version>1.2</wp:wxr_version></channel></rss>")).toThrow(
      WordPressReadError,
    );
  });
});

describe("planning an import", () => {
  it("brings pages across at their addresses, as built-in blocks", async () => {
    const { plan, files } = await importSample();
    expect(plan.summary.pages.sort()).toEqual(["/", "/about", "/about/staff", "/news"]);
    expect(plan.summary.replaced).toEqual(["/"]);

    const home = json(files["content/pages/index.json"]).data;
    expect(home.root.props).toMatchObject({ title: "Welcome to St. Brendan's" });
    const blocks = JSON.stringify(home.content);
    expect(blocks).toContain('"type":"Heading"');
    expect(blocks).toContain('"text":"Mass times"');
    // Links to imported pages get their new addresses; pictures are copied, whatever size the page showed.
    expect(blocks).toContain('<a href=\\"/about\\">Find out more about us</a>');
    expect(blocks).toContain('"src":"/media/church.jpg"');
    expect(blocks).toContain('"alt":"St. Brendan\'s church"');
    expect(blocks).toContain('"caption":"Our church in spring"');
    expect(blocks).toContain('"type":"Grid"');
    expect(blocks).toContain('"label":"Meet the staff","newTab":false,"size":"md","variant":"primary"');
    expect(blocks).toContain("Everyone is welcome.");
    expect(blocks).toContain('"type":"CollectionList"');

    const about = JSON.stringify(json(files["content/pages/about.json"]).data.content);
    expect(about).toContain('"level":"h1","text":"About us"');
    expect(about).toContain("<p>We are a parish family in Springfield.</p>");
    expect(about).toContain('<a href=\\"/about/staff\\">staff</a> are here to help.<br>Call the office');
    expect(about).toContain('"caption":"The choir at Easter"');
    expect(about).toContain("[sic]");
    expect(about).not.toContain("contact-form-7");

    const staff = JSON.stringify(json(files["content/pages/about/staff.json"]).data.content);
    expect(staff).toContain('"type":"Table"');
    expect(staff).toContain('"cells":[["Name","Role"],["Fr. Aidan Walsh","Pastor"]]');
    expect(staff).toContain('"source":"youtube"');
    expect(staff).toContain('"src":"/media/choir.jpg"');
  });

  it("keeps the media library's alt text as images' descriptions", async () => {
    const { files } = await importSample();
    const descriptions = json(files["content/media.json"]).descriptions;
    expect(descriptions["/media/church.jpg"]).toEqual({ text: "St. Brendan's church" });
    expect(descriptions["/media/picnic.jpg"]).toEqual({ text: "Families at the picnic" });
    expect(descriptions["/media/choir.jpg"]).toEqual({ text: "The choir" });
    // Only what's copied: the unused file isn't, and has no alt text anyway.
    expect(Object.keys(descriptions).some((url) => url.includes("unused"))).toBe(false);
  });

  it("makes posts a collection of Markdown items, listed on WordPress's posts page", async () => {
    const { plan, files } = await importSample();
    // Addresses with dates can't be an address pattern, so posts move, with redirects.
    expect(plan.summary).toMatchObject({
      posts: 3,
      collection: { id: "posts", path: "/news/{slug}" },
      listPath: "/news",
    });
    const settings = json(files["content/collections/posts/_collection.json"]);
    expect(settings.markdown).toEqual({ body: "body" });
    expect(settings.fields.find((field: { name: string }) => field.name === "categories").options).toEqual([
      { value: "events", label: "Events" },
      { value: "news", label: "News" },
    ]);

    const picnic = files["content/collections/posts/parish-picnic.md"] ?? "";
    expect(picnic).toContain("date: 2026-06-14");
    expect(picnic).toContain("image: /media/picnic.jpg");
    expect(picnic).toContain("Join us for the **parish picnic** on the green, with *games* for children.");
    expect(picnic).toContain("- Bring a dish to share\n  - Desserts are welcome\n- Games start at 2");
    expect(picnic).toContain("> A day for everyone.");
    expect(picnic).toContain("![Families at the picnic](/media/picnic.jpg)");
    expect(picnic).toContain("```\nNoon to 4\n```");
    expect(picnic).toContain("<https://vimeo.com/76979871>");
    expect(picnic).toContain("From another plugin.");

    const choir = files["content/collections/posts/choir-news.md"] ?? "";
    expect(choir).toContain("summary: The choir is looking for new voices.");
    expect(choir).toContain("See the [picnic](/news/parish-picnic) too.");
    // A scheduled post appears when WordPress would have published it.
    expect(files["content/collections/posts/advent-schedule.md"]).toContain("showFrom: 2026-11-29T08:00");

    const list = JSON.stringify(json(files["content/pages/news.json"]).data.content);
    expect(list).toContain('"collection":"posts"');
    expect(list).toContain('"choicePages":"categories"');
  });

  it("redirects old addresses, writes the menus and the site's details", async () => {
    const { files } = await importSample();
    expect(json(files["content/redirects.json"]).redirects).toEqual([
      { from: "/2026/06/parish-picnic", to: "/news/parish-picnic" },
      { from: "/2026/05/choir-news", to: "/news/choir-news" },
      { from: "/2026/12/advent-schedule", to: "/news/advent-schedule" },
      { from: "/category/news", to: "/news/categories/news" },
      { from: "/category/events", to: "/news/categories/events" },
      { from: "/tag/summer", to: "/news" },
    ]);
    expect(json(files["content/menus.json"]).menus).toEqual({
      footer: [],
      main: [
        { label: "Home", href: "/" },
        { label: "About us", href: "/about", children: [{ label: "Staff", href: "/about/staff" }] },
        { label: "Parish news", href: "/news/categories/news" },
        { label: "Diocese", href: "https://diocese.example.org/" },
      ],
    });
    expect(json(files["content/site.json"])).toMatchObject({
      title: "St. Brendan's Parish",
      description: "A parish family in Springfield",
      language: "en-US",
      url: "https://new.example.org/",
    });
  });

  it("lists the media to copy and says what didn't come across", async () => {
    const { plan } = await importSample();
    expect(plan.media).toEqual([
      { url: `${SAMPLE_WORDPRESS_URL}/wp-content/uploads/2026/05/church-scaled.jpg`, path: "public/media/church.jpg" },
      { url: `${SAMPLE_WORDPRESS_URL}/wp-content/uploads/2026/05/choir.jpg`, path: "public/media/choir.jpg" },
      { url: `${SAMPLE_WORDPRESS_URL}/wp-content/uploads/2026/06/picnic.jpg`, path: "public/media/picnic.jpg" },
    ]);
    expect(plan.notes).toEqual(
      expect.arrayContaining([
        { kind: "left-out", what: "drafts", count: 1 },
        { kind: "left-out", what: "private", count: 1 },
        { kind: "left-out", what: "comments", count: 2 },
        { kind: "left-out", what: "tribe_events", count: 1 },
        { kind: "converted", note: "shortcode", name: "contact-form-7", items: ["About us"] },
        { kind: "converted", note: "video", name: "video", items: ["Parish picnic"] },
        { kind: "converted", note: "block", name: "kadence/rowlayout", items: ["Parish picnic"] },
        { kind: "old-links", urls: [`${SAMPLE_WORDPRESS_URL}/old-history/`] },
        { kind: "unused-media", count: 1 },
      ]),
    );
  });

  it("leaves a site that loads, with nothing broken", async () => {
    const { plan, site } = await importSample();
    const media = plan.media.map((file) => `/media/${file.path.slice("public/media/".length)}`);
    // The list's pages for each category are added by its block, which core's checks don't have.
    const errors = checkSite(site, { media }).filter(
      (problem) =>
        problem.severity === "error" && !("target" in problem && problem.target.startsWith("/news/categories/")),
    );
    expect(errors).toEqual([]);
  });

  it("links to media that couldn't be copied where it is", async () => {
    const copied = new Set([`${SAMPLE_WORDPRESS_URL}/wp-content/uploads/2026/06/picnic.jpg`]);
    const { plan, files } = await importSample({ copied });
    expect(JSON.stringify(json(files["content/pages/index.json"]))).toContain(
      `"src":"${SAMPLE_WORDPRESS_URL}/wp-content/uploads/2026/05/church-scaled.jpg"`,
    );
    expect(plan.notes).toContainEqual({
      kind: "not-copied",
      urls: [
        `${SAMPLE_WORDPRESS_URL}/wp-content/uploads/2026/05/church-scaled.jpg`,
        `${SAMPLE_WORDPRESS_URL}/wp-content/uploads/2026/05/choir.jpg`,
      ],
    });
  });

  it("needs the built-in blocks", async () => {
    const content = await loadSiteContent(source(STARTER));
    expect(() =>
      planWordPressImport(readWordPressExport(sampleWordPressExport()), content, { blocks: ["Text"] }),
    ).toThrow(WordPressImportError);
  });

  it("keeps posts' addresses where an address pattern can say them", async () => {
    const xml = sampleWordPressExport().replace(/\/2026\/\d\d\/([a-z-]+)\//g, "/$1/");
    const content = await loadSiteContent(source(STARTER));
    const plan = planWordPressImport(readWordPressExport(xml), content);
    expect(plan.summary.collection).toEqual({ id: "posts", path: "/{slug}" });
    // WordPress's posts page lists them.
    expect(plan.summary.listPath).toBe("/news");
    expect(plan.summary.redirects).toBe(3);
  });
});

describe("WordPress sites' addresses", () => {
  it("reads a site through WordPress's API", async () => {
    const wordpress = fakeWordPress();
    const site = await fetchWordPressSite("stbrendan.example.org", { fetch: wordpress.fetch });
    expect(site).toMatchObject({ title: "St. Brendan's Parish", url: SAMPLE_WORDPRESS_URL, source: "address" });
    expect(site.items.map((item) => item.id).sort((a, b) => a - b)).toEqual([2, 3, 4, 6, 20, 21]);
    expect(site.items.find((item) => item.id === 20)).toMatchObject({
      rendered: true,
      categories: ["events"],
      tags: ["summer"],
    });
    expect(site.menus).toBeUndefined();

    const content = await loadSiteContent(source(STARTER));
    const plan = planWordPressImport(site, content);
    const files = applied(STARTER, plan.changes);
    expect(JSON.stringify(json(files["content/pages/about/staff.json"]))).toContain('"source":"youtube"');
    expect(files["content/collections/posts/parish-picnic.md"]).toContain(
      "- Bring a dish to share\n  - Desserts are welcome",
    );
    expect(plan.notes).toContainEqual({ kind: "no-menus" });
    expect(plan.notes).toContainEqual({ kind: "converted", note: "form", name: "form", items: ["About us"] });
    expect(json(files["content/menus.json"]).menus.main).toEqual([
      { label: "Welcome to St. Brendan’s", href: "/" },
      { label: "About us", href: "/about" },
      { label: "News", href: "/news" },
    ]);
    const loaded = await loadSiteContent(source(files));
    expect(loaded.collections.find((collection) => collection.id === "posts")?.entries).toHaveLength(2);
  });

  it("explains addresses that aren't WordPress sites", async () => {
    const wordpress = fakeWordPress();
    await expect(fetchWordPressSite("https://elsewhere.example.org", { fetch: wordpress.fetch })).rejects.toMatchObject(
      {
        problem: "not-wordpress",
      },
    );
    expect(wordPressAddress("example.org/blog/")).toBe("https://example.org/blog");
    expect(wordPressAddress("ftp://example.org")).toBeUndefined();
  });
});
