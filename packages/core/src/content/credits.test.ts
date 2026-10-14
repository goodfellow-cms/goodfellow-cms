import { describe, expect, it } from "vitest";
import type { Collection } from "./collections.js";
import { pageCredits } from "./credits.js";
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
