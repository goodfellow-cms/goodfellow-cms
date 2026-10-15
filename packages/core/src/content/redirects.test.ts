import { describe, expect, it } from "vitest";
import { ContentError } from "./errors.js";
import { loadSiteContent } from "./load.js";
import {
  findRedirect,
  redirectFiles,
  redirectFrom,
  redirectOutputFile,
  redirectProblems,
  redirectTarget,
  storedRedirects,
} from "./redirects.js";
import { siteSettingsSchema } from "./schemas.js";

const settings = siteSettingsSchema.parse({
  version: 1,
  title: "St. Joseph",
  url: "https://parish.example.org",
  language: "en",
});

function source(files: Record<string, string>) {
  return {
    read: async (path: string) => files[path],
    list: async (dir: string) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
  };
}

describe("redirectFrom", () => {
  it("spells old addresses one way, from paths or full addresses", () => {
    expect(redirectFrom(" /about-us/ ")).toEqual({ ok: true, path: "/about-us" });
    expect(redirectFrom("https://old.example.org/2019/05/picnic/")).toEqual({ ok: true, path: "/2019/05/picnic" });
    expect(redirectFrom("/%C3%BCber-uns")).toEqual({ ok: true, path: "/über-uns" });
    expect(redirectFrom("/News.html")).toEqual({ ok: true, path: "/News.html" });
  });

  it("refuses what a static site can't redirect", () => {
    expect(redirectFrom("")).toEqual({ ok: false, problem: "no-from" });
    expect(redirectFrom("/")).toEqual({ ok: false, problem: "home" });
    expect(redirectFrom("/index.php?page_id=5")).toEqual({ ok: false, problem: "query" });
    expect(redirectFrom("about")).toEqual({ ok: false, problem: "bad-from" });
    expect(redirectFrom("//old.example.org/a")).toEqual({ ok: false, problem: "bad-from" });
    expect(redirectFrom("/a/../b")).toEqual({ ok: false, problem: "bad-from" });
    expect(redirectFrom("/a b")).toEqual({ ok: false, problem: "bad-from" });
    expect(redirectFrom("/%E0%A4%A")).toEqual({ ok: false, problem: "bad-from" });
  });
});

describe("redirectTarget", () => {
  it("takes addresses on the site and other websites' only", () => {
    expect(redirectTarget(" /about#staff ")).toBe("/about#staff");
    expect(redirectTarget("https://example.org/new")).toBe("https://example.org/new");
    expect(redirectTarget("about")).toBeUndefined();
    expect(redirectTarget("//evil.example.org")).toBeUndefined();
    expect(redirectTarget("javascript:alert(1)")).toBeUndefined();
  });
});

describe("redirectProblems", () => {
  it("says what's wrong with each redirect", () => {
    expect(
      redirectProblems([
        { from: "/about-us", to: "/about" },
        { from: "/about-us/", to: "/contact" },
        { from: "/admin/old", to: "/" },
        { from: "/media/old.jpg", to: "/" },
        { from: "/loop", to: "/loop/?x=1" },
        { from: "/nowhere", to: "" },
        { from: "/bad", to: "mailto:office@example.org" },
      ]),
    ).toEqual([undefined, "duplicate", "reserved", "reserved", "loop", "no-to", "bad-to"]);
  });

  it("stores them spelled one way", () => {
    expect(storedRedirects([{ from: " https://old.example.org/about-us/ ", to: " /about " }])).toEqual([
      { from: "/about-us", to: "/about" },
    ]);
  });
});

describe("redirectFiles", () => {
  const content = {
    settings,
    redirects: [
      { from: "/about-us", to: "/about" },
      { from: "/news.html", to: "https://news.example.org/" },
      { from: "/about", to: "/elsewhere" },
      { from: "/broken", to: "nowhere" },
    ],
  };

  it("shows the site's dark colors on a computer set to dark, only where the site has dark mode", () => {
    const [light] = redirectFiles(content, { taken: [] }).map((file) => file.content);
    expect(light).not.toContain("color-scheme");
    const dark = redirectFiles(
      { ...content, settings: { ...settings, theme: { ...settings.theme, darkMode: true } } },
      { taken: [] },
    )[0]?.content;
    expect(dark).toContain('<meta name="color-scheme" content="light dark">');
    expect(dark).toContain(
      "@media (prefers-color-scheme: dark){body{color:#fafafa!important;background:#0a0a0a!important}",
    );
  });

  it("writes a page at each old address that sends visitors on, leaving out ones a page has", () => {
    const files = redirectFiles(content, { taken: ["/", "/about"] });
    expect(files.map((file) => file.path)).toEqual(["/about-us/index.html", "/news.html"]);
    const [page, external] = files.map((file) => file.content);
    expect(page).toContain('<meta http-equiv="refresh" content="0; url=/about">');
    expect(page).toContain('<link rel="canonical" href="https://parish.example.org/about">');
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(page).toContain('<html lang="en">');
    // Replaces itself in the browser's history, so Back skips it, keeping what's after # of the old address.
    expect(page).toContain('<script>location.replace("/about" + location.hash);</script>');
    expect(page).toContain('This page has moved to <a href="/about" style="color:#171717">/about</a>.');
    expect(external).toContain('<link rel="canonical" href="https://news.example.org/">');
  });

  it("names the page it goes to, in the site's own words and colors", () => {
    const [file] = redirectFiles({
      ...content,
      settings: { ...settings, theme: { ...settings.theme, colors: { primary: "#153823", background: "#f5ece2" } } },
      redirectMessage: "Diese Seite ist umgezogen: {page}",
      pages: [
        {
          path: "/about",
          file: "content/pages/about.json",
          content: { version: 1, data: { root: { props: { title: "Über uns" } }, content: [] } },
        },
      ],
    });
    expect(file?.content).toContain('Diese Seite ist umgezogen: <a href="/about" style="color:#153823">Über uns</a>');
    expect(file?.content).toContain("background:#f5ece2");
    expect(file?.content).toContain('<p style="margin:0 0 .5rem;font-weight:600">St. Joseph</p>');
  });

  it("adds the base path to addresses on the site", () => {
    const [file] = redirectFiles(content, { taken: ["/about"], base: "/parish/" });
    expect(file?.content).toContain('content="0; url=/parish/about"');
    expect(file?.content).toContain('href="https://parish.example.org/about"');
  });

  it("escapes what it writes into the page", () => {
    const [file] = redirectFiles({
      settings,
      redirects: [{ from: "/a", to: '/b"></script><script>alert(1)' }],
      redirectMessage: "<b>{page}</b>",
    });
    expect(file?.content).toContain("/b&quot;&gt;&lt;/script&gt;&lt;script&gt;alert(1)");
    expect(file?.content).toContain('location.replace("/b\\">\\u003c/script>\\u003cscript>alert(1)"');
    expect(file?.content).toContain("&lt;b&gt;<a ");
    expect(file?.content?.match(/<script>/g)).toHaveLength(1);
  });

  it("finds the redirect for an address", () => {
    expect(findRedirect(content, "/about-us/")).toEqual({ from: "/about-us", to: "/about" });
    expect(findRedirect(content, "/broken")).toBeUndefined();
    expect(findRedirect(content, "/missing")).toBeUndefined();
  });

  it("names the old address's file", () => {
    expect(redirectOutputFile("/2019/05/picnic")).toBe("2019/05/picnic/index.html");
    expect(redirectOutputFile("/news.HTM")).toBe("news.HTM");
  });
});

describe("loading redirects", () => {
  it("loads content/redirects.json, and reports redirects that can't work", async () => {
    const files = {
      "content/redirects.json": '{\n  "version": 1,\n  "redirects": [{ "from": "/old", "to": "/new" }]\n}\n',
    };
    expect((await loadSiteContent(source(files))).redirects).toEqual([{ from: "/old", to: "/new" }]);
    expect((await loadSiteContent(source({}))).redirects).toEqual([]);

    const bad = { "content/redirects.json": '{ "version": 1, "redirects": [{ "from": "/", "to": "/new" }] }' };
    const error = await loadSiteContent(source(bad)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContentError);
    expect((error as ContentError).problems).toEqual([
      {
        file: "content/redirects.json",
        message: 'has a redirect from "/" to "/new" that is from the home page, which can\'t be redirected.',
      },
    ]);
  });
});
