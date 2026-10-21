import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportWordPress,
  formatWordPressExport,
  formatWordPressImport,
  importWordPress,
  withoutJpegDetails,
} from "./node-wordpress.js";
import { fakeWordPress, SAMPLE_IMAGE, SAMPLE_WORDPRESS_URL, sampleWordPressExport } from "./testing.js";
import { readWordPressExport } from "./wordpress.js";

let root: string;
afterEach(() => rm(root, { recursive: true, force: true }));

async function site() {
  root = await mkdtemp(join(tmpdir(), "goodfellow-wordpress-"));
  const write = async (path: string, text: string) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  };
  await write("content/site.json", JSON.stringify({ version: 1, title: "My site" }));
  await write("content/pages/index.json", JSON.stringify({ version: 1, data: { root: { props: { title: "Home" } } } }));
  await write("public/media/church.jpg", "an earlier photo");
  return write;
}

const fetcher = (wordpress = fakeWordPress()) => wordpress.fetch as unknown as typeof fetch;

describe("importing a WordPress site on disk", () => {
  it("writes its pages, posts and the media they use, with names of their own", async () => {
    const write = await site();
    await write("wordpress.xml", sampleWordPressExport());
    const result = await importWordPress(root, join(root, "wordpress.xml"), { fetch: fetcher() });
    expect(result.written).toBe(true);
    expect(result.copied).toHaveLength(3);

    const home = await readFile(join(root, "content/pages/index.json"), "utf8");
    // The site already had a church.jpg, so the copy is church-2.jpg.
    expect(home).toContain('"src": "/media/church-2.jpg"');
    expect(await readFile(join(root, "public/media/church.jpg"), "utf8")).toBe("an earlier photo");
    expect(new Uint8Array(await readFile(join(root, "public/media/church-2.jpg")))).toEqual(SAMPLE_IMAGE);
    expect(await readFile(join(root, "content/collections/posts/parish-picnic.md"), "utf8")).toContain(
      "image: /media/picnic.jpg",
    );

    const report = formatWordPressImport(result);
    expect(report).toContain("Imported from WordPress:");
    expect(report).toContain("- 4 pages, replacing /");
    expect(report).toContain('- 3 posts in the "posts" collection, at /news/{slug}, listed on /news');
    expect(report).toContain("The [contact-form-7] shortcode only works in WordPress, so it was left out: About us.");
  });

  it("reads a site from its address, and leaves media it can't download where it is", async () => {
    await site();
    const wordpress = fakeWordPress();
    const failing = (async (url: string) =>
      url.includes("/uploads/") && url.includes("choir")
        ? { ok: false, status: 404 }
        : wordpress.fetch(url)) as unknown as typeof fetch;
    const result = await importWordPress(root, "stbrendan.example.org", { fetch: failing });
    expect(result.skipped).toEqual([
      { url: `${SAMPLE_WORDPRESS_URL}/wp-content/uploads/2026/05/choir.jpg`, reason: "download" },
    ]);
    const about = await readFile(join(root, "content/pages/about.json"), "utf8");
    expect(about).toContain(`"src": "${SAMPLE_WORDPRESS_URL}/wp-content/uploads/2026/05/choir.jpg"`);
    expect(formatWordPressImport(result)).toContain("1 media file couldn't be copied");
  });

  it("only plans the import for a dry run", async () => {
    await site();
    const result = await importWordPress(root, SAMPLE_WORDPRESS_URL, { fetch: fetcher(), dryRun: true });
    expect(result.written).toBe(false);
    expect(formatWordPressImport(result)).toContain("Importing from WordPress would bring across:");
    await expect(readFile(join(root, "content/pages/about.json"), "utf8")).rejects.toThrow();
  });
});

describe("exporting a site on disk to WordPress", () => {
  it("writes an export file with the site's pages, posts and media", async () => {
    const write = await site();
    await write("wordpress.xml", sampleWordPressExport());
    await importWordPress(root, join(root, "wordpress.xml"), { fetch: fetcher() });
    await write(
      "content/site.json",
      JSON.stringify({ version: 1, title: "St. Brendan's", url: "https://new.example.org" }),
    );

    const result = await exportWordPress(root, join(root, "out.xml"));
    expect(result.file).toBe(join(root, "out.xml"));
    const exported = readWordPressExport(await readFile(result.file, "utf8"));
    expect(exported.title).toBe("St. Brendan's");
    expect(exported.items.filter((item) => item.type === "post")).toHaveLength(3);
    expect(exported.media.map((file) => file.url)).toContain("https://new.example.org/media/church-2.jpg");

    const report = formatWordPressExport(result, root);
    expect(report).toContain("Wrote out.xml, a WordPress export file with:");
    expect(report).toContain("- 4 pages");
    expect(report).toContain("- 3 posts, with");
    expect(report).toContain("Tools → Import → WordPress");
  });
});

describe("photos' hidden details", () => {
  const segment = (marker: number, body: number[]) => [0xff, marker, 0, body.length + 2, ...body];
  const exif = (orientation: number) => [
    ..."Exif".split("").map((character) => character.charCodeAt(0)),
    0,
    0,
    // Little-endian TIFF, its first directory at 8, with one entry: Orientation.
    0x49,
    0x49,
    42,
    0,
    8,
    0,
    0,
    0,
    1,
    0,
    0x12,
    0x01,
    3,
    0,
    1,
    0,
    0,
    0,
    orientation,
    0,
    0,
    0,
  ];
  const jpeg = (app1: number[]) =>
    new Uint8Array([
      0xff,
      0xd8,
      ...segment(0xe0, [1, 2]),
      ...segment(0xe1, app1),
      ...segment(0xda, [9]),
      7,
      7,
      0xff,
      0xd9,
    ]);

  it("drops a JPEG's Exif details", () => {
    expect([...withoutJpegDetails(jpeg(exif(1)))]).toEqual([
      0xff,
      0xd8,
      ...segment(0xe0, [1, 2]),
      ...segment(0xda, [9]),
      7,
      7,
      0xff,
      0xd9,
    ]);
  });

  it("keeps them where they turn the photo", () => {
    const turned = jpeg(exif(6));
    expect(withoutJpegDetails(turned)).toBe(turned);
  });
});
