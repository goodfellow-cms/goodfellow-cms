/** An image's size in pixels. */
export interface ImageSize {
  width: number;
  height: number;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function pngSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (bytes.length < 24 || ascii(bytes, 1, 3) !== "PNG" || ascii(bytes, 12, 4) !== "IHDR") return undefined;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gifSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (bytes.length < 10 || !/^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return undefined;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

/**
 * The orientation an Exif segment (a JPEG's APP1, from its marker on) gives
 * a photo, 1 to 8 as Exif numbers them, or `undefined` where it says none.
 * Phones save photos as their sensor took them and say how to turn them.
 */
export function exifOrientation(segment: Uint8Array): number | undefined {
  const exif = 10;
  if (segment.length < exif + 8 || String.fromCharCode(...segment.subarray(4, 8)) !== "Exif") return undefined;
  const little = segment[exif] === 0x49;
  const read16 = (offset: number) =>
    little
      ? (segment[exif + offset] ?? 0) | ((segment[exif + offset + 1] ?? 0) << 8)
      : ((segment[exif + offset] ?? 0) << 8) | (segment[exif + offset + 1] ?? 0);
  const read32 = (offset: number) =>
    little ? read16(offset) | (read16(offset + 2) << 16) : (read16(offset) << 16) | read16(offset + 2);
  const ifd = read32(4);
  const count = read16(ifd);
  for (let entry = 0; entry < count && exif + ifd + 2 + entry * 12 + 12 <= segment.length; entry++) {
    const at = ifd + 2 + entry * 12;
    if (read16(at) === 0x0112) {
      const orientation = read16(at + 8);
      return orientation >= 1 && orientation <= 8 ? orientation : undefined;
    }
  }
  return undefined;
}

/**
 * Reads the frame header (SOF), skipping other segments, with width and
 * height swapped where Exif says the photo is shown turned a quarter, as
 * browsers show it.
 */
function jpegSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  let orientation: number | undefined;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && orientation === undefined) {
      orientation = exifOrientation(bytes.subarray(offset, offset + 2 + length));
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const width = view.getUint16(offset + 7);
      const height = view.getUint16(offset + 5);
      return orientation !== undefined && orientation >= 5 ? { width: height, height: width } : { width, height };
    }
    offset += 2 + length;
  }
  return undefined;
}

function joined(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** PNG chunks that hold details about the file rather than the picture: Exif, text, and when it was made. */
const PNG_DETAILS = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

/**
 * A PNG or WebP without the details hidden in it, such as where a photo was
 * taken (Exif) and who made it (text and XMP), and otherwise as it was, so
 * nothing is re-saved and animations keep moving. Anything else, or a file
 * that can't be read, comes back as it is.
 */
export function withoutImageDetails(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 8 && ascii(bytes, 1, 3) === "PNG") {
    const kept: Uint8Array[] = [bytes.subarray(0, 8)];
    let at = 8;
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at);
      const end = at + 12 + length;
      if (end > bytes.length) return bytes;
      if (!PNG_DETAILS.has(ascii(bytes, at + 4, 4))) kept.push(bytes.subarray(at, end));
      at = end;
    }
    return at === bytes.length ? joined(kept) : bytes;
  }
  if (bytes.length > 20 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    if (ascii(bytes, 12, 4) !== "VP8X") return bytes;
    const kept: Uint8Array[] = [];
    let at = 12;
    while (at + 8 <= bytes.length) {
      const length = view.getUint32(at + 4, true);
      // Chunks are padded to an even length.
      const end = at + 8 + length + (length % 2);
      if (end > bytes.length) return bytes;
      const name = ascii(bytes, at, 4);
      if (name !== "EXIF" && name !== "XMP ") kept.push(bytes.subarray(at, end));
      at = end;
    }
    if (at !== bytes.length) return bytes;
    const body = joined(kept);
    // The extended header says which chunks follow: no longer Exif (0x08) or XMP (0x04).
    body[8] = (body[8] ?? 0) & ~0x0c;
    const header = new Uint8Array(12);
    header.set(bytes.subarray(0, 12));
    new DataView(header.buffer).setUint32(4, body.length + 4, true);
    return joined([header, body]);
  }
  return bytes;
}

function webpSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return undefined;
  const chunk = ascii(bytes, 12, 4);
  const at = (index: number) => bytes[index] ?? 0;
  if (chunk === "VP8X") {
    return {
      width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)),
      height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)),
    };
  }
  if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  if (chunk === "VP8L") {
    return {
      width: 1 + (((at(22) & 0x3f) << 8) | at(21)),
      height: 1 + (((at(24) & 0x0f) << 10) | (at(23) << 2) | ((at(22) & 0xc0) >> 6)),
    };
  }
  return undefined;
}

/** A length in an SVG's width or height, in pixels; percentages and other units can't be known. */
function svgLength(value: string | undefined): number | undefined {
  const match = value && /^(\d+(?:\.\d+)?)(?:\s*px)?$/.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

function svgSize(bytes: Uint8Array): ImageSize | undefined {
  const text = new TextDecoder().decode(bytes.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return undefined;
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  const width = svgLength(attribute("width"));
  const height = svgLength(attribute("height"));
  if (width && height) return { width, height };
  const box = attribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && (box[2] ?? 0) > 0 && (box[3] ?? 0) > 0) {
    const [, , boxWidth = 0, boxHeight = 0] = box;
    if (width) return { width, height: (width * boxHeight) / boxWidth };
    if (height) return { width: (height * boxWidth) / boxHeight, height };
    return { width: boxWidth, height: boxHeight };
  }
  return undefined;
}

/**
 * The size of a PNG, JPEG, GIF, WebP or SVG image, read from the start of its
 * file, or `undefined` for other formats and files it can't read.
 */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const size =
      pngSize(bytes, view) ?? gifSize(bytes, view) ?? jpegSize(bytes, view) ?? webpSize(bytes, view) ?? svgSize(bytes);
    return size && size.width > 0 && size.height > 0 ? size : undefined;
  } catch {
    // A truncated file reads past its end.
    return undefined;
  }
}
