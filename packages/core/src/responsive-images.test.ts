import { describe, expect, it } from "vitest";
import { IMAGE_WIDTHS, imageSrcSet, imageVariantPath, imageWidths } from "./responsive-images.js";

describe("imageWidths", () => {
  it("makes copies of the media library's photos only, smaller than they are", () => {
    expect(imageWidths("/media/photo.jpg", { width: 1300, height: 800 })).toEqual([480, 800, 1200]);
    expect(imageWidths("/media/a/b.PNG", { width: 2400, height: 800 })).toEqual([...IMAGE_WIDTHS]);
    expect(imageWidths("/media/small.webp", { width: 400, height: 300 })).toEqual([]);
    for (const src of ["/media/logo.svg", "/media/moving.gif", "https://example.org/photo.jpg", "/photo.jpg"]) {
      expect(imageWidths(src, { width: 3000, height: 2000 }), src).toEqual([]);
    }
    expect(imageWidths("/media/photo.jpg", undefined)).toEqual([]);
  });
});

describe("imageSrcSet", () => {
  it("lists each copy, then the photo itself", () => {
    expect(imageVariantPath("/media/news/photo.jpg", 800)).toBe("/media-sizes/800/news/photo.jpg.webp");
    expect(imageSrcSet("/media/photo.jpg", { width: 900, height: 600 })).toBe(
      "/media-sizes/480/photo.jpg.webp 480w, /media-sizes/800/photo.jpg.webp 800w, /media/photo.jpg 900w",
    );
    expect(imageSrcSet("/media/photo.jpg", { width: 400, height: 300 })).toBeUndefined();
  });
});
