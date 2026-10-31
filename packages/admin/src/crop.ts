/**
 * The arithmetic of cropping and turning a picture in the browser, kept apart
 * from drawing so it's tested on its own. A crop is a box in fractions of the
 * picture as turned: `x` and `y` its top left corner, `width` and `height`
 * its size, each from 0 to 1.
 */

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A quarter turn clockwise, as many times as given: 0, 90, 180 or 270 degrees. */
export type Turn = 0 | 90 | 180 | 270;

/** The shapes a crop can keep, as width over height, or `undefined` for any. */
export const CROP_SHAPES = {
  free: undefined,
  square: 1,
  photo: 4 / 3,
  wide: 16 / 9,
} as const;
export type CropShape = keyof typeof CROP_SHAPES;

/** The smallest a crop can be, as a fraction of the picture's side. */
export const MIN_CROP = 0.05;

/** A picture's size once turned. */
export function turnedSize(width: number, height: number, turn: Turn): { width: number; height: number } {
  return turn === 90 || turn === 270 ? { width: height, height: width } : { width, height };
}

/** The next turn, a quarter clockwise (`1`) or anticlockwise (`-1`). */
export function nextTurn(turn: Turn, direction: 1 | -1): Turn {
  return ((((turn + direction * 90) % 360) + 360) % 360) as Turn;
}

/** The largest box of a shape that fits in the middle of a picture of this size. */
export function fittedBox(width: number, height: number, ratio: number | undefined): CropBox {
  if (!ratio) return { x: 0, y: 0, width: 1, height: 1 };
  const wide = width / height > ratio;
  const box = wide ? { width: (height * ratio) / width, height: 1 } : { width: 1, height: width / ratio / height };
  return { x: (1 - box.width) / 2, y: (1 - box.height) / 2, ...box };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The box moved by a distance in fractions, kept inside the picture. */
export function movedBox(box: CropBox, dx: number, dy: number): CropBox {
  return { ...box, x: clamp(box.x + dx, 0, 1 - box.width), y: clamp(box.y + dy, 0, 1 - box.height) };
}

/**
 * The box with its bottom right corner moved to a width in fractions (and a
 * height, for any shape), keeping its shape where it has one, its top left
 * corner where it is, and itself inside the picture.
 */
export function resizedBox(
  box: CropBox,
  width: number,
  height: number,
  picture: { width: number; height: number },
  ratio: number | undefined,
): CropBox {
  let w = clamp(width, MIN_CROP, 1 - box.x);
  let h = clamp(height, MIN_CROP, 1 - box.y);
  if (ratio) {
    // In pixels, width over height is the ratio.
    h = (w * picture.width) / ratio / picture.height;
    if (h > 1 - box.y) {
      h = 1 - box.y;
      w = (h * picture.height * ratio) / picture.width;
    }
    if (h < MIN_CROP) {
      h = MIN_CROP;
      w = Math.min(1 - box.x, (h * picture.height * ratio) / picture.width);
    }
  }
  return { ...box, width: w, height: h };
}

/** The part of the turned picture a box keeps, in whole pixels, at least one on each side. */
export function cropPixels(
  box: CropBox,
  picture: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const x = Math.round(box.x * picture.width);
  const y = Math.round(box.y * picture.height);
  return {
    x,
    y,
    width: Math.max(1, Math.min(picture.width - x, Math.round(box.width * picture.width))),
    height: Math.max(1, Math.min(picture.height - y, Math.round(box.height * picture.height))),
  };
}

/** Whether a crop and turn change the picture at all. */
export function changesPicture(box: CropBox, turn: Turn): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
  return turn !== 0 || !near(box.x, 0) || !near(box.y, 0) || !near(box.width, 1) || !near(box.height, 1);
}

/** The name a cropped copy is saved under: `choir.jpg` becomes `choir-cropped.jpg`. */
export function croppedName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-cropped${name.slice(dot)}` : `${name}-cropped`;
}

/** The pictures that can be cropped in the browser: photos, never SVGs, nor GIFs, which may move. */
export function canCrop(name: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(name);
}

/** The file type a cropped picture is saved as, the same as its own. */
export function croppedType(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
}
