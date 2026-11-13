import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { allPages, loadSiteContent, parseDemoContent } from "@goodfellow-cms/core";
import { fileSystemSource } from "@goodfellow-cms/core/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { goodfellowPages, pageMetadata, shownPage } from "./index.js";

const root = resolve(import.meta.dirname, "../../../templates/starter");
const site = goodfellowPages({ blocks: {} }, { root });

describe("goodfellowPages", () => {
  it("lists every page but 'not found' for Next.js to build, the home page as no segments", async () => {
    const params = await site.generateStaticParams();
    expect(params).toContainEqual({ path: [] });
    expect(params).toContainEqual({ path: ["news", "welcome"] });
    expect(params).not.toContainEqual({ path: ["404"] });
  });

  it("gives entries' pages their own titles", async () => {
    const metadata = await site.generateMetadata({ params: Promise.resolve({ path: ["news", "welcome"] }) });
    expect(metadata.title).toEqual({ absolute: "Welcome to our new website | My site" });
  });

  it("asks search engines not to list the admin panel", async () => {
    expect((await site.adminMetadata()).robots).toEqual({ index: false });
  });

  it("only writes a sitemap once the site's address is known", async () => {
    expect(await site.sitemap()).toEqual([]);
    expect(await site.robots()).toEqual({ rules: [{ userAgent: "*", allow: "/" }] });
  });
});

describe("members-only pages", () => {
  const block = (type: string, id: string, props: Record<string, unknown> = {}) => ({ type, props: { id, ...props } });
  const handbook = [
    block("Heading", "intro", { text: "Our handbook" }),
    block("Paywall", "wall"),
    block("Text", "secret", { text: "Members only" }),
  ];
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-members-"));
    const files: Record<string, unknown> = {
      "content/site.json": { version: 1, title: "Northwind", timeZone: "UTC" },
      "content/pages/index.json": { version: 1, data: { root: { props: { title: "Home" } }, content: [] } },
      "content/pages/about.json": {
        version: 1,
        data: { root: { props: { title: "About" } }, content: [block("Paywall", "stray"), block("Text", "open")] },
      },
      "content/pages/handbook.json": {
        version: 1,
        data: { root: { props: { title: "Handbook", visibility: "members" } }, content: handbook },
      },
      "content/collections/memos/_collection.json": {
        version: 1,
        name: "Memos",
        entryName: "Memo",
        path: "/memos/{slug}",
        visibility: "members",
        fields: [{ name: "title", label: "Title", type: "text" }],
        template: { root: {}, content: [block("Text", "body", { text: "{title}" })] },
      },
      "content/collections/memos/plans.json": { version: 1, fields: { title: "Plans" } },
    };
    for (const [path, value] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), JSON.stringify(value));
    }
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const load = async () => {
    const content = await loadSiteContent(fileSystemSource(dir));
    const page = (path: string) => {
      const found = allPages(content).find((candidate) => candidate.path === path);
      if (!found) throw new Error(`No page at ${path}.`);
      return found;
    };
    return { content, page };
  };

  it("shows everyone else a members-only page's teaser, and its members all of it, without the paywall", async () => {
    const { content, page } = await load();
    expect(shownPage(content, page("/handbook"), "everyone", "Paywall").content.data.content).toEqual(
      handbook.slice(0, 2),
    );
    expect(shownPage(content, page("/handbook"), "members", "Paywall").content.data.content).toEqual([
      handbook[0],
      handbook[2],
    ]);
  });

  it("shows a members' collection's items only as a paywall, which their template doesn't place", async () => {
    const { content, page } = await load();
    expect(shownPage(content, page("/memos/plans"), "everyone", "Paywall").content.data.content).toEqual([
      { type: "Paywall", props: { id: "Paywall-teaser" } },
    ]);
    expect(shownPage(content, page("/memos/plans"), "members", "Paywall").content.data.content).toEqual([
      block("Text", "body", { text: "{title}" }),
    ]);
  });

  it("shows pages for everyone in full, without a stray paywall", async () => {
    const { content, page } = await load();
    expect(shownPage(content, page("/about"), "everyone", "Paywall").content.data.content).toEqual([
      block("Text", "open"),
    ]);
  });

  it("shows every page as it is on a site with no paywall, as a static export does", async () => {
    const { content, page } = await load();
    expect(shownPage(content, page("/handbook"), "everyone")).toBe(page("/handbook"));
  });
});

describe("goodfellowPages with a source", () => {
  it("renders from the source each time, so a publish shows without a rebuild", async () => {
    const files = fileSystemSource(root);
    let title = "Before";
    // A repository's files, whose Site settings change when someone publishes.
    const source = {
      ...files,
      read: async (path: string) => {
        const text = await files.read(path);
        return path === "content/site.json" && text
          ? JSON.stringify({ ...JSON.parse(text), title, titleTemplate: `%s | ${title}` })
          : text;
      },
    };
    const live = goodfellowPages({ blocks: {} }, { root: "/nowhere", source: () => source });
    const params = { params: Promise.resolve({ path: ["news", "welcome"] }) };
    expect((await live.generateMetadata(params)).title).toEqual({ absolute: "Welcome to our new website | Before" });
    expect((await live.loadSite()).settings.title).toBe("Before");
    title = "After";
    expect((await live.generateMetadata(params)).title).toEqual({ absolute: "Welcome to our new website | After" });
    expect(await live.generateStaticParams()).toContainEqual({ path: ["news", "welcome"] });
  });

  it("gives the root layout a language when the source can't be read, so the admin panel still opens", async () => {
    const broken = goodfellowPages(
      { blocks: {} },
      {
        root,
        source: () => {
          throw new Error("Set GOODFELLOW_GIT_TOKEN, which pages read the content repository with.");
        },
      },
    );
    expect(await broken.language()).toBe("en");
    // Pages still fail, rather than show the content the site was built with as though it were current.
    await expect(broken.loadSite()).rejects.toThrow("GOODFELLOW_GIT_TOKEN");
  });

  it("reads the site's own files where the source gives nothing, as in next dev", async () => {
    const local = goodfellowPages({ blocks: {} }, { root, source: () => undefined });
    expect((await local.loadSite()).settings.title).toBe("My site");
  });
});

describe("demoContent", () => {
  it("copies the site's content for a demo's admin panel", async () => {
    const response = await goodfellowPages({ blocks: {}, demo: true }, { root }).demoContent();
    expect(response.status).toBe(200);
    const content = parseDemoContent(await response.text());
    expect(content.files["content/pages/about.json"]).toContain('"About us"');
    expect(content.media).toContain("public/media/logo.svg");
  });

  it("is empty for other sites", async () => {
    const response = await site.demoContent();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("pageMetadata", () => {
  it("makes addresses absolute from the site's address", async () => {
    const content = await loadSiteContent(fileSystemSource(root));
    const withUrl = {
      ...content,
      settings: { ...content.settings, url: "https://example.org", socialImage: "/media/a.png" },
    };
    const about = allPages(withUrl).find((page) => page.path === "/about");
    if (!about) throw new Error("The starter has no about page.");
    const metadata = pageMetadata(withUrl, about);
    expect(metadata.alternates).toEqual({
      canonical: "https://example.org/about/",
      // The starter's news, which feed readers find from any page.
      types: { "application/rss+xml": [{ url: "/feeds/news.rss", title: "News – My site" }] },
    });
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: "My site",
      images: [{ url: "https://example.org/media/a.png" }],
    });
    expect(metadata.twitter).toEqual({ card: "summary_large_image" });
    expect(metadata.robots).toEqual({ "max-image-preview": "large" });
    // The picture's size, where the media library has it.
    const sized = pageMetadata(withUrl, about, "", { "/media/a.png": { width: 1200, height: 630 } });
    expect(sized.openGraph).toMatchObject({
      images: [{ url: "https://example.org/media/a.png", width: 1200, height: 630 }],
    });
    expect(metadata.metadataBase).toEqual(new URL("https://example.org"));
  });
});
