import { type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import {
  allMedia,
  formatSize,
  isStoredMedia,
  mediaKind,
  mediaPath,
  mediaUrl,
  mediaUsage,
  uploadName,
} from "./media.js";

describe("media addresses", () => {
  it("maps files to addresses and back", () => {
    expect(mediaUrl("public/media/photo.jpg")).toBe("/media/photo.jpg");
    expect(mediaUrl("public/media/2026/easter.png")).toBe("/media/2026/easter.png");
    expect(mediaPath("/media/photo.jpg?v=2")).toBe("public/media/photo.jpg");
    expect(mediaPath("/media/my%20photo.jpg")).toBe("public/media/my photo.jpg");
  });

  it.each(["/images/a.jpg", "/media/", "/media/../secret", "https://example.org/media/a.jpg"])("ignores %s", (url) => {
    expect(mediaPath(url)).toBeUndefined();
  });
});

describe("uploads", () => {
  it("allows images, documents, audio and video, but nothing that could run code", () => {
    expect(mediaKind("a.JPG")).toBe("image");
    expect(mediaKind("bulletin.pdf")).toBe("document");
    expect(mediaKind("homily.mp3")).toBe("audio");
    for (const name of ["page.html", "script.js", "data.xml", "noextension"]) expect(mediaKind(name)).toBeUndefined();
  });

  it("names uploads with lowercase letters and hyphens, avoiding names in use", () => {
    expect(uploadName("Easter Vigil (1).JPEG", [])).toBe("easter-vigil-1.jpg");
    expect(uploadName("photo.jpg", ["photo.jpg", "photo-2.jpg", "photo.png"])).toBe("photo-3.jpg");
    expect(uploadName("photo.png", ["photo.jpg"])).toBe("photo.png");
    expect(uploadName("!!!.pdf", [])).toBe("file.pdf");
  });

  it("writes sizes in words", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("mediaUsage", () => {
  it("finds every page, layout, setting and entry that uses a file", () => {
    const content: SiteContent = {
      settings: siteSettingsSchema.parse({ version: 1, logo: { src: "/media/logo.svg", alt: "" } }),
      menus: {},
      header: { version: 1, data: { root: {}, content: [] } },
      footer: { version: 1, data: { root: {}, content: [] } },
      pages: [
        {
          path: "/about",
          file: "content/pages/about.json",
          content: {
            version: 1,
            data: {
              root: { props: { title: "About" } },
              content: [{ type: "Image", props: { id: "i", src: "/media/a.jpg" } }],
            },
          },
        },
      ],
      collections: [],
      customCss: ".hero { background: url(/media/a.jpg); }",
    };
    const names = { header: "Header", footer: "Footer", settings: "Site settings", css: "Custom CSS" };
    expect(mediaUsage(content, "/media/a.jpg", names)).toEqual(["About", "Custom CSS"]);
    expect(mediaUsage(content, "/media/logo.svg", names)).toEqual(["Site settings"]);
    expect(mediaUsage(content, "/media/unused.png", names)).toEqual([]);
  });
});

describe("media a plugin keeps", () => {
  const content = {
    mediaStorage: {
      plugin: "goodfellow-plugin-s3",
      url: "https://media.example.org",
      files: { "/media/sermon.mp4": { size: 900_000_000 }, "/media/choir.jpg": { size: 10 } },
    },
  };

  it("is listed with the site's own files, once each", () => {
    expect(allMedia(content, ["public/media/logo.png", "public/media/choir.jpg"])).toEqual([
      "public/media/logo.png",
      "public/media/choir.jpg",
      "public/media/sermon.mp4",
    ]);
    expect(allMedia({}, ["public/media/logo.png"])).toEqual(["public/media/logo.png"]);
    expect(isStoredMedia(content, "/media/sermon.mp4")).toBe(true);
    expect(isStoredMedia(content, "/media/logo.png")).toBe(false);
  });
});
