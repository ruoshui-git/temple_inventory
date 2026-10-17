import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScannerService, type ScannerEngine } from "../src/lib/scanner";
function engine() {
  return {
    id: "zxing-wasm",
    label: "ZXing-WASM",
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  } satisfies ScannerEngine;
}
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });
});
describe("ZXing-only ScannerService", () => {
  it.each(["frappe", "other", "zxing-wasm"])(
    "ignores the retired saved engine %s",
    async (stored) => {
      localStorage.setItem("temple_inventory.scanner_engine", stored);
      const wasm = engine(),
        service = new ScannerService({ "zxing-wasm": () => wasm });
      await service.start(document.createElement("div"), vi.fn());
      expect(service.engineId).toBe("zxing-wasm");
      expect(wasm.start).toHaveBeenCalledOnce();
      expect(
        localStorage.getItem("temple_inventory.scanner_engine"),
      ).toBeNull();
      await service.stop();
      expect(wasm.stop).toHaveBeenCalledOnce();
    },
  );
  it("cleans up a failed startup before retrying the same decoder", async () => {
    const wasm = engine();
    wasm.start.mockRejectedValueOnce(new Error("denied"));
    const service = new ScannerService({ "zxing-wasm": () => wasm });
    await expect(
      service.start(document.createElement("div"), vi.fn()),
    ).rejects.toThrow("denied");
    expect(wasm.stop).toHaveBeenCalledOnce();
    await service.start(document.createElement("div"), vi.fn());
    await service.stop();
    expect(wasm.stop).toHaveBeenCalledTimes(2);
  });
});
