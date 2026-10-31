import { describe, expect, it } from "vitest";
import type { Page } from "./content/load.js";
import { siteSettingsSchema } from "./content/schemas.js";
import {
  AI_TRAINING_CRAWLERS,
  getPageHead,
  pageAddressPath,
  pageHead,
  pageUrl,
  robotsContent,
  robotsRules,
  robotsTxt,
  sitemapPages,
} from "./head.js";
import { type SiteContent, siteSettingsSchema as schema } from "./index.js";

const settings = siteSettingsSchema.parse({
  version: 1,
  title: "St. Joseph",
  description: "A parish",
  url: "https://example.org/",
  titleTemplate: "%s | St. Joseph",
  socialImage: "/media/share.png",
});

const page = (path: string, props: Record<string, unknown>): Page => ({
  path,
  file: "",
  content: { version: 1, data: { root: { props }, content: [] } },
});

describe("getPageHead", () => {
  it("uses the title template for inner pages", () => {
    const head = getPageHead(settings, page("/about", { title: "About us" }));
    expect(head.title).toBe("About us | St. Joseph");
    expect(head.description).toBe("A parish");
    expect(head.canonicalUrl).toBe("https://example.org/about/");
    expect(head.socialImage).toBe("/media/share.png");
    expect(head.noIndex).toBe(false);
    expect(head).toMatchObject({ siteName: "St. Joseph", locale: "en", type: "website", card: "summary_large_image" });
  });

  it("uses the page title as-is on the home page, falling back to the site title", () => {
    expect(getPageHead(settings, page("/", { title: "Welcome" })).title).toBe("Welcome");
    expect(getPageHead(settings, page("/", {})).title).toBe("St. Joseph");
    expect(getPageHead(settings, page("/", {})).canonicalUrl).toBe("https://example.org/");
  });

  it("lets pages override the description and image", () => {
    const head = getPageHead(settings, page("/x", { description: "Mine", image: "/media/x.png" }));
    expect(head.description).toBe("Mine");
    expect(head.socialImage).toBe("/media/x.png");
  });

  it("keeps the 404 page out of search results", () => {
    expect(getPageHead(settings, page("/404", {})).noIndex).toBe(true);
  });

  it("keeps every page out of search results on a copy of the site that asks", () => {
    expect(getPageHead({ ...settings, noIndex: true }, page("/about", {})).noIndex).toBe(true);
  });

  it("asks search engines what a page's settings say, letting them show its pictures large", () => {
    const robots = (props: Record<string, unknown>, path = "/about") =>
      robotsContent(getPageHead(settings, page(path, props)));
    expect(robots({})).toBe("max-image-preview:large");
    expect(robots({ noFollow: true, noSnippet: true })).toBe("nofollow, nosnippet, max-image-preview:large");
    expect(robots({ noIndex: true, noSnippet: true })).toBe("noindex");
    expect(robots({ noIndex: true, noFollow: true })).toBe("noindex, nofollow");
    expect(robots({}, "/404")).toBe("noindex");
  });

  it("shows the shared picture large unless the page says small, or has none", () => {
    const card = (props: Record<string, unknown>, from = settings) => getPageHead(from, page("/about", props)).card;
    expect(card({ card: "auto" })).toBe("summary_large_image");
    expect(card({ card: "small" })).toBe("summary");
    expect(card({}, { ...settings, socialImage: undefined })).toBe("summary");
    expect(card({ card: "large" }, { ...settings, socialImage: undefined })).toBe("summary_large_image");
  });
});

describe("pages' full addresses", () => {
  it("end with a slash, as hosts serve the folders builds write, unless the build says otherwise", () => {
    expect(pageAddressPath("/about")).toBe("/about/");
    expect(pageAddressPath("/about/")).toBe("/about/");
    expect(pageAddressPath("/")).toBe("/");
    expect(pageAddressPath("/about#staff")).toBe("/about/#staff");
    expect(pageAddressPath("/media/bulletin.pdf")).toBe("/media/bulletin.pdf");
    expect(pageAddressPath("/about/", false)).toBe("/about");
    expect(pageAddressPath("/", false)).toBe("/");
    expect(pageUrl({}, "https://example.org/", "/news/fair")).toBe("https://example.org/news/fair/");
    expect(pageUrl({ trailingSlash: false }, "https://example.org", "/news/fair")).toBe(
      "https://example.org/news/fair",
    );
    expect(getPageHead({ ...settings, trailingSlash: false }, page("/about", {})).canonicalUrl).toBe(
      "https://example.org/about",
    );
  });
});

describe("link previews", () => {
  const content = (fields: Record<string, unknown>): SiteContent =>
    ({
      settings: schema.parse({ version: 1, title: "St. Joseph", url: "https://example.org", language: "en-US" }),
      menus: {},
      header: { version: 1, data: { root: {}, content: [] } },
      footer: { version: 1, data: { root: {}, content: [] } },
      pages: [],
      customCss: "",
      descriptions: { "/media/fair.jpg": { text: "Stalls on the lawn" } },
      collections: [
        {
          id: "news",
          settings: {
            version: 1,
            name: "News",
            itemName: "Story",
            path: "/news/{slug}",
            fields: [
              { name: "title", label: "Title", type: "text" },
              { name: "date", label: "Date", type: "date" },
            ],
          },
          entries: [{ slug: "fair", path: "/news/fair", file: "", content: { version: 1, fields } }],
        },
      ],
    }) as unknown as SiteContent;
  const fair: Page = {
    path: "/news/fair",
    file: "",
    entry: { collection: "news", slug: "fair" },
    content: { version: 1, data: { root: { props: { image: "/media/fair.jpg" } }, content: [] } },
  };

  it("describe a dated item as an article, with its picture's description", () => {
    expect(pageHead(content({ title: "The fair", date: "2026-06-01" }), fair)).toMatchObject({
      type: "article",
      publishedTime: "2026-06-01",
      socialImageAlt: "Stalls on the lawn",
      locale: "en_US",
    });
    expect(pageHead(content({ title: "The fair" }), fair)).toMatchObject({ type: "website" });
  });

  it("list pages in the sitemap at the addresses canonical links give", () => {
    expect(sitemapPages(content({ title: "The fair" }), [fair])).toEqual([{ url: "https://example.org/news/fair/" }]);
  });
});

describe("robots.txt", () => {
  it("lets every crawler in, and asks AI training's crawlers to stay out where the site says", () => {
    expect(robotsTxt({ url: "https://example.org" })).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://example.org/sitemap.xml\n",
    );
    const asked = robotsTxt({ noAiTraining: true });
    expect(asked).toContain("User-agent: GPTBot\nUser-agent: ClaudeBot\n");
    expect(asked).toContain("User-agent: cohere-training-data-crawler\nDisallow: /\n");
    expect(asked).not.toContain("Sitemap");
    // Search engines' own crawlers keep reading the site.
    expect(AI_TRAINING_CRAWLERS).not.toContain("Googlebot");
    expect(robotsRules({})).toEqual([{ userAgent: "*", allow: "/" }]);
  });
});
