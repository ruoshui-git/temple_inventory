import { expect, it } from "vitest";
import {
  clampSelectionToBounds,
  fitImageAspect,
  imageBoundsInCanvas,
} from "../src/lib/imageCropBounds";

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

it("clamps each free aspect drag proposal to the image edge", () => {
  const bounds = { left: 20, top: 30, right: 220, bottom: 180 };
  expect(
    clampSelectionToBounds({ x: 190, y: 140, width: 80, height: 50 }, bounds),
  ).toEqual({ x: 140, y: 130, width: 80, height: 50 });
  expect(
    clampSelectionToBounds({ x: 10, y: 20, width: 240, height: 190 }, bounds),
  ).toEqual({ x: 20, y: 30, width: 200, height: 150 });
});
