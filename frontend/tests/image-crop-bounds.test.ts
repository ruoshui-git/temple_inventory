import { expect, it } from "vitest";
import {
  clampSquareSelection,
  clampSelectionToBounds,
  fitImageAspect,
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
});

it("fits square and wide images into a stage without changing their aspect", () => {
  expect(fitImageAspect(512, 448, 320, 320)).toEqual({
    width: 448,
    height: 448,
  });
  expect(fitImageAspect(512, 448, 480, 240)).toEqual({
    width: 512,
    height: 256,
  });
});

it("shrinks a crop selection when the transformed source no longer fits its size", () => {
  expect(
    clampSquareSelection(
      { x: -12, y: 80, width: 260, height: 250 },
      { left: 30, top: 20, right: 180, bottom: 110 },
    ),
  ).toEqual({ x: 30, y: 20, width: 90, height: 90 });
});

it("clamps each free aspect drag proposal to the image edge", () => {
  const bounds = { left: 20, top: 30, right: 220, bottom: 180 };
  expect(
    clampSelectionToBounds({ x: 190, y: 140, width: 80, height: 50 }, bounds),
  ).toEqual({ x: 140, y: 130, width: 80, height: 50 });
  expect(
    clampSelectionToBounds({ x: 10, y: 20, width: 240, height: 190 }, bounds),
  ).toEqual({ x: 20, y: 30, width: 200, height: 150 });
});
