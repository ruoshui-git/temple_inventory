// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { decodeBarcodeImage } from "../src/lib/scanner";

function prepareCanvas() {
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: vi.fn(async () => ({ width: 100, height: 60, close: vi.fn() })),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ width: 1, height: 1 }) as ImageData),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
}

afterEach(() => vi.restoreAllMocks());

it("tries the defaults first, stops at success, and deduplicates by text and format", async () => {
  prepareCanvas();
  const reader = vi.fn(async () => [
    { text: " 123 ", format: "EAN_13" },
    { text: "123", format: "EAN_13" },
    { text: "123", format: "QR_CODE" },
  ]);
  const result = await decodeBarcodeImage(new Blob(["image"]), {
    readBarcodes: reader,
  });
  expect(reader).toHaveBeenCalledOnce();
  expect(reader.mock.calls[0]?.[1]).toEqual({ maxNumberOfSymbols: 8 });
  expect(result).toEqual([
    { text: "123", format: "EAN_13" },
    { text: "123", format: "QR_CODE" },
  ]);
});

it("follows denoise, binarizer, downscale, and rotation attempts in order", async () => {
  prepareCanvas();
  const reader = vi.fn(async () => []);
  await decodeBarcodeImage(new Blob(["image"]), { readBarcodes: reader });
  expect(reader).toHaveBeenCalledTimes(13);
  expect(reader.mock.calls.slice(0, 4).map((call) => call[1])).toEqual([
    { maxNumberOfSymbols: 8 },
    { maxNumberOfSymbols: 8, tryDenoise: true },
    { maxNumberOfSymbols: 8, tryDenoise: true, binarizer: "GlobalHistogram" },
    { maxNumberOfSymbols: 8, tryDenoise: true, binarizer: "FixedThreshold" },
  ]);
  expect(
    reader.mock.calls.slice(4, 7).every((call) => !(call[0] instanceof Blob)),
  ).toBe(true);
});

it("supports cancel before an attempt", async () => {
  prepareCanvas();
  const reader = vi.fn(async () => []);
  const controller = new AbortController();
  controller.abort();
  await expect(
    decodeBarcodeImage(new Blob(["image"]), {
      signal: controller.signal,
      readBarcodes: reader,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(reader).not.toHaveBeenCalled();
});

it("checks cancellation between retry attempts", async () => {
  prepareCanvas();
  const controller = new AbortController();
  const reader = vi.fn(async () => {
    controller.abort();
    return [];
  });
  await expect(
    decodeBarcodeImage(new Blob(["image"]), {
      signal: controller.signal,
      readBarcodes: reader,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(reader).toHaveBeenCalledOnce();
});
