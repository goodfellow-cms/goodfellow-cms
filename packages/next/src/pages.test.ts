import { resolve } from "node:path";
import { allPages, loadSiteContent, parseDemoContent } from "@goodfellow-cms/core";
import { fileSystemSource } from "@goodfellow-cms/core/node";
import { describe, expect, it } from "vitest";
import { goodfellowPages, pageMetadata } from "./index.js";

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
    expect(await site.robots()).toEqual({ rules: { userAgent: "*", allow: "/" } });
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
      canonical: "https://example.org/about",
      // The starter's news, which feed readers find from any page.
      types: { "application/rss+xml": [{ url: "/feeds/news.rss", title: "News – My site" }] },
    });
    expect(metadata.openGraph).toMatchObject({ images: ["https://example.org/media/a.png"] });
    expect(metadata.metadataBase).toEqual(new URL("https://example.org"));
  });
});
