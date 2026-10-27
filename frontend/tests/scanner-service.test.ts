// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cameraListPresentation,
  ScannerService,
  type ScannerCamera,
  type ScannerEngine,
} from "../src/lib/scanner";
function engine(deviceId?: string) {
  return {
    id: "zxing-wasm",
    label: "ZXing-WASM",
    deviceId,
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
    value: {
      getUserMedia: vi.fn(),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
    configurable: true,
  });
});
describe("ZXing-only ScannerService", () => {
  it("chooses the correct camera-list presentation", () => {
    const rows: ScannerCamera[] = [{ deviceId: "one", label: "摄像头 1" }];
    expect(cameraListPresentation([])).toBe("hidden");
    expect(cameraListPresentation(rows)).toBe("static");
    expect(
      cameraListPresentation([
        ...rows,
        { deviceId: "two", label: "后置摄像头" },
      ]),
    ).toBe("select");
  });
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
  it("lists permission-revealed cameras with numbered fallback labels", async () => {
    const mediaDevices = navigator.mediaDevices as MediaDevices;
    vi.mocked(mediaDevices.enumerateDevices).mockResolvedValue([
      {
        kind: "audioinput",
        deviceId: "mic",
        label: "Microphone",
      } as MediaDeviceInfo,
      { kind: "videoinput", deviceId: "rear", label: "" } as MediaDeviceInfo,
      {
        kind: "videoinput",
        deviceId: "front",
        label: "Built-in camera",
      } as MediaDeviceInfo,
    ]);
    const service = new ScannerService();
    await expect(service.enumerateCameras()).resolves.toEqual([
      { deviceId: "rear", label: "摄像头 1" },
      {
        deviceId: "front",
        label: "Built-in camera",
        stableLabel: "Built-in camera",
      },
    ]);
  });
  it("opens the requested device, remembers the successfully opened device and tolerates storage failure", async () => {
    const wasm = engine("opened-camera"),
      service = new ScannerService({ "zxing-wasm": () => wasm });
    await service.start(
      document.createElement("div"),
      vi.fn(),
      undefined,
      "selected-camera",
    );
    expect(wasm.start).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.any(Function),
      undefined,
      "selected-camera",
      undefined,
    );
    expect(service.cameraDeviceId).toBe("opened-camera");
    expect(localStorage.getItem("temple_inventory.scanner_device")).toBe(
      "opened-camera",
    );
    await service.stop();

    const deniedStorage = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    const second = new ScannerService({
      "zxing-wasm": () => engine("another-camera"),
    });
    await expect(
      second.start(document.createElement("div"), vi.fn()),
    ).resolves.toBeUndefined();
    await second.stop();
    deniedStorage.mockRestore();
  });
  it("persists only the actual browser label alongside the opened device ID", async () => {
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
      {
        kind: "videoinput",
        deviceId: "opened-camera",
        label: "USB camera",
      } as MediaDeviceInfo,
    ]);
    const service = new ScannerService({
      "zxing-wasm": () => engine("opened-camera"),
    });
    await service.start(document.createElement("div"), vi.fn());
    expect(service.cameraLabel).toBe("USB camera");
    expect(localStorage.getItem("temple_inventory.scanner_device")).toBe(
      "opened-camera",
    );
    expect(localStorage.getItem("temple_inventory.scanner_label")).toBe(
      "USB camera",
    );
    await service.stop();

    vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
      {
        kind: "videoinput",
        deviceId: "opened-camera",
        label: "",
      } as MediaDeviceInfo,
    ]);
    const relabeled = new ScannerService({
      "zxing-wasm": () => engine("opened-camera"),
    });
    await relabeled.start(document.createElement("div"), vi.fn());
    expect(relabeled.cameraLabel).toBe("");
    expect(localStorage.getItem("temple_inventory.scanner_label")).toBeNull();
    await relabeled.stop();
  });
  it("serializes device switches by stopping the prior stream before opening the next", async () => {
    const order: string[] = [];
    const first = engine(),
      second = engine();
    first.start.mockImplementation(async () => {
      order.push("start-first");
    });
    first.stop.mockImplementation(async () => {
      order.push("stop-first");
    });
    second.start.mockImplementation(async () => {
      order.push("start-second");
    });
    const factories = [first, second];
    const service = new ScannerService({
      "zxing-wasm": () => factories.shift()!,
    });
    await service.start(
      document.createElement("div"),
      vi.fn(),
      undefined,
      "rear",
    );
    await service.start(
      document.createElement("div"),
      vi.fn(),
      undefined,
      "front",
    );
    expect(order).toEqual(["start-first", "stop-first", "start-second"]);
    await service.stop();
  });
  it("does not let a stale deferred engine startup replace the newest device", async () => {
    const order: string[] = [];
    let resolveFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const first = engine("first-device");
    first.start.mockImplementation(async () => {
      order.push("start-first");
      markFirstStarted();
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
    });
    first.stop.mockImplementation(async () => {
      order.push("stop-first");
    });
    const second = engine("second-device");
    second.start.mockImplementation(async () => {
      order.push("start-second");
    });
    const factories = [first, second];
    const service = new ScannerService({
      "zxing-wasm": () => factories.shift()!,
    });
    const firstStart = service.start(
      document.createElement("div"),
      vi.fn(),
      undefined,
      "first-device",
    );
    await firstStarted;
    const secondStart = service.start(
      document.createElement("div"),
      vi.fn(),
      undefined,
      "second-device",
    );
    resolveFirst();
    await Promise.all([firstStart, secondStart]);
    expect(order).toEqual(["start-first", "stop-first", "start-second"]);
    expect(service.cameraDeviceId).toBe("second-device");
    await service.stop();
  });
});
