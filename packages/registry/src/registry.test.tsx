import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  EMPTY_RECORD,
  type FileChange,
  type GoodfellowConfig,
  planInstall,
  REGISTRY_PACKAGES,
  registryIndexSchema,
  registryItemSchema,
  type SiteContent,
  siteSettingsSchema,
} from "@goodfellow-cms/core";
import { blockParts } from "@goodfellow-cms/react";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import registry from "../registry.json" with { type: "json" };

const built = fileURLToPath(new URL("../r/", import.meta.url));
const registries = { "@goodfellow": "https://registry.example/r/{name}.json" };
const fetchJson = async (url: string) => {
  const name = url.slice("https://registry.example/r/".length);
  return JSON.parse(await readFile(`${built}${name}`, "utf8"));
};
const blockNames = registry.items.map((item) => item.name);

describe("the built registry", () => {
  it("lists every block and shadcn component, each valid", async () => {
    const index = registryIndexSchema.parse(await fetchJson("https://registry.example/r/registry.json"));
    const files = (await readdir(built)).filter((file) => file !== "registry.json");
    expect(files.sort()).toEqual(index.items.map((item) => `${item.name}.json`).sort());
    for (const file of files) {
      const item = registryItemSchema.parse(JSON.parse(await readFile(`${built}${file}`, "utf8")));
      // Sites have these packages from the start, since the admin panel can't add packages.
      for (const dependency of item.dependencies) {
        expect(REGISTRY_PACKAGES, `${item.name} needs ${dependency}`).toContain(dependency.replace(/(.)@.*$/, "$1"));
      }
    }
    expect(index.items.filter((item) => item.meta?.goodfellow).map((item) => item.name)).toEqual(blockNames);
  });

  it.each(blockNames)("installs %s with every file it imports", async (name) => {
    const files = new Map<string, string>();
    const plan = await planInstall({
      ref: `@goodfellow/${name}`,
      registries,
      fetchJson,
      readFile: async (path) => files.get(path),
      record: EMPTY_RECORD,
      blocks: [],
    });
    for (const change of plan.changes as Array<Extract<FileChange, { content: string }>>) {
      files.set(change.path, change.content);
    }
    expect(files.get("blocks/installed/index.ts")).toContain(`"${name}": block0`);
    for (const [path, content] of files) {
      for (const [, imported] of content.matchAll(/from "@\/([^"]+)"/g)) {
        expect(
          [...files.keys()].some((file) => file.replace(/\.tsx?$/, "") === imported),
          `${path} imports @/${imported}`,
        ).toBe(true);
      }
    }
  });
});

describe("blocks", () => {
  const settings = siteSettingsSchema.parse({ version: 1, title: "St. Joseph" });
  const content: SiteContent = {
    settings,
    menus: {},
    header: { version: 1, data: { root: {}, content: [] } },
    footer: { version: 1, data: { root: {}, content: [] } },
    pages: [],
    collections: [],
    customCss: "",
  };

  it.each(blockNames)("renders %s with its default settings", async (name) => {
    const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
    const config: GoodfellowConfig = { blocks: { [name]: block } };
    const html = await createPageRenderer(config)(content, {
      path: "/",
      file: "content/pages/index.json",
      content: {
        version: 1,
        data: {
          root: { props: { title: "Home" } },
          content: [{ type: name, props: { id: "b", ...block.defaultProps } }],
        },
      },
    });
    expect(html).toContain('<main class="gf-main" data-pagefind-body="">');
    expect(html).not.toContain("<!--$!-->");
  });

  it.each(blockNames)("names %s's parts after the block, so they can't clash with others'", async (name) => {
    const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
    const parts = Object.keys(blockParts(block) ?? {});
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(part === `gf-${name}` || part.startsWith(`gf-${name}-`), part).toBe(true);
  });

  it("keeps every answer and tab in the page, hidden until shown", async () => {
    const render = async (name: string, props: Record<string, unknown>) => {
      const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
      return createPageRenderer({ blocks: { [name]: block } })(content, {
        path: "/",
        file: "content/pages/index.json",
        content: {
          version: 1,
          data: { root: { props: {} }, content: [{ type: name, props: { id: "b", ...block.defaultProps, ...props } }] },
        },
      });
    };
    const faq = await render("shadcn-faq", {});
    expect(faq).toContain("A question people ask");
    expect(faq.match(/Its answer\./g)).toHaveLength(2);
    expect(faq).toContain("[&amp;&gt;[data-slot=accordion-content][data-state=closed]]:hidden");
    const tabs = await render("shadcn-tabs", {});
    expect(tabs).toContain("What the second tab shows.");
  });

  it("makes custom HTML safe unless told to use it as written", async () => {
    const name = "custom-html";
    const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
    const render = (props: Record<string, unknown>) =>
      createPageRenderer({ blocks: { "custom-html": block } })(content, {
        path: "/",
        file: "content/pages/index.json",
        content: {
          version: 1,
          data: {
            root: { props: {} },
            content: [{ type: "custom-html", props: { id: "b", ...block.defaultProps, ...props } }],
          },
        },
      });
    const html = '<p class="note" onclick="steal()">Hi</p><script>window.ran = true;</script>';
    const safe = await render({ html, className: "my-html" });
    expect(safe).toContain('<div class="gf-custom-html my-html"><p class="note">Hi</p></div>');
    expect(safe).not.toContain("window.ran");
    const asWritten = await render({ html, sanitize: false });
    expect(asWritten).toContain(`<div class="gf-custom-html">${html}</div>`);
  });

  it("holds custom HTML used as written back until visitors agree, on a site that asks", async () => {
    const block = (await import("../site/blocks/installed/custom-html/block.tsx")).default as ComponentConfig;
    const asking = { ...content, settings: siteSettingsSchema.parse({ ...content.settings, consent: {} }) };
    const render = (props: Record<string, unknown>) =>
      createPageRenderer({ blocks: { "custom-html": block } })(asking, {
        path: "/",
        file: "content/pages/index.json",
        content: {
          version: 1,
          data: {
            root: { props: {} },
            content: [{ type: "custom-html", props: { id: "b", ...block.defaultProps, sanitize: false, ...props } }],
          },
        },
      });
    const map = '<iframe src="https://www.google.com/maps/embed?pb=1"></iframe><script>window.ran = true;</script>';
    const held = await render({ html: map });
    expect(held).toContain(`<template data-gf-consent-code="body">${map}</template>`);
    expect(held).toContain("This comes from google.com, which can set cookies.");
    // Nothing outside the template loads.
    expect(held.replace(/<template[\s\S]*?<\/template>/g, "")).not.toMatch(/<iframe|window\.ran/);
    // HTML that loads nothing shows at once.
    expect(await render({ html: "<p>Plain</p>" })).toContain('<div class="gf-custom-html"><p>Plain</p></div>');
  });
});

describe("the parish site's blocks", () => {
  const settings = siteSettingsSchema.parse({ version: 1, title: "St. Joseph" });
  const page = (path: string, title: string) => ({
    path,
    file: `content/pages${path === "/" ? "/index" : path}.json`,
    content: { version: 1, data: { root: { props: { title } }, content: [] } },
  });
  const content: SiteContent = {
    settings,
    menus: {
      main: [
        { label: "Home", href: "/" },
        {
          label: "Parish life",
          href: "/parish-life",
          children: [
            { label: "Ministries", href: "/parish-life/ministries" },
            { label: "Groups", href: "/parish-life/groups" },
          ],
        },
      ],
    },
    header: { version: 1, data: { root: {}, content: [] } },
    footer: { version: 1, data: { root: {}, content: [] } },
    pages: [
      page("/", "Home"),
      page("/parish-life", "Parish life"),
      page("/parish-life/ministries", "Ministries"),
      page("/parish-life/ministries/choir", "Choir"),
      page("/parish-life/ministries/ushers", "Ushers"),
      page("/parish-life/groups", "Groups"),
    ] as SiteContent["pages"],
    collections: [],
    customCss: "",
  };
  const render = async (name: string, props: Record<string, unknown>, path = "/") => {
    const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
    return createPageRenderer({ blocks: { [name]: block } })(content, {
      path,
      file: "content/pages/index.json",
      content: {
        version: 1,
        data: { root: { props: {} }, content: [{ type: name, props: { id: "b", ...block.defaultProps, ...props } }] },
      },
    });
  };

  it("reads RSS and Atom feeds' titles, links and dates, and nothing else", async () => {
    const { readFeedItems } = await import("../site/blocks/installed/feed-list/block.js");
    const rss = `<rss><channel><item><title><![CDATA[Fish &amp; chips]]></title><link>https://news.example/1</link>
      <pubDate>Tue, 01 Oct 2026 10:00:00 GMT</pubDate><description>Not shown</description></item>
      <item><title>Bad link</title><link>javascript:alert(1)</link></item></channel></rss>`;
    expect(readFeedItems(rss)).toEqual([
      { title: "Fish & chips", link: "https://news.example/1", date: "Tue, 01 Oct 2026 10:00:00 GMT" },
    ]);
    const atom = `<feed><entry><title>Episode 2</title><link rel="enclosure" href="https://cdn.example/2.mp3"/>
      <link href="https://podcast.example/2"/><updated>2026-10-02T00:00:00Z</updated></entry></feed>`;
    expect(readFeedItems(atom)).toEqual([
      { title: "Episode 2", link: "https://podcast.example/2", date: "2026-10-02T00:00:00Z" },
    ]);
  });

  it("maps an address, or Google Maps' own embed code, and nothing else", async () => {
    const { mapAddress } = await import("../site/blocks/installed/map/block.js");
    expect(mapAddress("1 Main St, Springfield", 15)).toBe(
      "https://maps.google.com/maps?q=1+Main+St%2C+Springfield&z=15&output=embed",
    );
    expect(
      mapAddress('<iframe src="https://www.google.com/maps/embed?pb=!1m18&amp;x=1" width="600"></iframe>', 15),
    ).toBe("https://www.google.com/maps/embed?pb=!1m18&x=1");
    expect(mapAddress('<iframe src="https://evil.example/maps/embed"></iframe>', 15)).toBeUndefined();
    expect(mapAddress("<script>alert(1)</script>", 15)).toBeUndefined();
    const html = await render("map", { query: "1 Main St" });
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
    expect(await render("map", { query: "" })).not.toContain("Enter an address");
  });

  it("links to the other pages in the page's part of the menu, or a submenu page's own pages", async () => {
    const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => m[2]);
    expect(links(await render("section-links", {}, "/parish-life/groups"))).toEqual(["Ministries", "Groups"]);
    const choir = await render("section-links", {}, "/parish-life/ministries/choir");
    expect(links(choir)).toEqual(["Choir", "Ushers"]);
    const current = [...choir.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(current).toEqual(["Choir"]);
  });

  it("gives the slideshow a stop button, and hides pictures without a description from screen readers", async () => {
    const html = await render("slideshow-hero", {
      slides: [
        { image: "/media/a.jpg", alt: "The church at dawn" },
        { image: "/media/b.jpg", alt: "" },
      ],
    });
    expect(html).toContain(">Pause</button>");
    expect(html).toContain('alt="The church at dawn"');
    expect(html).toMatch(
      /<img[^>]*aria-hidden="true"[^>]*src="\/media\/b.jpg"|<img[^>]*src="\/media\/b.jpg"[^>]*aria-hidden="true"/,
    );
  });

  it("names each social network for screen readers", async () => {
    const html = await render("social-links", {
      links: [{ network: "youtube", href: "https://youtube.example/@parish" }],
    });
    expect(html).toContain('<span class="sr-only">YouTube</span>');
  });
});
