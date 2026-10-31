import { describe, expect, it } from "vitest";
import {
  canCrop,
  changesPicture,
  cropPixels,
  croppedName,
  croppedType,
  fittedBox,
  MIN_CROP,
  movedBox,
  nextTurn,
  resizedBox,
  turnedSize,
} from "./crop.js";

describe("cropping", () => {
  it("turns a picture a quarter at a time", () => {
    expect(turnedSize(400, 300, 90)).toEqual({ width: 300, height: 400 });
    expect(turnedSize(400, 300, 180)).toEqual({ width: 400, height: 300 });
    expect(nextTurn(0, -1)).toBe(270);
    expect(nextTurn(270, 1)).toBe(0);
  });

  it("fits the largest box of a shape in the middle", () => {
    expect(fittedBox(400, 300, undefined)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    const square = fittedBox(400, 300, 1);
    expect(square).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
    const wide = fittedBox(400, 300, 16 / 9);
    expect(wide.width).toBe(1);
    expect(wide.height * 300).toBeCloseTo(225);
  });

  it("keeps the box inside the picture when it moves", () => {
    const box = { x: 0.5, y: 0.5, width: 0.4, height: 0.4 };
    expect(movedBox(box, 0.5, -0.9)).toEqual({ ...box, x: 0.6, y: 0 });
  });

  it("keeps the box's shape, size and place inside the picture when it's resized", () => {
    const picture = { width: 400, height: 300 };
    const free = resizedBox({ x: 0.5, y: 0.5, width: 0.2, height: 0.2 }, 0.9, 0.001, picture, undefined);
    expect(free).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: MIN_CROP });
    const square = resizedBox({ x: 0, y: 0.5, width: 0.2, height: 0.2 }, 0.9, 0.2, picture, 1);
    // Half the picture's height is 150 pixels, so a square can be 150 wide.
    expect(square.height).toBeCloseTo(0.5);
    expect(square.width * 400).toBeCloseTo(150);
  });

  it("works out the pixels a crop keeps", () => {
    expect(cropPixels({ x: 0.25, y: 0, width: 0.5, height: 1 }, { width: 400, height: 300 })).toEqual({
      x: 100,
      y: 0,
      width: 200,
      height: 300,
    });
    expect(changesPicture({ x: 0, y: 0, width: 1, height: 1 }, 0)).toBe(false);
    expect(changesPicture({ x: 0, y: 0, width: 1, height: 1 }, 90)).toBe(true);
  });

  it("names and types what it saves, and crops only photos", () => {
    expect(croppedName("choir.jpg")).toBe("choir-cropped.jpg");
    expect(croppedType("/media/a.PNG")).toBe("image/png");
    expect(croppedType("/media/a.jpeg")).toBe("image/jpeg");
    expect(canCrop("/media/logo.svg")).toBe(false);
    expect(canCrop("/media/wave.gif")).toBe(false);
    expect(canCrop("/media/a.webp")).toBe(true);
  });
});
