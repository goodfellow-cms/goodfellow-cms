import { describe, expect, it } from "vitest";
import { checkSite } from "./checks.js";
import { type ContentSource, loadSiteContent } from "./load.js";
import {
  isStorableAddress,
  isStorageUrl,
  type MediaStorage,
  mediaStorageFileChange,
  storedMediaSizes,
  storedMediaUrl,
  withStoredAddresses,
  withStoredFiles,
  withStoredMedia,
} from "./media-storage.js";
import { MEDIA_STORAGE_FILE } from "./paths.js";
import { shownContent } from "./schedule.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const storage: MediaStorage = {
  plugin: "goodfellow-plugin-s3",
  url: "https://media.example.org/site/",
  files: {
    "/media/sermon.mp4": { size: 900_000_000 },
    "/media/choir.jpg": { size: 120_000, width: 1600, height: 900 },
  },
};

const storageFile = { version: 1, ...storage };

describe("addresses", () => {
  it("takes https addresses, and http only on this computer", () => {
    expect(isStorageUrl("https://bucket.s3.eu-west-1.amazonaws.com/media")).toBe(true);
    expect(isStorageUrl("http://127.0.0.1:9000/bucket")).toBe(true);
    expect(isStorageUrl("http://media.example.org")).toBe(false);
    expect(isStorageUrl("https://media.example.org/?x=1")).toBe(false);
    expect(isStorageUrl("javascript:alert(1)")).toBe(false);
  });

  it("keeps only plain media addresses", () => {
    expect(isStorableAddress("/media/choir.jpg")).toBe(true);
    expect(isStorableAddress("/media/2024/05/choir.jpg")).toBe(true);
    expect(isStorableAddress("/media/a b.jpg")).toBe(false);
    expect(isStorableAddress("/media/../code/head.html")).toBe(false);
    expect(isStorableAddress("/about")).toBe(false);
  });

  it("gives a stored file's public address", () => {
    expect(storedMediaUrl(storage, "/media/choir.jpg")).toBe("https://media.example.org/site/choir.jpg");
    expect(storedMediaUrl(storage, "/media/other.jpg")).toBeUndefined();
    expect(storedMediaUrl(undefined, "/media/choir.jpg")).toBeUndefined();
    expect(storedMediaSizes(storage)).toEqual({
      "https://media.example.org/site/choir.jpg": { width: 1600, height: 900 },
    });
  });

  it("replaces stored addresses in text, leaving others and the ends of other addresses", () => {
    const text = [
      '<img src="/media/choir.jpg" srcset="/media/choir.jpg 2x">',
      "[Sermon](/media/sermon.mp4?t=10) and see /media/sermon.mp4.",
      "url(/media/choir.jpg) /media/other.jpg https://example.org/media/choir.jpg //media/choir.jpg",
      "/media/choir.jpg.old",
    ].join("\n");
    expect(withStoredAddresses(text, storage)).toBe(
      [
        '<img src="https://media.example.org/site/choir.jpg" srcset="https://media.example.org/site/choir.jpg 2x">',
        "[Sermon](https://media.example.org/site/sermon.mp4?t=10) and see https://media.example.org/site/sermon.mp4.",
        "url(https://media.example.org/site/choir.jpg) /media/other.jpg https://example.org/media/choir.jpg //media/choir.jpg",
        "/media/choir.jpg.old",
      ].join("\n"),
    );
  });
});

describe("the site with stored media", () => {
  const files = {
    "content/site.json": { version: 1, title: "Parish", logo: { src: "/media/choir.jpg" } },
    "content/pages/index.json": {
      version: 1,
      data: {
        root: { props: { title: "Home", image: "/media/choir.jpg" } },
        content: [
          { type: "Video", props: { id: "v", file: "/media/sermon.mp4" } },
          { type: "Image", props: { id: "i", src: "/media/kept.jpg" } },
        ],
      },
    },
    "content/media.json": {
      version: 1,
      credits: { "/media/choir.jpg": { title: "Choir", creator: "Ann", source: "Flickr", license: "CC BY 2.0" } },
    },
    "content/styles/custom.css": ".hero { background: url(/media/choir.jpg); }\n",
    [MEDIA_STORAGE_FILE]: storageFile,
  };

  it("loads the stored files", async () => {
    const content = await loadSiteContent(memorySource(files));
    expect(content.mediaStorage).toEqual(storage);
  });

  it("refuses a storage file that names addresses it can't keep", async () => {
    await expect(
      loadSiteContent(
        memorySource({ ...files, [MEDIA_STORAGE_FILE]: { ...storageFile, files: { "/about": { size: 1 } } } }),
      ),
    ).rejects.toThrow(MEDIA_STORAGE_FILE);
  });

  it("shows stored files from the storage's address, as builds see the site", async () => {
    const content = shownContent(await loadSiteContent(memorySource(files)));
    expect(content.settings.logo?.src).toBe("https://media.example.org/site/choir.jpg");
    const page = content.pages[0]?.content.data;
    expect(page?.root.props?.image).toBe("https://media.example.org/site/choir.jpg");
    expect(page?.content.map((block) => Object.values(block.props)[1])).toEqual([
      "https://media.example.org/site/sermon.mp4",
      "/media/kept.jpg",
    ]);
    expect(content.customCss).toContain("url(https://media.example.org/site/choir.jpg)");
    expect(Object.keys(content.credits ?? {})).toEqual(["https://media.example.org/site/choir.jpg"]);
  });

  it("leaves a site without stored media as it is", async () => {
    const { [MEDIA_STORAGE_FILE]: _, ...rest } = files;
    const content = await loadSiteContent(memorySource(rest));
    expect(withStoredMedia(content)).toBe(content);
  });

  it("counts stored files as the site's media in the checks", async () => {
    const content = await loadSiteContent(memorySource(files));
    const missing = checkSite(content, { media: ["/media/kept.jpg"] }).filter(
      (problem) => problem.kind === "missing-media",
    );
    expect(missing).toEqual([]);
    const without = checkSite({ ...content, mediaStorage: undefined }, { media: ["/media/kept.jpg"] });
    expect(without.filter((problem) => problem.kind === "missing-media").length).toBeGreaterThan(0);
  });
});

describe("writing the storage file", () => {
  it("writes files in order, and removes the file without storage", () => {
    const change = mediaStorageFileChange(
      withStoredFiles(storage, { "/media/a.pdf": { size: 10 } }, ["/media/sermon.mp4"]),
    );
    expect(change.path).toBe(MEDIA_STORAGE_FILE);
    const written = JSON.parse("content" in change ? String(change.content) : "{}");
    expect(written).toEqual({
      version: 1,
      plugin: "goodfellow-plugin-s3",
      url: "https://media.example.org/site/",
      files: { "/media/a.pdf": { size: 10 }, "/media/choir.jpg": { size: 120_000, width: 1600, height: 900 } },
    });
    expect(Object.keys(written.files)).toEqual(["/media/a.pdf", "/media/choir.jpg"]);
    expect(mediaStorageFileChange(undefined)).toEqual({ path: MEDIA_STORAGE_FILE, delete: true });
  });
});
