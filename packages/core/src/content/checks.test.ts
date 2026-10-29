import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "../contrast.js";
import { checkSite, contrastProblems, publishProblems, type SiteProblem } from "./checks.js";
import { linkTarget } from "./links.js";
import { type ContentSource, loadSiteContent } from "./load.js";
import { withPages } from "./site-pages.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const page = (title: string, content: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  version: 1,
  data: { root: { props: { title, description: `About ${title}`, ...extra } }, content },
});
const block = (type: string, id: string, props: Record<string, unknown> = {}) => ({ type, props: { id, ...props } });

const blocks = {
  Button: { fields: { href: { type: "text" }, label: { type: "text" } }, render: () => null },
  Image: { fields: { src: { type: "text" }, alt: { type: "text" } }, render: () => null },
  Text: { fields: { text: { type: "richtext" } }, render: () => null },
  Code: { fields: { code: { type: "textarea" } }, render: () => null },
  Cards: {
    fields: { cards: { type: "array", arrayFields: { link: { type: "text" }, title: { type: "text" } } } },
    render: () => null,
  },
  Section: { fields: { content: { type: "slot" } }, render: () => null },
  Pages: withPages({ fields: {}, render: () => null }, () => [{ suffix: "page/2", title: "Page 2" }]),
} as unknown as Record<string, ComponentConfig>;

const site = (files: Record<string, unknown>) =>
  loadSiteContent(
    memorySource({
      "content/site.json": { version: 1, title: "Parish", description: "A parish", url: "https://parish.example/" },
      "content/pages/index.json": page("Home"),
      ...files,
    }),
  );

const errors = (problems: SiteProblem[]) =>
  problems.filter((problem) => problem.severity === "error").map(({ kind, file, target }) => [kind, file, target]);

describe("site checks", () => {
  it("finds links to pages and media that don't exist, wherever they are", async () => {
    const content = await site({
      "content/pages/about.json": page("About", [
        block("Button", "Button-1", { href: "/visit#times", label: "Visit" }),
        block("Button", "Button-2", { href: "/missing?from=about", label: "Gone" }),
        block("Image", "Image-1", { src: "/media/gone.jpg", alt: "" }),
        block("Text", "Text-1", { text: '<p><a href="/also-missing">x</a> <img src="/media/photo.jpg"></p>' }),
        // Code that looks like an address isn't a link.
        block("Code", "Code-1", { code: "/etc/hosts" }),
        block("Section", "Section-1", {
          content: [block("Cards", "Cards-1", { cards: [{ link: "/deep-missing", title: "Deep" }] })],
        }),
        block("Button", "Button-3", { href: "https://example.org/missing", label: "Elsewhere" }),
        block("Button", "Button-4", { href: "/favicon.ico", label: "A file" }),
        block("Button", "Button-5", { href: "/admin/", label: "Admin" }),
      ]),
      "content/pages/visit.json": page("Visit"),
      "content/menus.json": {
        version: 1,
        menus: { main: [{ label: "Old", href: "/old", children: [{ label: "Kids", href: "/kids/" }] }] },
      },
      "content/redirects.json": { version: 1, redirects: [{ from: "/old", to: "/nowhere" }] },
    });
    const problems = checkSite(content, { media: ["/media/photo.jpg"], blocks, today: "2026-10-20" });
    expect(errors(problems)).toEqual([
      ["missing-page", "content/pages/about.json", "/missing"],
      ["missing-media", "content/pages/about.json", "/media/gone.jpg"],
      ["missing-page", "content/pages/about.json", "/also-missing"],
      ["missing-page", "content/pages/about.json", "/deep-missing"],
      // The menu's link to /old goes through its redirect.
      ["missing-page", "content/menus.json", "/kids"],
      ["missing-page", "content/redirects.json", "/nowhere"],
    ]);
  });

  it("knows the pages blocks add, items' pages, and links in items and settings", async () => {
    const content = await site({
      "content/pages/news.json": page("News", [block("Pages", "Pages-1")]),
      "content/pages/index.json": page("Home", [block("Button", "Button-1", { href: "/news/page/2" })]),
      "content/collections/talks/_collection.json": {
        version: 1,
        name: "Talks",
        entryName: "Talk",
        path: "/talks/{slug}",
        markdown: { body: "body" },
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "video", label: "Video", type: "link" },
          { name: "photo", label: "Photo", type: "image" },
          { name: "body", label: "Body", type: "richtext" },
        ],
        template: { root: { props: {} }, content: [block("Button", "Button-1", { href: "/talks/{slug}" })] },
      },
      "content/collections/talks/advent.md":
        "---\nversion: 1\ntitle: Advent\nvideo: /talks/lent\nphoto: /media/none.jpg\n---\nSee [the news](/news) and [nothing](/nothing).\n",
      "content/collections/talks/lent.md": "---\nversion: 1\ntitle: Lent\n---\nLent.\n",
      "content/site.json": {
        version: 1,
        title: "Parish",
        description: "A parish",
        logo: { src: "/media/logo.svg" },
        consent: { policy: "/privacy" },
      },
    });
    const problems = checkSite(content, { media: [], blocks, today: "2026-10-20" });
    expect(errors(problems)).toEqual([
      ["missing-media", "content/collections/talks/advent.md", "/media/none.jpg"],
      ["missing-page", "content/collections/talks/advent.md", "/nothing"],
      ["missing-media", "content/site.json", "/media/logo.svg"],
      ["missing-page", "content/site.json", "/privacy"],
    ]);
  });

  it("refuses links that would run code, in menus, blocks, items and settings, however they're spelled", async () => {
    const content = await site({
      "content/menus.json": {
        version: 1,
        menus: {
          main: [
            { label: "Home", href: "/" },
            { label: "Run", href: " JavaScript:alert(1)" },
          ],
        },
      },
      "content/pages/about.json": page("About", [
        block("Button", "Button-1", { href: "java\tscript:alert(1)", label: "Run" }),
        block("Button", "Button-2", { href: "data:text/html,<script>alert(1)</script>", label: "Data" }),
        // Words, not a link, and a link to a calendar app, which is fine.
        block("Button", "Button-3", { href: "webcal://parish.example/calendars/mass.ics", label: "Data: 2026" }),
        block("Text", "Text-1", { text: '<p><a href="vbscript:msgbox(1)">x</a></p>' }),
      ]),
      "content/collections/talks/_collection.json": {
        version: 1,
        name: "Talks",
        entryName: "Talk",
        path: "/talks/{slug}",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "video", label: "Video", type: "link" },
        ],
      },
      "content/collections/talks/advent.json": {
        version: 1,
        fields: { title: "Advent", video: "blob:https://parish.example/1" },
      },
    });
    const problems = checkSite(content, { media: [], blocks });
    expect(errors(problems)).toEqual([
      ["unsafe-link", "content/pages/about.json", "java\tscript:alert(1)"],
      ["unsafe-link", "content/pages/about.json", "data:text/html,<script>alert(1)</script>"],
      ["unsafe-link", "content/pages/about.json", "vbscript:msgbox(1)"],
      ["unsafe-link", "content/collections/talks/advent.json", "blob:https://parish.example/1"],
      ["unsafe-link", "content/menus.json", " JavaScript:alert(1)"],
    ]);
  });

  it("warns about pages without a title or description", async () => {
    const content = await site({
      "content/site.json": { version: 1, title: "Parish" },
      "content/pages/index.json": { version: 1, data: { root: { props: { title: "" } }, content: [] } },
      "content/pages/untitled.json": { version: 1, data: { root: { props: { title: " " } }, content: [] } },
      "content/pages/404.json": { version: 1, data: { root: { props: {} }, content: [] } },
    });
    const warnings = checkSite(content, { media: [] }).map(({ kind, file }) => [kind, file]);
    expect(warnings).toEqual([
      // The home page has the site's title.
      ["no-description", "content/pages/index.json"],
      ["no-title", "content/pages/untitled.json"],
      ["no-description", "content/pages/untitled.json"],
    ]);
  });

  it("stops publishes only for the errors they bring, and warns about the files they change", async () => {
    const before = await site({
      "content/pages/about.json": page("About", [block("Button", "Button-1", { href: "/visit" })]),
      "content/pages/visit.json": page("Visit"),
      "content/pages/old.json": page("Old", [block("Button", "Button-1", { href: "/already-broken" })]),
    });
    // Deleting /visit breaks the About page's link.
    const after = await site({
      "content/pages/about.json": page("About", [block("Button", "Button-1", { href: "/visit" })]),
      "content/pages/old.json": page("Old", [block("Button", "Button-1", { href: "/already-broken" })], {
        description: "",
      }),
    });
    const options = { media: [], blocks };
    const { blocking, warnings } = publishProblems(checkSite(before, options), checkSite(after, options), [
      "content/pages/visit.json",
      "content/pages/old.json",
    ]);
    expect(errors(blocking)).toEqual([["missing-page", "content/pages/about.json", "/visit"]]);
    // The old page's broken link was there before, so it's mentioned, but doesn't stop the publish.
    expect(warnings.map(({ kind, file }) => [kind, file])).toEqual([["missing-page", "content/pages/old.json"]]);
  });

  it("reads addresses on the site, and leaves the rest alone", () => {
    expect(linkTarget("/about/")).toEqual({ kind: "page", path: "/about" });
    expect(linkTarget("/")).toEqual({ kind: "page", path: "/" });
    expect(linkTarget("/caf%C3%A9")).toEqual({ kind: "page", path: "/café" });
    expect(linkTarget("/media/a%20b.jpg")).toEqual({ kind: "media", path: "/media/a b.jpg" });
    for (const link of [
      "https://example.org",
      "//cdn.example.org/x",
      "#top",
      "mailto:a@example.org",
      "/feed.xml",
      "/calendars/events.ics",
      "/admin",
    ]) {
      expect(linkTarget(link), link).toBeUndefined();
    }
  });
});

describe("contrast", () => {
  it("reads the colors themes use", () => {
    expect(parseColor("#fff")).toEqual([1, 1, 1]);
    expect(parseColor("#000000")).toEqual([0, 0, 0]);
    expect(parseColor("rgb(255 0 0)")).toEqual([1, 0, 0]);
    expect(parseColor("rgba(0, 255, 0, 0.5)")).toEqual([0, 1, 0]);
    expect(parseColor("hsl(240 100% 50%)")?.map((channel) => Math.round(channel * 255))).toEqual([0, 0, 255]);
    expect(parseColor("oklch(1 0 0)")?.map((channel) => Math.round(channel * 255))).toEqual([255, 255, 255]);
    expect(parseColor("oklab(0 0 0)")).toEqual([0, 0, 0]);
    expect(parseColor("rebeccapurple")).toBeUndefined();
  });

  it("measures it as WCAG does", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777", "#fff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("blue", "#fff")).toBeUndefined();
  });

  it("warns about theme colors text is hard to read on, in dark mode too", () => {
    const theme = {
      colors: { primary: "#ffcc00", primaryForeground: "#ffffff" },
      darkMode: true,
      darkColors: { mutedForeground: "#333333" },
      fonts: {},
    };
    const problems = contrastProblems(theme as Parameters<typeof contrastProblems>[0]);
    expect(problems.map(({ kind, ...rest }) => rest)).toEqual([
      {
        severity: "warning",
        file: "content/site.json",
        text: "primaryForeground",
        background: "primary",
        ratio: 1.5,
        dark: false,
      },
      {
        severity: "warning",
        file: "content/site.json",
        text: "mutedForeground",
        background: "background",
        ratio: 1.5,
        dark: true,
      },
      {
        severity: "warning",
        file: "content/site.json",
        text: "mutedForeground",
        background: "muted",
        ratio: 1.1,
        dark: true,
      },
    ]);
    // The default colors are fine.
    expect(contrastProblems({ colors: {}, fonts: {} } as Parameters<typeof contrastProblems>[0])).toEqual([]);
    expect(
      contrastProblems({ colors: {}, darkMode: true, fonts: {} } as Parameters<typeof contrastProblems>[0]),
    ).toEqual([]);
  });
});
