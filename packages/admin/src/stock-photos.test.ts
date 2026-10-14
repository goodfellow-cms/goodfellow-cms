import { fakeOpenverse } from "@goodfellow-cms/ai/testing";
import { describe, expect, it } from "vitest";
import { findStockPhotos, stockPhotoChanges } from "./stock-photos.js";

const photo = (id: string) => ({
  id,
  title: `Photo ${id}`,
  creator: "Ann",
  foreign_landing_url: `https://www.flickr.com/photos/ann/${id}`,
  license: "by",
  license_version: "2.0",
  license_url: "https://creativecommons.org/licenses/by/2.0/",
  source: "flickr",
  width: 1600,
  height: 1200,
});

describe("findStockPhotos", () => {
  it("finds a photo for each search, named after it, with its credit", async () => {
    const fake = fakeOpenverse({
      photos: (query) => (query === "nothing" ? [] : [photo(query.replace(/\W/g, ""))]),
      image: { bytes: new Uint8Array([1, 2, 3]), type: "image/jpeg" },
    });
    const found = await findStockPhotos(["church choir", "nothing", "church choir!"], {
      taken: ["church-choir.jpg"],
      fetch: fake.fetch,
    });
    expect(found.photos.map((item) => [item.query, item.url])).toEqual([
      ["church choir", "/media/church-choir-2.jpg"],
      ["church choir!", "/media/church-choir-3.jpg"],
    ]);
    expect(found.photos[0]?.credit).toMatchObject({ title: "Photo churchchoir", creator: "Ann", license: "CC BY 2.0" });
    expect(found.missing).toBe(1);
    expect(found.problem).toBeUndefined();
    expect(stockPhotoChanges(found.photos)[0]).toEqual({
      path: "public/media/church-choir-2.jpg",
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it("stops when Openverse has had too many requests, and passes over files that aren't photos", async () => {
    const busy = fakeOpenverse({ photos: () => [photo("a")], busy: true });
    const stopped = await findStockPhotos(["a", "b"], { taken: [], fetch: busy.fetch });
    expect(stopped).toMatchObject({ photos: [], missing: 2, problem: { problem: "busy" } });
    expect(busy.requests).toHaveLength(1);

    const page = fakeOpenverse({
      photos: () => [photo("a")],
      image: { bytes: new Uint8Array([1]), type: "text/html" },
    });
    expect(await findStockPhotos(["a"], { taken: [], fetch: page.fetch })).toMatchObject({ photos: [], missing: 1 });
  });
});
