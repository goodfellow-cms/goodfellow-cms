import type { ApiManifest } from "@goodfellow-cms/core/content-api";
import { describe, expect, it } from "vitest";
import {
  type ContentStorage,
  findPage,
  loadPage,
  MANIFEST_FILE,
  mediaAddresses,
  memoryStorage,
  readsContent,
  redirectFor,
  siteAddress,
  syncSite,
} from "./sync.js";

const SITE = "https://parish.example/";

/** A site's content API as files, which tests change between syncs, served by a fake of its address. */
function fakeSite() {
  const files = new Map<string, string>();
  const requests: string[] = [];
  let online = true;
  const put = (name: string, value: unknown) => files.set(name, JSON.stringify(value));
  const file = (name: string) => ({ file: name, hash: `${name}#${files.get(name)?.length ?? 0}` });
  const manifest = (extra: Partial<ApiManifest> = {}) => {
    const pages = [...files.keys()]
      .filter((name) => name.startsWith("pages/"))
      .map((name) => {
        const path = name === "pages/index.json" ? "/" : `/${name.slice("pages/".length, -".json".length)}`;
        return { ...file(name), path, language: "en" };
      });
    put("manifest.json", {
      version: 1,
      goodfellow: "0.6.0",
      content: { page: 1 },
      base: "/",
      mainLanguage: "en",
      languages: {
        en: {
          site: file("site.json"),
          collections: file("collections.json"),
          header: file("header.json"),
          footer: file("footer.json"),
        },
      },
      pages,
      blocks: ["Heading"],
      ...extra,
    } satisfies ApiManifest);
  };
  put("site.json", { version: 1, language: "en", settings: { title: "Parish" }, menus: {}, pages: [] });
  put("collections.json", { version: 1, language: "en", collections: [] });
  put("header.json", { version: 1, language: "en", data: { content: [] }, richText: {} });
  put("footer.json", { version: 1, language: "en", data: { content: [] }, richText: {} });
  put("pages/index.json", { path: "/", data: { content: [{ type: "Image", props: { src: "/media/church.jpg" } }] } });
  put("pages/about.json", {
    path: "/about",
    data: { content: [{ type: "Video", props: { file: "/media/tour.mp4" } }] },
  });
  manifest();
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (!online) throw new TypeError("Network request failed");
    const name = url.startsWith(`${SITE}api/`) ? url.slice(`${SITE}api/`.length) : undefined;
    const text = name && files.get(name);
    return text ? new Response(text) : new Response("Not found", { status: 404 });
  }) as typeof fetch;
  return {
    files,
    requests,
    put,
    manifest,
    fetch: fetcher,
    offline: () => {
      online = false;
    },
  };
}

/** Memory storage that downloads media too, recording what it downloaded. */
function storageWithMedia(): ContentStorage & { files: Map<string, string>; downloaded: string[] } {
  const storage = memoryStorage();
  const downloaded: string[] = [];
  return {
    ...storage,
    downloaded,
    download: async (url, name) => {
      downloaded.push(url);
      storage.files.set(name, url);
      return `file:///${name}`;
    },
    fileUri: async (name) => (storage.files.has(name) ? `file:///${name}` : undefined),
  };
}

describe("syncSite", () => {
  it("keeps every file the manifest lists, and the pictures they show, but not videos", async () => {
    const site = fakeSite();
    const storage = storageWithMedia();
    const result = await syncSite({ site: SITE, storage, fetch: site.fetch });
    expect(result.problem).toBeUndefined();
    expect([...storage.files.keys()].sort()).toEqual(
      [
        "collections.json",
        "footer.json",
        "header.json",
        MANIFEST_FILE,
        "media/church.jpg",
        "pages/about.json",
        "pages/index.json",
        "site.json",
      ].sort(),
    );
    expect(storage.downloaded).toEqual(["https://parish.example/media/church.jpg"]);
  });

  it("downloads only what changed, and removes what the site no longer has", async () => {
    const site = fakeSite();
    const storage = storageWithMedia();
    await syncSite({ site: SITE, storage, fetch: site.fetch });
    site.requests.length = 0;
    site.put("pages/about.json", { path: "/about", data: { content: [] }, extra: "changed" });
    site.files.delete("pages/index.json");
    site.manifest();
    const result = await syncSite({ site: SITE, storage, fetch: site.fetch });
    expect(result.changed).toEqual(["pages/about.json"]);
    expect(result.removed.sort()).toEqual(["media/church.jpg", "pages/about.json", "pages/index.json"]);
    expect(site.requests).toEqual([`${SITE}api/manifest.json`, `${SITE}api/pages/about.json`]);
    expect(storage.files.has("pages/index.json")).toBe(false);
  });

  it("keeps ahead only the pages it's asked to, and loads the rest when they're opened", async () => {
    const site = fakeSite();
    const storage = memoryStorage();
    const { manifest } = await syncSite({ site: SITE, storage, fetch: site.fetch, keep: (page) => page.path === "/" });
    expect(storage.files.has("pages/about.json")).toBe(false);
    const page = await loadPage({ site: SITE, storage, fetch: site.fetch }, manifest as ApiManifest, "/about/");
    expect(page?.path).toBe("/about");
    expect(storage.files.has("pages/about.json")).toBe(true);
  });

  it("keeps its copy offline, and when the site's content is newer than the app reads", async () => {
    const site = fakeSite();
    const storage = memoryStorage();
    const first = await syncSite({ site: SITE, storage, fetch: site.fetch });
    site.manifest({ content: { page: 999 } });
    const newer = await syncSite({ site: SITE, storage, fetch: site.fetch });
    expect(newer.problem).toBe("newer-content");
    expect(newer.manifest).toEqual(first.manifest);
    site.offline();
    const offline = await syncSite({ site: SITE, storage, fetch: site.fetch });
    expect(offline.problem).toBe("offline");
    expect(offline.manifest).toEqual(first.manifest);
    expect(storage.files.has("pages/index.json")).toBe(true);
  });

  it("says when the site has no content API", async () => {
    const site = fakeSite();
    site.files.delete("manifest.json");
    const result = await syncSite({ site: SITE, storage: memoryStorage(), fetch: site.fetch });
    expect(result.problem).toBe("no-api");
  });
});

describe("the app's copy", () => {
  it("reads content only of the versions the app knows", () => {
    expect(readsContent({ version: 1, content: { page: 1 } })).toBe(true);
    expect(readsContent({ version: 1, content: { page: 999 } })).toBe(false);
    expect(readsContent({ version: 2 as 1, content: {} })).toBe(false);
  });

  it("finds pages with or without a trailing slash, and Page not found for others", () => {
    const pages = [
      { path: "/", file: "pages/index.json", hash: "a", language: "en" },
      { path: "/about", file: "pages/about.json", hash: "b", language: "en" },
      { path: "/404", file: "pages/404.json", hash: "c", language: "en" },
    ];
    const manifest = { pages } as ApiManifest;
    expect(findPage(manifest, "/about/")?.file).toBe("pages/about.json");
    expect(findPage(manifest, "/missing")?.file).toBe("pages/404.json");
  });

  it("follows the site's redirects, as the website does", () => {
    const pages = [
      { path: "/", file: "pages/index.json", hash: "a", language: "en" },
      { path: "/about", file: "pages/about.json", hash: "b", language: "en" },
      { path: "/404", file: "pages/404.json", hash: "c", language: "en" },
    ];
    const manifest = {
      pages,
      redirects: [
        { from: "/who-we-are", to: "/about-us#history" },
        { from: "/about-us", to: "/about" },
        { from: "/visit", to: "https://example.org/visit" },
        { from: "/round", to: "/and-round" },
        { from: "/and-round", to: "/round" },
      ],
    } as ApiManifest;
    // An old address opens the page it leads to, through a redirect that moved again.
    expect(findPage(manifest, "/who-we-are/")?.file).toBe("pages/about.json");
    expect(redirectFor(manifest, "/who-we-are?from=mail")).toBe("/about");
    expect(redirectFor(manifest, "/about-us")).toBe("/about");
    // Another site's address is the app's to open in the browser.
    expect(redirectFor(manifest, "/visit")).toBe("https://example.org/visit");
    expect(findPage(manifest, "/visit")?.file).toBe("pages/404.json");
    // Pages, and addresses that aren't redirected, stay as they are, and a circle ends.
    expect(redirectFor(manifest, "/about")).toBeUndefined();
    expect(redirectFor(manifest, "/missing")).toBeUndefined();
    expect(findPage(manifest, "/round")?.file).toBe("pages/404.json");
    expect(findPage({ pages } as ApiManifest, "/who-we-are")?.file).toBe("pages/404.json");
  });

  it("keeps the pictures a file shows, never other media", () => {
    expect(
      mediaAddresses('{"src":"/media/a.jpg","file":"/media/b.pdf","video":"/media/c.mp4","x":"/media/d.svg?x"}'),
    ).toEqual(["/media/a.jpg", "/media/d.svg"]);
  });

  it("opens addresses on the site with its base path", () => {
    expect(siteAddress("https://name.github.io/site/", { base: "/site/" }, "/about")).toBe(
      "https://name.github.io/site/about",
    );
    expect(siteAddress(SITE, { base: "/" }, "/media/a.jpg")).toBe("https://parish.example/media/a.jpg");
    expect(siteAddress(SITE, undefined, "https://other.example/")).toBe("https://other.example/");
  });
});
