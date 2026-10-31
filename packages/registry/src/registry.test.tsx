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
    const name = "custom-html";
    const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
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

  it("maps OpenStreetMap's embed code, a link to a place on it, or a latitude and longitude, and nothing else", async () => {
    const { osmMapAddress } = await import("../site/blocks/installed/map/block.js");
    expect(
      osmMapAddress(
        '<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=-0.08%2C51.50%2C-0.07%2C51.51&amp;layer=mapnik&amp;marker=51.505%2C-0.075"></iframe>',
        15,
      ),
    ).toBe(
      "https://www.openstreetmap.org/export/embed.html?bbox=-0.08,51.50,-0.07,51.51&layer=mapnik&marker=51.505,-0.075",
    );
    const linked = osmMapAddress("https://www.openstreetmap.org/?mlat=51.5055&mlon=-0.0754#map=17/51.5/-0.07", 15);
    expect(linked).toMatch(
      /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=[-\d.,]+&layer=mapnik&marker=51\.5055,-0\.0754$/,
    );
    expect(osmMapAddress("51.5055, -0.0754", 15)).toMatch(/marker=51\.5055,-0\.0754$/);
    // Addresses would need OpenStreetMap's search, and only its own maps are shown.
    expect(osmMapAddress("1 Main St, Springfield", 15)).toBeUndefined();
    expect(osmMapAddress("https://evil.example/export/embed.html?bbox=1,2,3,4", 15)).toBeUndefined();
    expect(osmMapAddress("51.5, 200", 15)).toBeUndefined();
    const html = await render("map", { service: "openstreetmap", query: "51.5055, -0.0754" });
    expect(html).toContain("openstreetmap.org/export/embed.html");
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

describe("people, numbers, timelines, countdowns and comments", () => {
  const base = siteSettingsSchema.parse({
    version: 1,
    title: "St. Joseph",
    language: "en",
    timeZone: "America/Chicago",
  });
  const render = async (name: string, props: Record<string, unknown>, settings = base) => {
    const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
    const html = await createPageRenderer({ blocks: { [name]: block } })(
      {
        settings,
        menus: {},
        header: { version: 1, data: { root: {}, content: [] } },
        footer: { version: 1, data: { root: {}, content: [] } },
        pages: [],
        collections: [],
        customCss: "",
      },
      {
        path: "/news/fair",
        file: "content/pages/news/fair.json",
        content: {
          version: 1,
          data: { root: { props: {} }, content: [{ type: name, props: { id: "b", ...block.defaultProps, ...props } }] },
        },
      },
    );
    return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  };

  it("puts people's names a level under the heading, with their photos hidden from screen readers", async () => {
    const people = [
      { photo: "/media/ann.jpg", name: "Ann Lee", role: "Secretary", bio: "", email: "ann@example.org", link: "" },
    ];
    const html = await render("people", { people });
    expect(html).toMatch(/<h2 [^>]*>Our team<\/h2>/);
    expect(html).toMatch(/<h3 [^>]*>Ann Lee<\/h3>/);
    expect(html).toMatch(/<img (?=[^>]*alt="")(?=[^>]*aria-hidden="true")[^>]*src="\/media\/ann.jpg"/);
    expect(html).toContain('href="mailto:ann@example.org"');
    expect(await render("people", { people, heading: "" })).toMatch(/<h2 [^>]*>Ann Lee<\/h2>/);
  });

  it("names whose each logo is, and shows nothing to visitors without any", async () => {
    const html = await render("logos", { logos: [{ image: "/media/diocese.png", name: "The diocese", link: "" }] });
    expect(html).toMatch(/<img [^>]*alt="The diocese"/);
    expect(await render("logos", {})).not.toContain("gf-logos");
  });

  it("gives each number the words it counts as its term", async () => {
    const html = await render("numbers", {});
    expect(html).toMatch(/<dt [^>]*>Families<\/dt><dd [^>]*>1,200<\/dd>/);
  });

  it("lists a timeline's moments in order", async () => {
    const html = await render("timeline", {});
    expect(html).toMatch(/<ol [^>]*>.*1902.*The first church is built.*1958.*2002.*<\/ol>/s);
    expect(html).toMatch(/<h3 [^>]*>The school opens<\/h3>/);
  });

  it("counts down to a moment in the site's time zone, saying when it is before it starts counting", async () => {
    const { countdownInstant } = await import("../site/blocks/installed/countdown/block.js");
    expect(countdownInstant("2027-12-24", "18:00", "America/Chicago")?.toISOString()).toBe("2027-12-25T00:00:00.000Z");
    expect(countdownInstant("2027-12-24", "", "America/Chicago")?.toISOString()).toBe("2027-12-24T06:00:00.000Z");
    expect(countdownInstant("24/12/2027", "18:00", "America/Chicago")).toBeUndefined();
    expect(countdownInstant("2027-12-24", "6pm", "America/Chicago")).toBeUndefined();
    const future = await render("countdown", { date: "2099-12-24", time: "18:00" });
    expect(future).toContain('<time dateTime="2099-12-25T00:00:00.000Z"');
    expect(future).toContain("Thursday, December 24, 2099 at 6:00");
    const past = await render("countdown", { date: "2000-12-24", time: "18:00" });
    expect(past).toContain(">It&#x27;s here!</p>");
    expect(past).not.toContain("<time");
    expect(await render("countdown", {})).not.toContain("gf-countdown");
  });

  it("reads Giscus's code, and loads Giscus only on the built site, waiting for visitors that are asked", async () => {
    const { giscusSettings } = await import("../site/blocks/installed/comments/block.js");
    const code = `<script src="https://giscus.app/client.js"
        data-repo="stjoseph/website" data-repo-id="R_kgDOabc123" data-category="Comments"
        data-category-id="DIC_kwDOabc123" data-mapping="pathname" crossorigin="anonymous" async></script>`;
    expect(giscusSettings(code)).toEqual({
      repo: "stjoseph/website",
      repoId: "R_kgDOabc123",
      category: "Comments",
      categoryId: "DIC_kwDOabc123",
    });
    expect(giscusSettings(code.replace("stjoseph/website", "stjoseph/web site"))).toBeUndefined();
    expect(giscusSettings("<p>Hi</p>")).toBeUndefined();
    // Without consent, the island loads Giscus's script once the page has loaded.
    expect(await render("comments", { code })).toContain('<div class="giscus gf-comments-frame w-full"></div>');
    expect(await render("comments", {})).not.toContain("gf-comments");
    // Without code, it shows where Site Settings says comments are kept.
    const kept = siteSettingsSchema.parse({
      ...base,
      comments: {
        repo: "stjoseph/comments",
        repoId: "R_kgDOdef456",
        category: "Announcements",
        categoryId: "DIC_kwDOdef456",
      },
    });
    expect(await render("comments", {}, kept)).toContain('<div class="giscus gf-comments-frame w-full"></div>');
    // Code that isn't Giscus's never falls back to the setting, so a mistake shows in the editor.
    expect(await render("comments", { code: "<p>Hi</p>" }, kept)).not.toContain("gf-comments");
    // A site that asks keeps it in a template until the visitor agrees.
    const asking = siteSettingsSchema.parse({ ...base, consent: {} });
    const held = await render("comments", { code: code.replace("Comments", "Q&A") }, asking);
    expect(held).toMatch(
      /<template data-gf-consent-code="body"><script src="https:\/\/giscus.app\/client.js" crossorigin="anonymous" async data-repo="stjoseph\/website" data-repo-id="R_kgDOabc123" data-category="Q&amp;A" [^<]*data-mapping="pathname" [^<]*data-lang="en"[^<]*><\/script><\/template>/,
    );
    expect(held.replace(/<template[\s\S]*?<\/template>/g, "")).not.toContain('giscus.app/client.js"');
    expect(held).toContain("This comes from giscus.app");
  });

  it("shows Disqus's comments from its code or Site settings, by the page's address", async () => {
    const { disqusLoader } = await import("../site/blocks/installed/comments/block.js");
    const code = `<div id="disqus_thread"></div><script>(function() { var d = document, s = d.createElement('script');
      s.src = 'https://stjoseph.disqus.com/embed.js'; (d.head || d.body).appendChild(s); })();</script>`;
    expect(await render("comments", { code })).toContain(
      '<div id="disqus_thread" class="gf-comments-frame w-full"></div>',
    );
    const kept = siteSettingsSchema.parse({
      ...base,
      url: "https://stjoseph.example/",
      comments: { disqus: "stjoseph" },
    });
    expect(await render("comments", {}, kept)).toContain('id="disqus_thread"');
    // A site that asks holds the script that loads Disqus until the visitor agrees.
    const held = await render(
      "comments",
      {},
      { ...kept, consent: siteSettingsSchema.parse({ ...base, consent: {} }).consent },
    );
    expect(held).toContain(
      `<template data-gf-consent-code="body"><script>${disqusLoader({
        script: "https://stjoseph.disqus.com/embed.js",
        identifier: "/news/fair",
        url: "https://stjoseph.example/news/fair",
      })}</script></template>`,
    );
    expect(held).toContain("This comes from disqus.com");
    expect(held.replace(/<template[\s\S]*?<\/template>/g, "")).not.toContain("embed.js");
    // Nothing in the page's address can end the script.
    expect(disqusLoader({ script: "https://a.disqus.com/embed.js", identifier: "/</script>" })).not.toContain("</");
    expect(disqusLoader({ script: "https://a.disqus.com/embed.js" })).toContain(
      "this.page.identifier=location.pathname",
    );
  });

  it("offers Giscus's reactions and box for writing only for Giscus's comments", async () => {
    const block = (await import("../site/blocks/installed/comments/block.js")).default as ComponentConfig;
    const fields = async (code: string, comments?: unknown) =>
      Object.keys(
        (await block.resolveFields?.(
          { props: { ...block.defaultProps, code } } as never,
          {
            fields: block.fields,
            metadata: { site: siteSettingsSchema.parse({ ...base, ...(comments ? { comments } : {}) }) },
          } as never,
        )) ?? {},
      );
    const giscus = `<script src="https://giscus.app/client.js" data-repo="stjoseph/website" data-repo-id="R_kgDOabc123"
      data-category="Comments" data-category-id="DIC_kwDOabc123"></script>`;
    expect(await fields(giscus)).toEqual(["heading", "code", "reactions", "input", "className"]);
    expect(await fields("", { disqus: "stjoseph" })).toEqual(["heading", "code", "className"]);
    expect(await fields("https://comments.example.org")).toEqual(["heading", "code", "className"]);
    // Code for another service wins over Site settings' Giscus.
    const kept = {
      repo: "stjoseph/comments",
      repoId: "R_kgDOdef456",
      category: "Announcements",
      categoryId: "DIC_kw1",
    };
    expect(await fields("", kept)).toContain("reactions");
    expect(await fields("stjoseph", kept)).not.toContain("reactions");
  });

  it("shows Garrul's comments from the owner's own Worker, named by the page's address", async () => {
    const code = `<div id="garrul" data-slug="my-post-slug" data-api="https://comments.example.org"></div>
<script src="https://comments.example.org/embed.js" defer></script>`;
    const shown = await render("comments", { code });
    expect(shown).toContain(
      '<div id="garrul" class="gf-comments-frame w-full" data-api="https://comments.example.org" data-slug="/news/fair" data-lang="en" data-theme="light"></div>',
    );
    const kept = siteSettingsSchema.parse({
      ...base,
      url: "https://stjoseph.example/",
      comments: { garrul: "https://comments.example.org" },
    });
    expect(await render("comments", {}, kept)).toContain('data-url="https://stjoseph.example/news/fair"');
    const held = await render(
      "comments",
      {},
      {
        ...kept,
        consent: siteSettingsSchema.parse({ ...base, consent: {} }).consent,
      },
    );
    expect(held).toContain(
      '<template data-gf-consent-code="body"><script src="https://comments.example.org/embed.js" async></script></template>',
    );
    expect(held).toContain("This comes from comments.example.org");
  });
});
