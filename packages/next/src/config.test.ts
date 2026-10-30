import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vercelHeaders } from "@goodfellow-cms/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { redirectDestination, withGoodfellow } from "./config.js";
import { IMAGE_SIZES_ENV, IMAGE_SIZES_MARK } from "./image-sizes-mark.js";

describe("withGoodfellow", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-next-"));
    await mkdir(join(root, "content"), { recursive: true });
    await writeFile(join(root, "content/site.json"), '{"version":1}\n');
  });

  afterAll(() => rm(root, { recursive: true, force: true }));

  it("builds static files, keeping the site's own settings", async () => {
    const config = await withGoodfellow({ reactStrictMode: true }, { root })("phase-production-build");
    expect(config).toEqual({
      output: "export",
      trailingSlash: true,
      reactStrictMode: true,
      images: { unoptimized: true },
      env: { GOODFELLOW_BASE_PATH: "" },
      redirects: expect.any(Function),
    });
    expect(await withGoodfellow({ trailingSlash: false }, { root })("phase-production-build")).toMatchObject({
      trailingSlash: false,
    });
  });

  it("builds a full-stack site for its server, with the content its pages read", async () => {
    const config = await withGoodfellow({}, { root, server: true })("phase-production-build");
    expect(config).toEqual({
      trailingSlash: true,
      images: undefined,
      env: { GOODFELLOW_BASE_PATH: "" },
      outputFileTracingIncludes: { "/**": ["./content/**/*", "./public/media/**/*"] },
      redirects: expect.any(Function),
      headers: expect.any(Function),
    });
    expect(config).not.toHaveProperty("output");
    // Its server sends the site's header rules.
    expect(await (config as { headers: () => Promise<unknown> }).headers()).toEqual(vercelHeaders());
  });

  it("copies a full-stack site's fonts into public/ before its pages are rendered, and tells the renderer", async () => {
    const site = await mkdtemp(join(tmpdir(), "goodfellow-next-fonts-"));
    const css = "@font-face { src: url(https://fonts.gstatic.com/s/lora/v1/a.woff2) format('woff2'); }";
    vi.stubGlobal("fetch", async (url: string) =>
      url.startsWith("https://fonts.googleapis.com/") ? new Response(css) : new Response(new Uint8Array([1, 2, 3])),
    );
    try {
      await mkdir(join(site, "content"), { recursive: true });
      await writeFile(join(site, "content/site.json"), '{"version":1,"theme":{"fonts":{"body":"Lora"}}}\n');
      const config = await withGoodfellow({}, { root: site, server: true })("phase-production-build");
      const fonts = JSON.parse(config.env?.GOODFELLOW_FONTS ?? "{}");
      expect(fonts).toMatchObject({
        source: "https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&display=swap",
        fonts: [{ url: "https://fonts.gstatic.com/s/lora/v1/a.woff2", path: "fonts/google/s/lora/v1/a.woff2" }],
      });
      expect(existsSync(join(site, "public", fonts.stylesheet))).toBe(true);
      expect(existsSync(join(site, "public/fonts/google/s/lora/v1/a.woff2"))).toBe(true);
      // Starting the server copies nothing: the build wrote the fonts and where they are into its code.
      expect((await withGoodfellow({}, { root: site, server: true })("phase-production-server")).env).toEqual({
        GOODFELLOW_BASE_PATH: "",
      });
      // Static exports are left to `goodfellow-next finish`.
      expect((await withGoodfellow({}, { root: site })("phase-production-build")).env).toEqual({
        GOODFELLOW_BASE_PATH: "",
      });
    } finally {
      vi.unstubAllGlobals();
      await rm(site, { recursive: true, force: true });
    }
  });

  it("adds the site's header rules to a static export only where they're sent", async () => {
    const plain = await withGoodfellow({}, { root })("phase-production-build");
    expect(plain).not.toHaveProperty("headers");
    process.env.VERCEL = "1";
    try {
      const vercel = (await withGoodfellow({}, { root })("phase-production-build")) as {
        headers: () => Promise<unknown>;
      };
      expect(await vercel.headers()).toEqual(vercelHeaders());
    } finally {
      delete process.env.VERCEL;
    }
  });

  it("adds the site's redirects ahead of its own for hosts that send them, leaving out pages' addresses", async () => {
    const site = await mkdtemp(join(tmpdir(), "goodfellow-next-"));
    const write = async (path: string, text: string) => {
      await mkdir(join(site, path, ".."), { recursive: true });
      await writeFile(join(site, path), text);
    };
    try {
      await write("content/site.json", '{"version":1}\n');
      await write("content/pages/about.json", '{"version":1,"data":{"root":{},"content":[]}}\n');
      await write(
        "content/collections/talks/_collection.json",
        JSON.stringify({
          version: 1,
          name: "Talks",
          entryName: "Talk",
          path: "/talks/{slug}",
          fields: [{ name: "title", label: "Title", type: "text" }],
        }),
      );
      await write("content/collections/talks/hope.json", '{"version":1,"fields":{"title":"On hope"}}\n');
      await write(
        "content/redirects.json",
        JSON.stringify({
          version: 1,
          redirects: [
            { from: "/who-we-are/", to: "/about" },
            { from: "/about", to: "/elsewhere" },
            { from: "/talks/hope", to: "/" },
            { from: "/news(old).html", to: "https://news.example.org/" },
            { from: "/times", to: "/events/10:30?at=10:30#mass:sunday" },
          ],
        }),
      );
      const own = { source: "/old-blog", destination: "/news", permanent: false };
      const config = await withGoodfellow({ redirects: async () => [own] }, { root: site })("phase-production-build");
      expect(await config.redirects?.()).toEqual([
        { source: "/who-we-are", destination: "/about", permanent: true },
        { source: "/news\\(old\\).html", destination: "https://news.example.org/", permanent: true },
        { source: "/times", destination: "/events/10%3A30?at=10:30#mass%3Asunday", permanent: true },
        own,
      ]);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });

  it("writes redirects' targets so Next.js never reads them as patterns", () => {
    expect(redirectDestination(" https://example.org:8443/a/:b(c)*?q=:d#e:f ")).toBe(
      "https://example.org:8443/a/%3Ab%28c%29%2A?q=:d#e%3Af",
    );
    expect(redirectDestination("/a#b?c:d")).toBe("/a#b?c%3Ad");
    expect(redirectDestination("/plain/")).toBe("/plain/");
  });

  it("sends pages opened at the wrong one of the Site address and the admin address to the right one", async () => {
    const site = await mkdtemp(join(tmpdir(), "goodfellow-next-"));
    try {
      await mkdir(join(site, "content"), { recursive: true });
      await writeFile(join(site, "content/site.json"), '{"version":1,"url":"https://example.org/site/"}\n');
      await writeFile(
        join(site, "goodfellow.config.tsx"),
        'export default defineConfig({\n  admin: { url: "https://admin.example.org", checked: true },\n  blocks,\n});\n',
      );
      const config = await withGoodfellow({ basePath: "/site" }, { root: site })("phase-production-build");
      const redirects = (await config.redirects?.()) ?? [];
      // Their addresses have the base path already.
      expect(redirects.map(({ source, destination, basePath }) => [source, destination, basePath])).toEqual([
        ["/site/:path((?!admin/|admin$).*)", "https://example.org/site/:path", false],
        ["/site/admin", "https://admin.example.org/site/admin/", false],
        ["/site/admin/:path((?!editor/|editor$|plugins/).*)", "https://admin.example.org/site/admin/:path", false],
      ]);
      expect(redirects[0]?.has).toEqual([
        { type: "host", value: "admin.example.org" },
        { type: "header", key: "sec-fetch-dest", value: "document" },
      ]);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });

  it("runs the local backend in development, behind the site's address", async () => {
    const config = await withGoodfellow(
      { rewrites: async () => [{ source: "/old", destination: "/new" }] },
      { root },
    )("phase-development-server");
    expect(config.output).toBeUndefined();
    expect(config.experimental?.reactDebugChannel).toBe(false);

    const rewrites = await config.rewrites?.();
    if (!Array.isArray(rewrites)) throw new Error("Expected a list of rewrites.");
    expect(rewrites).toHaveLength(6);
    const [api, spanishFeeds, feeds, spanishCalendars, calendars, own] = rewrites;
    expect(own).toEqual({ source: "/old", destination: "/new" });
    // Each of the site's other languages has its own, under its code.
    expect(spanishCalendars?.source).toBe("/:language([a-z0-9-]+)/calendars/:file(.+\\.ics)");
    expect(spanishFeeds?.source).toBe("/:language([a-z0-9-]+)/feeds/:file(.+\\.rss|.+\\.atom)");
    const spanish = spanishFeeds?.destination.replace(":language", "es").replace(":file", "none.rss") ?? "";
    expect((await fetch(spanish)).status).toBe(404);
    expect(api?.source).toBe("/__goodfellow/api/:path*");
    // Calendar files, which the export gets from `goodfellow-next finish`, come from the local backend too.
    expect(calendars?.source).toBe("/calendars/:file(.+\\.ics)");
    const missing = await fetch(calendars?.destination.replace(":file", "none.ics") ?? "");
    expect(missing.status).toBe(404);
    // And so do feeds.
    expect(feeds?.source).toBe("/feeds/:file(.+\\.rss|.+\\.atom)");
    expect((await fetch(feeds?.destination.replace(":file", "none.rss") ?? "")).status).toBe(404);

    const url = api?.destination.replace(":path*", "revision") ?? "";
    const headers = { "x-goodfellow-request": "1" };
    const response = await fetch(url, { headers: { ...headers, origin: "http://localhost:3000" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("revision");
    expect((await fetch(url, { headers: { ...headers, origin: "https://evil.example" } })).status).toBe(403);
  });

  it("adds its rewrite ahead of the site's when they're grouped", async () => {
    const config = await withGoodfellow(
      { rewrites: async () => ({ beforeFiles: [], afterFiles: [{ source: "/a", destination: "/b" }], fallback: [] }) },
      { root },
    )("phase-development-server");
    const rewrites = await config.rewrites?.();
    if (Array.isArray(rewrites) || !rewrites) throw new Error("Expected grouped rewrites.");
    expect(rewrites.beforeFiles?.[0]?.source).toBe("/__goodfellow/api/:path*");
    expect(rewrites.afterFiles).toEqual([{ source: "/a", destination: "/b" }]);
  });

  it("serves the site from its base path, from the config or GOODFELLOW_BASE", async () => {
    const config = await withGoodfellow({ basePath: "/site/" }, { root })("phase-production-build");
    expect(config).toMatchObject({ basePath: "/site", env: { GOODFELLOW_BASE_PATH: "/site" } });

    process.env.GOODFELLOW_BASE = "/from-env/";
    try {
      expect(await withGoodfellow({}, { root })("phase-production-build")).toMatchObject({ basePath: "/from-env" });
    } finally {
      delete process.env.GOODFELLOW_BASE;
    }
  });

  it("keeps the site's image loader, which can optimize images", async () => {
    const images = { loader: "custom" as const, loaderFile: "./loader.ts" };
    const config = await withGoodfellow({ images }, { root })("phase-production-build");
    expect(config.images).toEqual(images);
  });

  it("lists smaller copies of photos only where Next.js doesn't optimize them", async () => {
    const mark = join(root, ".next", IMAGE_SIZES_MARK);
    try {
      await withGoodfellow({}, { root })("phase-production-build");
      expect(existsSync(mark)).toBe(true);
      expect(process.env[IMAGE_SIZES_ENV]).toBe("1");
      await withGoodfellow(
        { images: { loader: "custom", loaderFile: "./loader.ts" } },
        { root },
      )("phase-production-build");
      expect(existsSync(mark)).toBe(false);
      expect(process.env[IMAGE_SIZES_ENV]).toBeUndefined();
    } finally {
      delete process.env[IMAGE_SIZES_ENV];
    }
  });
});
