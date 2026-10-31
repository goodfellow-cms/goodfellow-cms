import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMediaSizes, writeImageSizes } from "./node-media.js";

describe("readMediaSizes", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-media-"));
    await mkdir(join(root, "public/media/logos"), { recursive: true });
    await writeFile(
      join(root, "public/media/logos/mark.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"/>',
    );
    await writeFile(join(root, "public/media/bulletin.pdf"), "%PDF-1.4");
    await writeFile(join(root, "public/media/broken.png"), "not a png");
  });

  afterAll(() => rm(root, { recursive: true, force: true }));

  it("lists the images it can read, by address", async () => {
    expect(await readMediaSizes(root)).toEqual({ "/media/logos/mark.svg": { width: 64, height: 32 } });
  });

  it("returns nothing for a site without media", async () => {
    expect(await readMediaSizes(join(root, "missing"))).toEqual({});
  });
});

/** The start of a PNG, as far as its size: enough for `imageSize()`. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

describe("writeImageSizes", () => {
  let root: string;
  let out: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-sizes-"));
    out = join(root, "dist");
    await mkdir(join(root, "public/media/news"), { recursive: true });
    await writeFile(join(root, "public/media/news/hall.png"), pngHeader(1000, 500));
    await writeFile(join(root, "public/media/icon.png"), pngHeader(300, 300));
    await writeFile(
      join(root, "public/media/logo.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 100"/>',
    );
  });

  afterAll(() => rm(root, { recursive: true, force: true }));

  it("writes a copy of each photo at each width smaller than it, where pages list them", async () => {
    const asked: number[] = [];
    const result = await writeImageSizes(root, out, {
      resize: async (_image, width) => {
        asked.push(width);
        return new TextEncoder().encode(`${width} wide`);
      },
    });
    expect(result).toEqual({ written: 2, failed: [] });
    expect(asked.sort()).toEqual([480, 800]);
    expect(await readFile(join(out, "media-sizes/480/news/hall.png.webp"), "utf8")).toBe("480 wide");
    expect(await readFile(join(out, "media-sizes/800/news/hall.png.webp"), "utf8")).toBe("800 wide");
    // Copies already there are kept.
    expect(await writeImageSizes(root, out, { resize: async () => new Uint8Array() })).toEqual({
      written: 0,
      failed: [],
    });
  });

  it("copies a photo as it is where it can't be made smaller, so every address pages list is there", async () => {
    const elsewhere = join(root, "elsewhere");
    const result = await writeImageSizes(root, elsewhere, {
      resize: async () => {
        throw new Error("Unsupported image");
      },
    });
    expect(result).toEqual({ written: 2, failed: ["/media/news/hall.png"] });
    expect([...(await readFile(join(elsewhere, "media-sizes/800/news/hall.png.webp")))]).toEqual([
      ...pngHeader(1000, 500),
    ]);
    expect(await writeImageSizes(root, join(root, "without"))).toEqual({
      written: 2,
      failed: ["/media/news/hall.png"],
    });
  });
});
