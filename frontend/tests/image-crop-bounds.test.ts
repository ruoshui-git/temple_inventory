import { expect, it } from "vitest";
import {
  clampSquareSelection,
  cropBoundsInset,
  imageBoundsInCanvas,
} from "../src/lib/imageCropBounds";

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
