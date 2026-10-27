import { expect, it } from "vitest";
import {
  clampSquareSelection,
  cropBoundsInset,
  imageBoundsInCanvas,
  largestCenteredSquare,
} from "../src/lib/imageCropBounds";

it("starts with the largest centered square only after layout is nonzero", () => {
  expect(
    largestCenteredSquare({ left: 20, top: 10, right: 420, bottom: 310 }),
  ).toEqual({
    x: 70,
    y: 10,
    width: 300,
    height: 300,
  });
  expect(
    largestCenteredSquare({ left: 0, top: 0, right: 0, bottom: 0 }),
  ).toEqual({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
});

it("keeps the crop square inside the transformed source image after zooming out", () => {
  const bounds = imageBoundsInCanvas(
    { left: 140, top: 80, right: 440, bottom: 380 },
    { left: 100, top: 40 },
  );
  expect(bounds).toEqual({ left: 40, top: 40, right: 340, bottom: 340 });
  expect(
    clampSquareSelection({ x: 260, y: 290, width: 180, height: 180 }, bounds),
  ).toEqual({ x: 160, y: 160, width: 180, height: 180 });
  expect(cropBoundsInset(bounds, 400, 400)).toBe("40px 60px 60px 40px");
});

it("shrinks a crop selection when the transformed source no longer fits its size", () => {
  expect(
    clampSquareSelection(
      { x: -12, y: 80, width: 260, height: 250 },
      { left: 30, top: 20, right: 180, bottom: 110 },
    ),
  ).toEqual({ x: 30, y: 20, width: 90, height: 90 });
});
