import { describe, expect, it } from "vitest";
import { buildRequest } from "./prompt.js";
import {
  downloadStockPhoto,
  pickStockPhoto,
  StockPhotoError,
  searchStockPhotos,
  stockPhotoCredit,
  stockPhotoQueries,
  withStockPhotos,
} from "./stock-photos.js";
import { fakeOpenverse } from "./testing.js";

const choir = {
  id: "c149cfde-08c6-4d2a-a99e-534a5ae00c23",
  title: "Melton Mowbray church - choir",
  creator: "It's No Game",
  creator_url: "https://www.flickr.com/photos/29057345@N04",
  foreign_landing_url: "https://www.flickr.com/photos/29057345@N04/53106427894",
  license: "by",
  license_version: "2.0",
  license_url: "https://creativecommons.org/licenses/by/2.0/",
  source: "flickr",
  width: 1024,
  height: 728,
};

describe("searchStockPhotos", () => {
  it("asks Openverse for photos whose licenses allow commercial use and changes", async () => {
    const fake = fakeOpenverse({ photos: () => [choir] });
    const [photo] = await searchStockPhotos("church choir", { fetch: fake.fetch });
    const url = new URL(fake.requests[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://api.openverse.org/v1/images/");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: "church choir",
      license: "by,by-sa,cc0,pdm",
      category: "photograph",
      mature: "false",
    });
    expect(photo).toMatchObject({ id: choir.id, title: choir.title, creator: choir.creator, width: 1024 });
    expect(photo?.downloadUrl).toBe(
      `https://api.openverse.org/v1/images/${choir.id}/thumb/?full_size=true&compressed=false`,
    );
  });

  it("leaves out photos with other licenses, and addresses that aren't web addresses", async () => {
    const fake = fakeOpenverse({
      photos: () => [
        { ...choir, id: "a", license: "by-nc" },
        { ...choir, id: "b", creator_url: "javascript:alert(1)", foreign_landing_url: "ftp://example.org" },
        { ...choir, id: "../c" },
      ],
    });
    const photos = await searchStockPhotos("choir", { fetch: fake.fetch });
    expect(photos.map((photo) => photo.id)).toEqual(["b"]);
    expect(photos[0]).not.toHaveProperty("creatorUrl", expect.anything());
    expect(photos[0]?.landingUrl).toBeUndefined();
  });

  it("explains when Openverse has had too many requests", async () => {
    const fake = fakeOpenverse({ photos: () => [], busy: true });
    await expect(searchStockPhotos("choir", { fetch: fake.fetch })).rejects.toEqual(
      new StockPhotoError("busy", "Openverse has had too many requests from here."),
    );
  });

  it("downloads a photo through Openverse", async () => {
    const fake = fakeOpenverse({
      photos: () => [choir],
      image: { bytes: new Uint8Array([1, 2, 3]), type: "image/jpeg" },
    });
    const [photo] = await searchStockPhotos("choir", { fetch: fake.fetch });
    const blob = await downloadStockPhoto(photo as NonNullable<typeof photo>, { fetch: fake.fetch });
    expect(blob.type).toBe("image/jpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("choosing and crediting photos", () => {
  it("picks the first photo wide enough, or else the first", async () => {
    const fake = fakeOpenverse({
      photos: () => [
        { ...choir, id: "small", width: 300 },
        { ...choir, id: "wide" },
      ],
    });
    const photos = await searchStockPhotos("choir", { fetch: fake.fetch });
    expect(pickStockPhoto(photos)?.id).toBe("wide");
    expect(pickStockPhoto(photos.slice(0, 1))?.id).toBe("small");
    expect(pickStockPhoto([])).toBeUndefined();
  });

  it("credits a photo with its title, creator, source and license", async () => {
    const fake = fakeOpenverse({
      photos: () => [choir, { ...choir, id: "pd", license: "pdm", license_version: "1.0", source: "wikimedia" }],
    });
    const [photo, publicDomain] = await searchStockPhotos("choir", { fetch: fake.fetch });
    expect(stockPhotoCredit(photo as NonNullable<typeof photo>)).toEqual({
      title: "Melton Mowbray church - choir",
      creator: "It's No Game",
      creatorUrl: "https://www.flickr.com/photos/29057345@N04",
      source: "Flickr",
      sourceUrl: "https://www.flickr.com/photos/29057345@N04/53106427894",
      license: "CC BY 2.0",
      licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    });
    expect(stockPhotoCredit(publicDomain as NonNullable<typeof publicDomain>)).toMatchObject({
      source: "Wikimedia Commons",
      license: "Public Domain Mark 1.0",
    });
  });
});

describe("the AI's searches", () => {
  const answer = {
    blocks: [
      { type: "Hero", props: { image: "stock-photo: church  choir singing", title: "Choir" } },
      { type: "Card", props: { image: "Stock-Photo:church choir singing" } },
      { type: "Card", props: { image: "stock-photo: autumn leaves", items: [{ photo: "/media/own.jpg" }] } },
      { type: "Card", props: { image: "stock-photo:" } },
    ],
  };

  it("finds every search once", () => {
    expect(stockPhotoQueries(answer)).toEqual(["church choir singing", "autumn leaves"]);
  });

  it("puts the photos found in their place, leaving fields with none empty", () => {
    const filled = withStockPhotos(answer, new Map([["church choir singing", "/media/choir.jpg"]]));
    expect(filled.blocks.map((block) => block.props.image)).toEqual(["/media/choir.jpg", "/media/choir.jpg", "", ""]);
    expect(filled.blocks[0]?.props.title).toBe("Choir");
    expect(filled.blocks[2]?.props.items).toEqual([{ photo: "/media/own.jpg" }]);
  });

  it("tells the AI it can ask for photos only when it can", () => {
    const site = { title: "St. Joseph", description: "", language: "en", pages: [], collections: [] };
    const task = { kind: "fill" as const, name: "news story", fields: {}, values: {}, instruction: "Write it" };
    expect(buildRequest(task, { components: {} }, site).prompt).not.toContain("stock-photo:");
    expect(buildRequest(task, { components: {} }, { ...site, stockPhotos: true }).prompt).toContain(
      '"stock-photo: church choir singing"',
    );
  });
});
