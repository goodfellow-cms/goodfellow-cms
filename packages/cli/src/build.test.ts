import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  cloudflareSiteHeaders,
  startsWithGuard,
  vercelAdminRedirects,
  vercelHeaders,
  withAdminConfig,
} from "@goodfellow-cms/core";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build, islandsSummary, reactFromEnv } from "./build.js";

const fixture = resolve(import.meta.dirname, "../test/fixtures/site");
const starter = resolve(import.meta.dirname, "../../../templates/starter");
const parish = resolve(import.meta.dirname, "../../../examples/parish");
const docs = resolve(import.meta.dirname, "../../../docs");

describe("build", () => {
  let outDir: string;
  let pages: string[];
  let nextChange: Awaited<ReturnType<typeof build>>["nextChange"];
  let islands: Awaited<ReturnType<typeof build>>["islands"];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "goodfellow-build-"));
    ({ pages, nextChange, islands } = await build({ root: fixture, outDir }));
  }, 60_000);

  afterAll(() => rm(outDir, { recursive: true, force: true }));

  const read = (file: string) => readFile(join(outDir, file), "utf8");

  it("writes one HTML file per page, with clean URLs", () => {
    expect(pages).toHaveLength(5);
    expect(existsSync(join(outDir, "index.html"))).toBe(true);
    expect(existsSync(join(outDir, "news/index.html"))).toBe(true);
    expect(existsSync(join(outDir, "404.html"))).toBe(true);
  });

  it("leaves out pages and items their schedules don't show yet, or any more, and says what's next", () => {
    expect(existsSync(join(outDir, "advent/index.html"))).toBe(false);
    expect(existsSync(join(outDir, "talks/old/index.html"))).toBe(false);
    expect(nextChange).toMatchObject({ kind: "show", time: "2099-11-29T09:00", path: "/advent" });
  });

  it("describes the site's blocks for tools that edit its content, such as the Claude connector", async () => {
    const description = JSON.parse(await read("goodfellow-site.json"));
    expect(description).toMatchObject({ version: 1, content: { page: 1 } });
    expect(Object.keys(description.blocks).length).toBeGreaterThan(0);
    for (const [name, block] of Object.entries(description.blocks) as Array<[string, { fields: object }]>) {
      // A Synced block's synced block's blocks have their own Style, so it has none.
      if (name !== "SyncedBlock") expect(block.fields, name).toHaveProperty("className");
    }
  });

  it("renders blocks defined in the site's TSX config", async () => {
    const html = await read("index.html");
    expect(html).toContain('<p class="greeting text-teal-600">Hello, <!-- -->world<!-- -->!</p>');
    expect(html).toContain('<div class="bg-rose-200">');
  });

  it("builds a page for each entry in a collection, from its template", async () => {
    const html = await read("talks/hope/index.html");
    expect(html).toContain("<title>On hope</title>");
    expect(html).toContain("Hello, <!-- -->Fr. Smith<!-- -->!");
  });

  it("applies the config's base path to every root-relative URL", async () => {
    const html = await read("index.html");
    expect(html).toMatch(/<link rel="stylesheet" href="\/from-config\/assets\/styles-[\w-]+\.css"\/>/);
    expect(html).toContain('href="/from-config/news"');
  });

  it("builds CSS that includes classes from the content and config, plus custom CSS", async () => {
    const [cssFile] = (await readdir(join(outDir, "assets"))).filter((file) => file.endsWith(".css"));
    const css = await read(`assets/${cssFile}`);
    expect(css).toContain(".bg-rose-200");
    expect(css).toContain(".text-teal-600");
    expect(css).toContain(".custom-rule");
    // Theme colors resolve to the CSS variables written from site.json (Tailwind may group the
    // selector with others that share the rule, such as `bg-primary/40`'s fallback).
    expect(css).toMatch(/\.bg-primary(,[^{]+)?\{background-color:var\(--primary\)\}/);
  });

  it("runs Client Components in the browser, only on pages that use them", async () => {
    // With React, since the counter doesn't say it works with Preact.
    expect(islands).toEqual({ runtime: "react", because: "components", needReact: ["blocks/counter.tsx"] });
    const news = await read("news/index.html");
    expect(news).toMatch(
      /<gf-island data-gf-island="blocks\/counter.tsx" data-gf-export="Counter" [^>]*><div class="counter"><button type="button">Clicked!<!-- --> <!-- -->0<!-- --> times on <!-- -->\/news<\/button><gf-slot data-gf-slot="[\w-]+\.0" style="display:contents"><p>From the server<\/p><\/gf-slot><a href="\/from-config\/news">News<\/a><\/div><\/gf-island>/,
    );
    expect(news).toContain('"base":"/from-config/"');
    const script = news.match(
      /<script type="module" src="\/from-config\/(assets\/islands-[\w-]+\.js)"><\/script>/,
    )?.[1];
    expect(script).toBeDefined();
    const entry = await read(script ?? "");
    expect(entry).toContain('"blocks/counter.tsx"');
    // Only Client Components that server-rendered blocks use are islands, not those they use themselves.
    expect(entry).not.toContain("blocks/shout.tsx");
    // The component is a chunk of its own, loaded only by pages that use it.
    expect(entry).not.toContain("times on");
    // React's production build, not its development build.
    expect(entry).not.toContain("Hydration failed because");

    for (const file of ["index.html", "404.html", "talks/hope/index.html"]) {
      // Structured data for search engines is a script element, but not JavaScript.
      expect(await read(file), file).not.toMatch(/<script(?! type="application\/ld\+json")/);
    }
  });

  it("leaves out the admin panel, and a demo's copy of the content, without a backend or demo", () => {
    expect(existsSync(join(outDir, "admin"))).toBe(false);
  });

  it("writes a page at each old address that sends visitors on, where no page is", async () => {
    const html = await read("old-news/index.html");
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/from-config/news">');
    expect(html).toContain('<link rel="canonical" href="https://example.org/site/news">');
    expect(await read("2019/talk.html")).toContain('content="0; url=https://talks.example.org/hope"');
    // The page at /news wins over the redirect from it.
    expect(await read("news/index.html")).not.toContain("http-equiv");
    expect(pages).not.toContain("old-news/index.html");
    expect(await read("sitemap.xml")).not.toContain("old-news");
  });

  it("lists the same redirects for Cloudflare Pages, which sends them itself", async () => {
    // Each old address without and with a trailing slash, with the base path, and none from /news, a page's.
    expect(await read("_redirects")).toBe(
      [
        "/from-config/old-news /from-config/news 301",
        "/from-config/old-news/ /from-config/news 301",
        "/from-config/2019/talk.html https://talks.example.org/hope 301",
        "",
      ].join("\n"),
    );
  });

  it("writes Cloudflare Pages' header rules, sandboxing the media library's SVGs", async () => {
    expect(await read("_headers")).toBe(cloudflareSiteHeaders("/from-config/"));
  });

  it("copies the public folder", async () => {
    expect(await read("media/note.txt")).toBe("hello\n");
  });

  it("writes a sitemap and robots.txt when the site's address is set", async () => {
    const sitemap = await read("sitemap.xml");
    expect(sitemap).toContain("<loc>https://example.org/site/</loc>");
    expect(sitemap).toContain("<loc>https://example.org/site/news</loc>");
    expect(sitemap).toContain("<loc>https://example.org/site/talks/hope</loc>");
    expect(sitemap).not.toContain("404");
    // Pages hidden from search engines are built, but not in the sitemap.
    expect(sitemap).not.toContain("private");
    expect(await read("private/index.html")).toContain('<meta name="robots" content="noindex"/>');
    expect(await read("robots.txt")).toContain("Sitemap: https://example.org/site/sitemap.xml");
  });

  it("writes feeds of dated collections, and tells search engines about the site and its items", async () => {
    expect(await read("feeds/talks.rss")).toContain("<link>https://example.org/site/talks/hope</link>");
    expect(await read("feeds/talks.atom")).toContain("<published>2026-03-01T00:00:00.000Z</published>");
    const home = await read("index.html");
    expect(home).toContain(
      '<link rel="alternate" type="application/rss+xml" title="Talks – Fixture" href="/from-config/feeds/talks.rss"/>',
    );
    expect(home).toContain('"@type":"WebSite"');
    expect(await read("talks/hope/index.html")).toContain('"@type":"Article","inLanguage":"en","headline":"On hope"');
  });

  it("writes the content API: each page as it's shown, the site, and a manifest of them", async () => {
    const manifest = JSON.parse(await read("api/manifest.json"));
    expect(manifest.base).toBe("/from-config/");
    expect(manifest.pages.map((page: { path: string }) => page.path)).toContain("/talks/hope");
    const talk = JSON.parse(await read("api/pages/talks/hope.json"));
    expect(talk).toMatchObject({ path: "/talks/hope", entry: { collection: "talks", slug: "hope" } });
    // Addresses are from the site's root, without the base path, which the manifest gives.
    expect(await read("api/site.json")).not.toContain("/from-config/");
    expect(JSON.parse(await read("api/site.json")).settings.title).toBe("Fixture");
  });

  it("builds the starter template", async () => {
    const starterOut = await mkdtemp(join(tmpdir(), "goodfellow-starter-"));
    try {
      const result = await build({ root: starter, outDir: starterOut, base: "/" });
      // Four pages, plus a page for each of the two news stories.
      expect(result.pages).toHaveLength(6);
      // New sites start without anything for the site checks to point out.
      expect(result.problems).toEqual([]);
      const html = await readFile(join(starterOut, "about/index.html"), "utf8");
      expect(html).toContain("<title>About us | My site</title>");
      expect(html).toContain('<nav aria-label="main" class="gf-menu" data-gf-menu="">');
      const story = await readFile(join(starterOut, "news/welcome/index.html"), "utf8");
      expect(story).toContain("<title>Welcome to our new website | My site</title>");
    } finally {
      await rm(starterOut, { recursive: true, force: true });
    }
  }, 60_000);

  it("builds the parish example, with its own blocks and the site's contact details", async () => {
    const parishOut = await mkdtemp(join(tmpdir(), "goodfellow-parish-"));
    try {
      const result = await build({ root: parish, outDir: parishOut, base: "/" });
      // Ten pages and two in Spanish, plus five events, seven news stories and two bulletins, and the events and
      // four stories in Spanish. Staff have no pages of their own. The calendar has a page for each month, from
      // last month to a year ahead, and the news a second page and one for each of its four topics.
      expect(result.pages).toHaveLength(26 + 9 + 14 + 5);
      // Only some of its pages and items are in Spanish, as a real parish's might be, and the build says which aren't.
      expect(result.problems.filter((problem) => problem.kind !== "missing-translation")).toEqual([]);
      expect(result.problems).toContainEqual(
        expect.objectContaining({ kind: "missing-translation", file: "content/pages/about.json", language: "es" }),
      );
      const home = await readFile(join(parishOut, "index.html"), "utf8");
      expect(home).toContain("<title>St. Joseph Parish, Anytown</title>");
      expect(home).toContain("Weekend Masses");
      expect(home).toContain('href="tel:5550100100"');
      // The Spanish pages are in Spanish, with the site's name in it, and the header's Language switch.
      const spanish = await readFile(join(parishOut, "es/horarios-de-misa/index.html"), "utf8");
      expect(spanish).toContain('<html lang="es">');
      expect(spanish).toContain("<title>Horarios de misa | Parroquia de San José</title>");
      expect(spanish).toContain('aria-label="Languages"');
      expect(spanish).toMatch(/<a href="\/mass-times" hrefLang="en"[^>]*>English<\/a>/);
      // The footer has words of its own in Spanish, and the home page's lists show the Spanish items.
      expect(spanish).toContain("Una familia parroquial católica en Anytown.");
      const spanishHome = await readFile(join(parishOut, "es/index.html"), "utf8");
      expect(spanishHome).toContain("Misa de recuerdo");
      expect(spanishHome).not.toContain("Mass of Remembrance");
      expect(spanishHome).toContain('href="/es/eventos/');
      const bulletin = await readFile(join(parishOut, "bulletins/2026-10-04/index.html"), "utf8");
      expect(bulletin).toContain('href="/media/bulletin-example.pdf"');
      // The home page's news has a heading, and a link to the rest.
      expect(home).toMatch(/Parish news<\/h2><a href="\/news"[^>]*>All news/);
      const about = await readFile(join(parishOut, "about/index.html"), "utf8");
      // The staff are shown with Collection loop: each one's photo, name and role.
      expect(about.indexOf("Fr. Thomas Reed")).toBeLessThan(about.indexOf("Maria Chen"));
      expect(about).toContain("Parish office manager");
      expect(about).not.toContain("{title}");
      const news = await readFile(join(parishOut, "news/page/2/index.html"), "utf8");
      expect(news).toContain("<title>News: Page 2 | St. Joseph Parish</title>");
      expect(news).toContain('rel="prev"');
      expect(news).not.toContain("data-pagefind-body");
      const youth = await readFile(join(parishOut, "news/topics/youth/index.html"), "utf8");
      expect(youth).toContain("Teens spend a day serving the neighborhood");
      expect(youth).not.toContain("Bell tower repairs are finished");
      const { todayIn } = await import("@goodfellow-cms/core");
      // This month in the parish's time zone, as the build has it.
      const month = todayIn("America/New_York").slice(0, 7);
      const calendar = await readFile(join(parishOut, `calendar/${month}/index.html`), "utf8");
      expect(calendar).toContain('href="/calendar"');
      // Month pages aren't searched: the calendar's own page is.
      expect(calendar).not.toContain("data-pagefind-body");
      const feed = await readFile(join(parishOut, "calendars/events.ics"), "utf8");
      expect(feed).toContain("SUMMARY:Youth group");
      expect(feed).toContain("RRULE:FREQ=WEEKLY");
      expect(await readFile(join(parishOut, "calendars/events/fall-festival.ics"), "utf8")).toContain(
        "DTSTART;TZID=America/New_York:20261017T110000",
      );
    } finally {
      await rm(parishOut, { recursive: true, force: true });
    }
  }, 60_000);
});

describe.each([
  ["starter template", starter],
  ["parish example", parish],
  ["documentation site", docs],
])("%s", (_name, root) => {
  it("stores content files in the canonical format the admin panel writes", async () => {
    const { collectionFileSchema, parseMarkdownEntry, serializeContent, serializeMarkdownEntry } = await import(
      "@goodfellow-cms/core"
    );
    const contentDir = join(root, "content");
    const files = (await readdir(contentDir, { recursive: true })).map((file) => file.split("\\").join("/"));
    expect(files.filter((file) => file.endsWith(".json")).length).toBeGreaterThan(0);
    for (const file of files.filter((name) => name.endsWith(".json") || name.endsWith(".md"))) {
      const text = await readFile(join(contentDir, file), "utf8");
      if (file.endsWith(".json")) expect(text, file).toBe(serializeContent(JSON.parse(text)));
      if (file.endsWith(".md")) {
        const folder = file.slice(0, file.lastIndexOf("/"));
        const settings = collectionFileSchema.parse(
          JSON.parse(await readFile(join(contentDir, folder, "_collection.json"), "utf8")),
        );
        const { fields } = parseMarkdownEntry(text, settings.markdown?.body ?? "");
        expect(text, file).toBe(serializeMarkdownEntry(settings, fields as Record<string, unknown>));
      }
    }
  });
});

describe("the starter's vercel.ts", () => {
  it("has Vercel send the site's redirects, leaving out addresses pages and collections' items have", async () => {
    const site = await mkdtemp(join(tmpdir(), "goodfellow-vercel-"));
    try {
      await cp(join(fixture, "content"), join(site, "content"), { recursive: true });
      await copyFile(join(starter, "vercel.ts"), join(site, "vercel.ts"));
      // An item in Spanish, whose page is under the language's code.
      await writeFile(
        join(site, "content/collections/talks/esperanza.json"),
        JSON.stringify({ version: 1, inLanguage: "es", fields: { title: "Esperanza" } }),
      );
      await writeFile(
        join(site, "content/redirects.json"),
        JSON.stringify({
          version: 1,
          redirects: [
            { from: "/old-news", to: "/news" },
            { from: "/news", to: "/elsewhere" },
            { from: "/talks/hope", to: "/" },
            { from: "/es/talks/esperanza", to: "/" },
            { from: "/2019/talk(1).html", to: "https://talks.example.org/hope" },
          ],
        }),
      );
      // As Vercel runs it: from the site's folder, with Node's own modules only.
      const script = 'const { config } = await import("./vercel.ts"); console.log(JSON.stringify(config));';
      const config = JSON.parse(
        execFileSync(
          process.execPath,
          ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
          {
            cwd: site,
            encoding: "utf8",
          },
        ),
      );
      expect(config).toMatchObject({ buildCommand: "npx goodfellow build", outputDirectory: "dist" });
      expect(config.redirects).toEqual([
        { source: "/old-news", destination: "/news", permanent: true },
        { source: "/old-news/", destination: "/news", permanent: true },
        { source: "/2019/talk\\(1\\).html", destination: "https://talks.example.org/hope", permanent: true },
        { source: "/2019/talk\\(1\\).html/", destination: "https://talks.example.org/hope", permanent: true },
      ]);

      // A site without redirects has none.
      await rm(join(site, "content/redirects.json"));
      const empty = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
        {
          cwd: site,
          encoding: "utf8",
        },
      );
      expect(JSON.parse(empty).redirects).toEqual([]);
      expect(JSON.parse(empty).headers).toEqual(vercelHeaders());
      // A token broker frames the admin panel.
      await writeFile(
        join(site, "goodfellow.config.tsx"),
        'export default defineConfig({\n  broker: { url: "https://signin.example.org" },\n  blocks,\n});\n',
      );
      const framed = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
        { cwd: site, encoding: "utf8" },
      );
      expect(JSON.parse(framed).headers).toEqual(vercelHeaders({ broker: "https://signin.example.org" }));

      // A site with an admin address sandboxes every page there but the admin panel's own, as core says.
      await writeFile(
        join(site, "goodfellow.config.tsx"),
        withAdminConfig("export default defineConfig({\n  blocks,\n});\n", { url: "https://admin.example.org" }) ?? "",
      );
      const headers = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
        { cwd: site, encoding: "utf8" },
      );
      expect(JSON.parse(headers).headers).toEqual(vercelHeaders({ admin: { url: "https://admin.example.org" } }));
      // Site pages opened at the admin address go to the Site address, as core says.
      expect(JSON.parse(headers).redirects).toEqual(
        vercelAdminRedirects({ url: "https://admin.example.org" }, "https://example.org/site"),
      );
      // Once it's checked, the admin panel opened at the Site address goes to the admin address.
      const checked = { url: "https://admin.example.org", checked: true };
      await writeFile(
        join(site, "goodfellow.config.tsx"),
        withAdminConfig("export default defineConfig({\n  blocks,\n});\n", checked) ?? "",
      );
      const moved = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
        { cwd: site, encoding: "utf8" },
      );
      expect(JSON.parse(moved).redirects).toEqual(vercelAdminRedirects(checked, "https://example.org/site"));
      expect(JSON.parse(moved).redirects).toHaveLength(3);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });
});

describe("a site with an admin address", () => {
  it("starts every page with the guard that keeps site pages off it, and writes Cloudflare Pages' header rules", async () => {
    // Inside the package, so the site's imports find its packages.
    const site = await mkdtemp(join(import.meta.dirname, "../test/.admin-"));
    const out = join(site, "dist");
    try {
      await cp(fixture, site, { recursive: true, filter: (path) => !path.includes("node_modules") });
      const configFile = join(site, "goodfellow.config.tsx");
      const config = withAdminConfig(await readFile(configFile, "utf8"), { url: "https://admin.example.org" });
      await writeFile(configFile, config ?? "");
      await writeFile(join(site, "public/media/logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
      await build({ root: site, outDir: out });

      for (const [path, kind] of [
        ["index.html", "html"],
        ["404.html", "html"],
        ["media/logo.svg", "svg"],
        ["sitemap.xml", "xml"],
      ] as const) {
        expect(startsWithGuard(await readFile(join(out, path), "utf8"), kind), path).toBe(true);
      }
      expect(await readFile(join(out, "index.html"), "utf8")).toContain('location.replace("https://example.org"');
      const rules = await readFile(join(out, "_headers"), "utf8");
      expect(rules).toContain("https://admin.example.org/from-config/admin/*\n  ! Content-Security-Policy");
      // Every site's rules first, without the admin panel's, which the admin address's cover there.
      expect(
        rules.startsWith(cloudflareSiteHeaders("/from-config/", { admin: { url: "https://admin.example.org" } })),
      ).toBe(true);
      expect(JSON.parse(await readFile(join(out, "goodfellow-site.json"), "utf8")).admin).toEqual({
        url: "https://admin.example.org",
      });
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });
});

describe("a site whose Client Components all work with Preact", () => {
  it("runs them with Preact, in the browser and where its pages are built, unless the config says React", async () => {
    const site = await mkdtemp(join(import.meta.dirname, "../test/.preact-"));
    try {
      await cp(fixture, site, { recursive: true, filter: (path) => !path.includes("node_modules") });
      const counter = join(site, "blocks/counter.tsx");
      await writeFile(counter, `${await readFile(counter, "utf8")}\nexport const worksWithPreact = true;\n`);
      const result = await build({ root: site, outDir: join(site, "dist") });
      expect(result.islands).toEqual({ runtime: "preact" });
      // React for one build, to find out whether a problem is Preact's: by the option `--react` sets, or the variable.
      expect((await build({ root: site, outDir: join(site, "dist"), react: true })).islands).toEqual({
        runtime: "react",
        because: "option",
        needReact: [],
      });
      process.env.GOODFELLOW_REACT = "1";
      try {
        expect((await build({ root: site, outDir: join(site, "dist") })).islands).toMatchObject({
          because: "variable",
        });
      } finally {
        delete process.env.GOODFELLOW_REACT;
      }
      const preactAgain = await build({ root: site, outDir: join(site, "dist") });
      expect(preactAgain.islands).toEqual({ runtime: "preact" });

      const news = await readFile(join(site, "dist/news/index.html"), "utf8");
      // Rendered by Preact as React would render it, with the content passed to it in its slot.
      expect(news).toMatch(
        /<gf-island data-gf-island="blocks\/counter.tsx" data-gf-export="Counter" [^>]*><div class="counter"><button type="button">Clicked! 0 times on \/news<\/button><gf-slot data-gf-slot="[\w-]+\.0" style="display:contents"><p>From the server<\/p><\/gf-slot><a href="\/from-config\/news">News<\/a><\/div><\/gf-island>/,
      );
      const script = news.match(
        /<script type="module" src="\/from-config\/(assets\/islands-[\w-]+\.js)"><\/script>/,
      )?.[1];
      const assets = join(site, "dist/assets");
      const code = (
        await Promise.all((await readdir(assets)).map((file) => readFile(join(assets, file), "utf8")))
      ).join("\n");
      expect(script).toBeDefined();
      // No React in the browser: Preact, which is a tenth of its size.
      expect(code).not.toContain("react.production");
      expect(code).not.toContain("__REACT_DEVTOOLS_GLOBAL_HOOK__");
      // The bundle it was rendered from isn't left in the site.
      expect(existsSync(join(site, "node_modules/.goodfellow/preact-islands"))).toBe(false);

      const configFile = join(site, "goodfellow.config.tsx");
      await writeFile(
        configFile,
        (await readFile(configFile, "utf8")).replace("defineConfig({", "defineConfig({\n  preact: false,"),
      );
      const react = await build({ root: site, outDir: join(site, "dist") });
      expect(react.islands).toEqual({ runtime: "react", because: "config", needReact: [] });
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("a site without the content API", () => {
  it("leaves it out of the build", async () => {
    const site = await mkdtemp(join(import.meta.dirname, "../test/.no-api-"));
    try {
      await cp(fixture, site, { recursive: true, filter: (path) => !path.includes("node_modules") });
      const configFile = join(site, "goodfellow.config.tsx");
      await writeFile(
        configFile,
        (await readFile(configFile, "utf8")).replace("defineConfig({", "defineConfig({\n  api: false,"),
      );
      const result = await build({ root: site, outDir: join(site, "dist") });
      expect(result.apiPages).toBeUndefined();
      expect(existsSync(join(site, "dist/api"))).toBe(false);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });
});

describe("a site with photos", () => {
  it("writes smaller copies of them, which pages list in srcset", async () => {
    const site = await mkdtemp(join(import.meta.dirname, "../test/.images-"));
    const out = join(site, "dist");
    try {
      await cp(fixture, site, { recursive: true, filter: (path) => !path.includes("node_modules") });
      await mkdir(join(site, "public/media"), { recursive: true });
      const photo = await sharp({ create: { width: 1300, height: 600, channels: 3, background: "#336699" } })
        .jpeg()
        .toBuffer();
      await writeFile(join(site, "public/media/hall.jpg"), photo);
      await writeFile(
        join(site, "content/pages/hall.json"),
        `${JSON.stringify({
          version: 1,
          data: {
            content: [{ type: "Image", props: { id: "Image-hall", src: "/media/hall.jpg", alt: "The parish hall" } }],
            root: { props: { title: "The hall" } },
          },
        })}\n`,
      );
      const result = await build({ root: site, outDir: out });
      expect(result.images).toEqual({ written: 3, failed: [] });

      const html = await readFile(join(out, "hall/index.html"), "utf8");
      expect(html).toContain(
        'srcSet="/from-config/media-sizes/480/hall.jpg.webp 480w, /from-config/media-sizes/800/hall.jpg.webp 800w, /from-config/media-sizes/1200/hall.jpg.webp 1200w, /from-config/media/hall.jpg 1300w"',
      );
      expect(html).toContain('width="1300"');
      const copy = await sharp(await readFile(join(out, "media-sizes/800/hall.jpg.webp"))).metadata();
      expect([copy.format, copy.width, copy.height]).toEqual(["webp", 800, 369]);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });
});

describe("a copy of the site, such as staging", () => {
  it("is built at its own address, out of search engines, without the main site's admin address", async () => {
    const site = await mkdtemp(join(import.meta.dirname, "../test/.copy-"));
    const out = join(site, "dist");
    try {
      await cp(fixture, site, { recursive: true, filter: (path) => !path.includes("node_modules") });
      const configFile = join(site, "goodfellow.config.tsx");
      const config = withAdminConfig(await readFile(configFile, "utf8"), {
        url: "https://admin.example.org",
        checked: true,
      });
      await writeFile(configFile, config ?? "");
      const settings = await readFile(join(site, "content/site.json"), "utf8");
      vi.stubEnv("GOODFELLOW_SITE_URL", "https://staging.example.org/site");
      vi.stubEnv("GOODFELLOW_NO_INDEX", "true");
      try {
        await build({ root: site, outDir: out });
      } finally {
        vi.unstubAllEnvs();
      }

      const html = await readFile(join(out, "news/index.html"), "utf8");
      expect(html).toContain('<link rel="canonical" href="https://staging.example.org/site/news"/>');
      expect(html).toContain('<meta name="robots" content="noindex"/>');
      expect(await readFile(join(out, "sitemap.xml"), "utf8")).not.toContain("<loc>");
      expect(await readFile(join(out, "robots.txt"), "utf8")).toContain("https://staging.example.org/site/sitemap.xml");
      // Its admin panel stays at its own address, so the main site's guards aren't there.
      expect(startsWithGuard(html, "html")).toBe(false);
      expect(JSON.parse(await readFile(join(out, "goodfellow-site.json"), "utf8")).admin).toBeUndefined();
      // And nothing of the copy's reaches content.
      expect(await readFile(join(site, "content/site.json"), "utf8")).toBe(settings);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });
});

describe("a site with a plugin", () => {
  it("builds the plugin's admin frame with its policy, and runs its build step held to what it declared", async () => {
    // Inside the package, so the site's imports find its packages.
    const site = await mkdtemp(join(import.meta.dirname, "../test/.plugin-"));
    const out = join(site, "dist");
    try {
      await cp(fixture, site, { recursive: true, filter: (path) => !path.includes("node_modules") });
      await mkdir(join(site, "plugins/hello"), { recursive: true });
      await writeFile(
        join(site, "plugins/hello/index.ts"),
        [
          'import { definePlugin } from "@goodfellow-cms/core";',
          "export const hello = definePlugin({",
          '  name: "goodfellow-plugin-hello",',
          '  title: "Hello",',
          '  permissions: { connect: ["https://api.example.com"], files: ["content/hello.json"], write: ["hello/"] },',
          '  admin: "./plugins/hello/admin.ts",',
          '  screens: [{ id: "settings", title: "Hello" }],',
          '  build: [{ id: "greet", module: "./plugins/hello/build.mjs", title: "Say hello" }],',
          "});",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(site, "plugins/hello/admin.ts"),
        [
          'import { definePluginAdmin } from "@goodfellow-cms/core";',
          "export default definePluginAdmin({",
          '  services: { greet: ([name]) => "Hello, " + String(name) + "!" },',
          '  screens: { settings: (element) => { (element as HTMLElement).textContent = "Hello"; } },',
          "});",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(site, "plugins/hello/build.mjs"),
        [
          'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
          "export default (context) => {",
          "  let config = 'read';",
          "  try { readFileSync(context.root + '/goodfellow.config.tsx'); } catch (error) { config = error.code; }",
          "  mkdirSync(context.outDir + '/hello', { recursive: true });",
          "  writeFileSync(context.outDir + '/hello/report.json', JSON.stringify({ config, base: context.base }));",
          "};",
          "",
        ].join("\n"),
      );
      const configFile = join(site, "goodfellow.config.tsx");
      const config = (await readFile(configFile, "utf8"))
        .replace(
          'import { Counter } from "./blocks/counter";',
          'import { Counter } from "./blocks/counter";\nimport { hello } from "./plugins/hello";',
        )
        .replace('base: "/from-config/",', 'base: "/from-config/",\n  demo: true,\n  plugins: [hello],');
      await writeFile(configFile, config);
      const result = await build({ root: site, outDir: out });

      const page = await readFile(join(out, "admin/plugins/goodfellow-plugin-hello/index.html"), "utf8");
      expect(page).toContain("connect-src https://api.example.com;");
      const script = /<script src="\/from-config\/(admin\/plugins\/goodfellow-plugin-hello\/[^"]+\.js)"/.exec(
        page,
      )?.[1];
      expect(script).toBeDefined();
      const code = await readFile(join(out, script ?? ""), "utf8");
      // The prelude first, which the minifier rewrites without changing what it does: nothing runs unsandboxed.
      expect(code.startsWith("(()=>{if(self.origin!==`null`)")).toBe(true);
      expect(code).toContain("Hello, ");
      // What it bundles, with where its source is, beside it.
      expect(page).toContain(
        '<link rel="license" href="/from-config/admin/plugins/goodfellow-plugin-hello/LICENSES.txt" />',
      );
      // Search engines are asked not to list any of the admin panel's pages.
      for (const file of [
        "admin/index.html",
        "admin/editor/index.html",
        "admin/plugins/goodfellow-plugin-hello/index.html",
      ]) {
        expect(await readFile(join(out, file), "utf8"), file).toContain('<meta name="robots" content="noindex" />');
      }
      const notices = await readFile(join(out, "admin/plugins/goodfellow-plugin-hello/LICENSES.txt"), "utf8");
      expect(notices).toMatch(
        /^- @goodfellow-cms\/core [\d.]+: MIT, source at https:\/\/github\.com\/goodfellow-cms\/goodfellow-cms\/tree\/HEAD\/packages\/core$/m,
      );
      expect(notices).toContain("MIT License");

      expect(result.pluginSteps).toEqual(["goodfellow-plugin-hello: Say hello"]);
      expect(JSON.parse(await readFile(join(out, "hello/report.json"), "utf8"))).toEqual({
        config: "ERR_ACCESS_DENIED",
        base: "/from-config/",
      });
      const description = JSON.parse(await readFile(join(out, "goodfellow-site.json"), "utf8"));
      expect(description.plugins).toMatchObject([
        { name: "goodfellow-plugin-hello", id: "goodfellow-plugin-hello", admin: true, screens: [{ id: "settings" }] },
      ]);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("documentation site", () => {
  it("builds, with a search index, and every link and heading link between its pages goes somewhere", async () => {
    const out = await mkdtemp(join(tmpdir(), "goodfellow-docs-"));
    try {
      const result = await build({ root: docs, outDir: out, base: "/" });
      expect(result.searchIndexed).toBe(result.pages.length - 1);
      expect(result.problems).toEqual([]);
      // Each page's address, from its file: docs/intro/index.html → /docs/intro.
      const pages = new Map<string, string>();
      const files = (await readdir(out, { recursive: true })).map((file) => file.split("\\").join("/"));
      for (const file of files.filter((name) => name.endsWith(".html") && !name.startsWith("admin/"))) {
        const path = `/${file.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "")}`;
        pages.set(path, await readFile(join(out, file), "utf8"));
      }
      const broken: string[] = [];
      for (const [from, html] of pages) {
        for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) {
          const [path = "", hash] = (href ?? "").split("#");
          const target = path.replace(/\/$/, "") || "/";
          if (target.startsWith("/assets/") || target.startsWith("/media/")) continue;
          // Files the build wrote, such as the site's copy of its fonts.
          if (files.includes(target.slice(1))) continue;
          const page = pages.get(target);
          if (!page) broken.push(`${from} → ${href}`);
          else if (hash && !page.includes(`id="${hash}"`)) broken.push(`${from} → ${href} (no such heading)`);
        }
      }
      expect(broken).toEqual([]);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 120_000);
});

describe.each([
  ["starter template", starter],
  ["parish example", parish],
  ["Next.js starter", resolve(import.meta.dirname, "../../../templates/next")],
])("%s", (_name, root) => {
  it("is ready for blocks from block registries", async () => {
    const { EMPTY_RECORD, installedIndex, REGISTRY_PACKAGES } = await import("@goodfellow-cms/core");
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { dependencies: object };
    // The admin panel can't add packages, so sites have every one the registry's blocks use.
    expect(Object.keys(pkg.dependencies)).toEqual(expect.arrayContaining([...REGISTRY_PACKAGES]));
    expect(await readFile(join(root, "blocks/installed/index.ts"), "utf8")).toBe(installedIndex(EMPTY_RECORD));
    expect(await readFile(join(root, "goodfellow.config.tsx"), "utf8")).toContain(
      'import { installedBlocks, installedCategories } from "./blocks/installed";',
    );
  });

  it("lists the plugins installed from the admin panel", async () => {
    const { configUsesInstalledPlugins, installedPluginsIndex, NO_INSTALLED_PLUGINS } = await import(
      "@goodfellow-cms/core"
    );
    expect(await readFile(join(root, "plugins/installed/index.ts"), "utf8")).toBe(
      installedPluginsIndex(NO_INSTALLED_PLUGINS),
    );
    expect(configUsesInstalledPlugins(await readFile(join(root, "goodfellow.config.tsx"), "utf8"))).toBe(true);
  });
});

describe("parish example", () => {
  it("has the same deploy setups as the starter", async () => {
    for (const file of [
      ".github/workflows/deploy.yml",
      ".github/workflows/scheduled.yml",
      ".gitlab-ci.yml",
      "vercel.ts",
      ".gitignore",
      ".npmrc",
      "src/styles.css",
      "components.json",
      "tsconfig.json",
      "blocks/installed/index.ts",
      "plugins/installed/index.ts",
    ]) {
      expect(await readFile(join(parish, file), "utf8"), file).toBe(await readFile(join(starter, file), "utf8"));
    }
  });
});

describe("islandsSummary and reactFromEnv", () => {
  it("say what runs Client Components, and why", () => {
    expect(islandsSummary({ runtime: "preact" })).toBe(
      "Client Components run with Preact, since every one says it works with it",
    );
    expect(islandsSummary({ runtime: "react", because: "option", needReact: [] })).toBe(
      "Client Components run with React, as --react says",
    );
    expect(islandsSummary({ runtime: "react", because: "variable", needReact: [] })).toBe(
      "Client Components run with React, as GOODFELLOW_REACT says",
    );
    expect(islandsSummary({ runtime: "react", because: "config", needReact: [] })).toBe(
      "Client Components run with React, as the config says (preact: false)",
    );
    expect(
      islandsSummary({ runtime: "react", because: "components", needReact: ["a.tsx", "b.tsx", "c.tsx", "d.tsx"] }),
    ).toBe(
      "Client Components run with React, since a.tsx, b.tsx, c.tsx and 1 more don't say they work with Preact (export const worksWithPreact = true)",
    );
  });

  it("read GOODFELLOW_REACT as on only for a yes", () => {
    for (const value of ["1", "true", "YES", " yes "]) expect(reactFromEnv({ GOODFELLOW_REACT: value })).toBe(true);
    for (const value of [undefined, "", "0", "false", "no"])
      expect(reactFromEnv({ GOODFELLOW_REACT: value })).toBe(false);
  });
});
