import { describe, expect, it } from "vitest";
import type { Collection } from "./collections.js";
import {
  cleanTags,
  describedIn,
  focusPosition,
  hasTag,
  mediaDetailsOf,
  mediaTags,
  pageCredits,
  pageDescriptions,
  pageFocus,
} from "./credits.js";
import { loadSiteContent } from "./load.js";

const credit = (title: string) => ({ title, creator: "Ann", source: "Flickr", license: "CC BY 2.0" });

const credits = {
  "/media/choir.jpg": credit("Choir"),
  "/media/leaves.jpg": credit("Leaves"),
  "/media/logo.png": credit("Logo"),
  "/media/news.jpg": credit("News"),
};

const news = {
  id: "news",
  entries: [{ content: { version: 1, fields: { title: "Open house", photo: "/media/news.jpg" } } }],
} as unknown as Collection;

describe("pageCredits", () => {
  it("lists the credits of the media a page, its header and footer use, and of the items its lists show", () => {
    const page = {
      content: [
        { type: "Hero", props: { image: "/media/choir.jpg" } },
        { type: "Text", props: { content: '<p><img src="/media/leaves.jpg.old"></p>' } },
        { type: "CollectionList", props: { collection: "news" } },
      ],
    };
    const header = { content: [{ type: "Logo", props: { src: "/media/logo.png?v=2" } }] };
    expect(pageCredits({ credits, collections: [news] }, [page, header]).map((found) => found.url)).toEqual([
      "/media/choir.jpg",
      "/media/logo.png",
      "/media/news.jpg",
    ]);
    expect(pageCredits({ credits, collections: [news] }, [page])[0]).toEqual({
      url: "/media/choir.jpg",
      ...credit("Choir"),
    });
    expect(pageCredits({ collections: [news] }, [page])).toEqual([]);
  });
});

describe("pageDescriptions", () => {
  const descriptions = {
    "/media/choir.jpg": { text: "The choir singing", translations: { es: "El coro cantando" } },
    "/media/leaves.jpg": { text: "Autumn leaves" },
  };

  it("gives the descriptions of the images a page uses, in its language", () => {
    const page = { content: [{ type: "Image", props: { src: "/media/choir.jpg", alt: "" } }] };
    expect(pageDescriptions({ descriptions, collections: [] }, [page])).toEqual({
      "/media/choir.jpg": "The choir singing",
    });
    expect(pageDescriptions({ descriptions, collections: [] }, [page], "es")).toEqual({
      "/media/choir.jpg": "El coro cantando",
    });
    expect(pageDescriptions({ collections: [] }, [page])).toEqual({});
  });

  it("falls back on the main language's", () => {
    expect(describedIn(descriptions["/media/leaves.jpg"], "es")).toBe("Autumn leaves");
  });
});

describe("loading credits", () => {
  it("loads content/media.json, linking only web addresses", async () => {
    const files: Record<string, string> = {
      "content/media.json": JSON.stringify({
        version: 1,
        credits: { "/media/choir.jpg": { ...credit("Choir"), sourceUrl: "https://www.flickr.com/photos/1" } },
      }),
    };
    const source = {
      read: async (path: string) => files[path],
      list: async () => [],
    };
    expect((await loadSiteContent(source)).credits).toEqual({
      "/media/choir.jpg": { ...credit("Choir"), sourceUrl: "https://www.flickr.com/photos/1" },
    });
    files["content/media.json"] = JSON.stringify({
      version: 1,
      credits: { "/media/a.jpg": { ...credit("A"), sourceUrl: "javascript:alert(1)" } },
    });
    await expect(loadSiteContent(source)).rejects.toThrow(/sourceUrl must start with https:\/\//);
  });
});

describe("loading descriptions", () => {
  it("loads them from content/media.json, and refuses empty ones", async () => {
    const files: Record<string, string> = {
      "content/media.json": JSON.stringify({
        version: 1,
        credits: {},
        descriptions: { "/media/choir.jpg": { text: "The choir singing", translations: { es: "El coro" } } },
      }),
    };
    const source = { read: async (path: string) => files[path], list: async () => [] };
    expect((await loadSiteContent(source)).descriptions).toEqual({
      "/media/choir.jpg": { text: "The choir singing", translations: { es: "El coro" } },
    });
    files["content/media.json"] = JSON.stringify({ version: 1, descriptions: { "/media/a.jpg": { text: " " } } });
    await expect(loadSiteContent(source)).rejects.toThrow();
  });
});

describe("focal points and tags", () => {
  it("gives the focal points of the images a page uses as CSS positions", () => {
    const page = { content: [{ type: "Image", props: { src: "/media/choir.jpg" } }] };
    const focus = { "/media/choir.jpg": { x: 30, y: 62.25 }, "/media/other.jpg": { x: 0, y: 0 } };
    expect(pageFocus({ focus }, [page])).toEqual({ "/media/choir.jpg": "30% 62.3%" });
    expect(focusPosition({ x: 100, y: 0 })).toBe("100% 0%");
  });

  it("keeps tags trimmed, once whatever their case, and no more than the limit", () => {
    expect(cleanTags([" Events ", "events", "", "Staff  rota"])).toEqual(["Events", "Staff rota"]);
    expect(cleanTags(Array.from({ length: 30 }, (_, index) => `tag ${index}`))).toHaveLength(20);
    expect(mediaTags({ "/media/a.jpg": ["Staff", "events"], "/media/b.jpg": ["Events"] })).toEqual(["events", "Staff"]);
    expect(hasTag(["Events"], "EVENTS")).toBe(true);
    expect(hasTag(undefined, "Events")).toBe(false);
  });

  it("reads everything content/media.json says from a loaded site", async () => {
    const files: Record<string, string> = {
      "content/media.json": JSON.stringify({
        version: 1,
        credits: {},
        focus: { "/media/a.jpg": { x: 10, y: 20 } },
        tags: { "/media/a.jpg": ["Events"] },
      }),
    };
    const content = await loadSiteContent({ read: async (path) => files[path], list: async () => [] });
    expect(mediaDetailsOf(content)).toEqual({
      credits: {},
      focus: { "/media/a.jpg": { x: 10, y: 20 } },
      tags: { "/media/a.jpg": ["Events"] },
    });
    files["content/media.json"] = JSON.stringify({ version: 1, focus: { "/media/a.jpg": { x: 120, y: 0 } } });
    await expect(loadSiteContent({ read: async (path) => files[path], list: async () => [] })).rejects.toThrow();
  });
});
