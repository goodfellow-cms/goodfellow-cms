import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { downloadName, downloadPaths, siteArchive } from "./site-download.js";

const files: Record<string, Uint8Array> = {
  "content/site.json": new TextEncoder().encode('{\n  "version": 1\n}\n'),
  "content/pages/index.json": new TextEncoder().encode('{\n  "version": 1\n}\n'),
  "public/media/photo.jpg": new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]),
  "blocks/installed/installed.json": new TextEncoder().encode('{\n  "version": 1\n}\n'),
  "blocks/installed/faq/block.tsx": new TextEncoder().encode("export {};\n"),
  "src/styles.css": new TextEncoder().encode("@import 'tailwindcss';\n"),
};
const list = async (dir: string) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`));

describe("downloadPaths", () => {
  it("lists the content, the media and the records the site has, never its code", async () => {
    expect(await downloadPaths(list)).toEqual([
      "blocks/installed/installed.json",
      "content/pages/index.json",
      "content/site.json",
      "public/media/photo.jpg",
    ]);
  });
});

describe("downloadName", () => {
  it("names the copy after the site and the day", () => {
    expect(downloadName("St. Anne's Parish", new Date(2026, 10, 1))).toBe("st-anne-s-parish-2026-11-01.zip");
    expect(downloadName("Café Señora", new Date(2026, 0, 9))).toBe("cafe-senora-2026-01-09.zip");
    expect(downloadName("Ἁγία Σοφία", new Date(2026, 0, 9))).toBe("site-2026-01-09.zip");
    expect(downloadName(undefined, new Date(2026, 0, 9))).toBe("site-2026-01-09.zip");
  });
});

describe("siteArchive", () => {
  it("zips every file as it is, leaving out ones that are gone, and says how far it's got", async () => {
    const paths = [...(await downloadPaths(list)), "content/pages/gone.json"];
    const progress: number[] = [];
    const chunks = await siteArchive(
      paths,
      async (path) => files[path],
      ({ done }) => progress.push(done),
    );
    const zip = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      zip.set(chunk, offset);
      offset += chunk.length;
    }
    const unzipped = unzipSync(zip);
    expect(Object.keys(unzipped).sort()).toEqual(paths.slice(0, -1));
    for (const path of Object.keys(unzipped)) expect(unzipped[path]).toEqual(files[path]);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(paths.length);
  });

  it("stops when a file can't be read", async () => {
    await expect(
      siteArchive(["content/site.json"], async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
  });
});
