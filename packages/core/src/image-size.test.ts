import { describe, expect, it } from "vitest";
import { imageSize, withoutImageDetails } from "./image-size.js";

function bytes(...parts: Array<string | number[]>): Uint8Array {
  return new Uint8Array(
    parts.flatMap((part) => (typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part)),
  );
}

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le32 = (n: number) => [...le16(n & 0xffff), ...le16(n >>> 16)];

/** A JPEG's Exif segment, big-endian, with just an orientation. */
function exif(orientation: number): number[] {
  const tiff = [
    "M".charCodeAt(0),
    "M".charCodeAt(0),
    0,
    42,
    ...be32(8),
    0,
    1,
    0x01,
    0x12,
    0,
    3,
    ...be32(1),
    0,
    orientation,
    0,
    0,
    ...be32(0),
  ];
  const body = [..."Exif"].map((c) => c.charCodeAt(0)).concat([0, 0], tiff);
  return [0xff, 0xe1, ((body.length + 2) >> 8) & 255, (body.length + 2) & 255, ...body];
}

/** A PNG chunk, with a made-up CRC, which nothing here checks. */
const chunk = (name: string, data: number[] = []) => bytes(be32(data.length), name, data, [0, 0, 0, 0]);

describe("imageSize", () => {
  it("reads PNG, GIF and JPEG headers", () => {
    expect(imageSize(bytes([0x89], "PNG", [13, 10, 26, 10], be32(13), "IHDR", be32(640), be32(480)))).toEqual({
      width: 640,
      height: 480,
    });
    expect(imageSize(bytes("GIF89a", le16(32), le16(16)))).toEqual({ width: 32, height: 16 });
    const app0 = [0xff, 0xe0, 0, 4, 0, 0];
    const sof0 = [0xff, 0xc0, 0, 17, 8, 0x04, 0x38, 0x07, 0x80, 3];
    expect(imageSize(bytes([0xff, 0xd8], app0, sof0))).toEqual({ width: 1920, height: 1080 });
  });

  it("swaps a JPEG's width and height where Exif says it's shown turned a quarter", () => {
    const sof0 = [0xff, 0xc0, 0, 17, 8, 0x0b, 0xd0, 0x0f, 0xc0, 3]; // 4032 × 3024, as the sensor took it
    expect(imageSize(bytes([0xff, 0xd8], exif(6), sof0))).toEqual({ width: 3024, height: 4032 });
    expect(imageSize(bytes([0xff, 0xd8], exif(3), sof0))).toEqual({ width: 4032, height: 3024 });
    expect(imageSize(bytes([0xff, 0xd8], exif(8), sof0))).toEqual({ width: 3024, height: 4032 });
  });

  it("takes the details out of PNGs and WebPs, keeping everything else as it was", () => {
    const signature = bytes([0x89], "PNG", [13, 10, 26, 10]);
    const ihdr = chunk("IHDR", [...be32(1), ...be32(1), 8, 6, 0, 0, 0]);
    const idat = chunk("IDAT", [1, 2, 3]);
    const iend = chunk("IEND");
    const png = new Uint8Array([
      ...signature,
      ...ihdr,
      ...chunk("eXIf", [1, 2]),
      ...chunk("tEXt", [65, 0, 66]),
      ...idat,
      ...iend,
    ]);
    expect([...withoutImageDetails(png)]).toEqual([...signature, ...ihdr, ...idat, ...iend]);

    const vp8x = bytes("VP8X", le32(10), [0x0c | 0x10, 0, 0, 0], [0, 0, 0, 0, 0, 0]);
    const image = bytes("VP8L", le32(3), [1, 2, 3, 0]);
    const details = bytes("EXIF", le32(1), [9, 0], "XMP ", le32(2), [7, 7]);
    const body = new Uint8Array([..."WEBP"].map((c) => c.charCodeAt(0)).concat([...vp8x, ...image, ...details]));
    const webp = new Uint8Array([...bytes("RIFF", le32(body.length)), ...body]);
    const cleaned = withoutImageDetails(webp);
    const kept = [...vp8x, ...image];
    kept[8] = 0x10; // Only the alpha flag is left.
    expect([...cleaned]).toEqual([...bytes("RIFF", le32(kept.length + 4), "WEBP"), ...kept]);
    // Anything it can't read comes back as it was.
    expect(withoutImageDetails(png.subarray(0, 20))).toEqual(png.subarray(0, 20));
  });

  it("reads extended WebP headers", () => {
    const size = [0x7f, 0x02, 0x00, 0xdf, 0x01, 0x00]; // 640 × 480, stored minus one
    expect(imageSize(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8X", [10, 0, 0, 0], [0, 0, 0, 0], size))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("reads SVGs' sizes, or their viewBox", () => {
    expect(imageSize(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32">'))).toEqual({
      width: 64,
      height: 32,
    });
    expect(imageSize(bytes('<?xml version="1.0"?><svg viewBox="0 0 1200 675">'))).toEqual({ width: 1200, height: 675 });
    expect(imageSize(bytes('<svg width="100%" height="100%">'))).toBeUndefined();
    expect(imageSize(bytes('<svg width=" 64 px " height="32px">'))).toEqual({ width: 64, height: 32 });
  });

  it("gives up on other and broken files", () => {
    expect(imageSize(bytes("%PDF-1.4"))).toBeUndefined();
    expect(imageSize(bytes([0x89], "PNG"))).toBeUndefined();
    expect(imageSize(bytes([0xff, 0xd8, 0xff]))).toBeUndefined();
  });
});
