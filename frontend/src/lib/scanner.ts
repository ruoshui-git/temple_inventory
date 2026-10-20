import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

export type ScannerEngineId = "zxing-wasm";
export interface ScannerEngine {
  readonly id: ScannerEngineId;
  readonly label: string;
  readonly deviceId?: string;
  start(
    container: HTMLElement,
    onScan: (value: string) => void,
    onError?: (error: unknown) => void,
    deviceId?: string,
  ): Promise<void>;
  stop(): Promise<void>;
}

export interface ScannerCamera {
  deviceId: string;
  label: string;
  /** The browser-provided label, omitted when the permission-gated label is blank. */
  stableLabel?: string;
}

export function cameraError(e: any) {
  const message = String(e?.name || e?.message || e);
  if (/NotAllowed|Permission|denied/i.test(message))
    return "相机权限被拒绝，请在浏览器设置中允许使用相机。也可手动输入。";
  if (/NotFound|DevicesNotFound/i.test(message))
    return "未找到相机，请使用手动输入或扫码枪。";
  if (/NotReadable|TrackStart/i.test(message))
    return "相机正在被其他程序使用，请关闭后重试。";
  return `无法启动相机：${message}`;
}

let zxingReady: Promise<unknown> | undefined;
let zxingModule: Promise<typeof import("zxing-wasm/reader")> | undefined;
function loadZXing() {
  if (!zxingModule) {
    zxingModule = import("zxing-wasm/reader").catch((error) => {
      zxingModule = undefined;
      throw error;
    });
  }
  return zxingModule;
}
function prepareReader() {
  return (zxingReady ||= loadZXing()
    .then(({ prepareZXingModule }) =>
      prepareZXingModule({
        fireImmediately: true,
        overrides: { locateFile: () => zxingWasmUrl },
      }),
    )
    .catch((error) => {
      zxingReady = undefined;
      throw error;
    }));
}

export class ZxingWasmScannerEngine implements ScannerEngine {
  readonly id = "zxing-wasm" as const;
  readonly label = "ZXing-WASM";
  private video?: HTMLVideoElement;
  private stream?: MediaStream;
  private container?: HTMLElement;
  private startup?: Promise<void>;
  private canvas?: HTMLCanvasElement;
  private context?: CanvasRenderingContext2D;
  private cancelVideoWait?: () => void;
  private generation = 0;
  private openedDeviceId?: string;
  get deviceId() {
    return this.openedDeviceId;
  }
  private timer?: ReturnType<typeof setTimeout>;
  private decoding = false;
  private lastDecodeError = 0;
  async start(
    container: HTMLElement,
    onScan: (value: string) => void,
    onError?: (error: unknown) => void,
    deviceId?: string,
  ) {
    await this.stop();
    const generation = ++this.generation;
    this.container = container;
    this.startup = this.startInternal(
      container,
      generation,
      onScan,
      onError,
      deviceId,
    );
    try {
      await this.startup;
    } catch (error) {
      this.startup = undefined;
      await this.stop();
      throw error;
    } finally {
      this.startup = undefined;
    }
  }
  private async startInternal(
    container: HTMLElement,
    generation: number,
    onScan: (value: string) => void,
    onError?: (error: unknown) => void,
    deviceId?: string,
  ) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "environment" } },
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    this.openedDeviceId =
      stream.getVideoTracks?.()[0]?.getSettings?.().deviceId || deviceId;
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    container.replaceChildren(video);
    this.video = video;
    await this.waitForVideo(video);
    if (generation !== this.generation) return;
    await video.play();
    if (generation !== this.generation) return;
    await prepareReader();
    this.scheduleDecode(generation, onScan, onError);
  }
  private waitForVideo(video: HTMLVideoElement) {
    if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("相机视频未准备好，请重试"));
      }, 10000);
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("loadedmetadata", done);
        video.removeEventListener("canplay", done);
      };
      this.cancelVideoWait = () => {
        cleanup();
        resolve();
      };
      video.addEventListener("loadedmetadata", done, { once: true });
      video.addEventListener("canplay", done, { once: true });
    });
  }
  private reportDecodeError(
    error: unknown,
    generation: number,
    onError?: (error: unknown) => void,
  ) {
    if (
      generation === this.generation &&
      Date.now() - this.lastDecodeError > 2000
    ) {
      this.lastDecodeError = Date.now();
      onError?.(error);
    }
  }
  private scheduleDecode(
    generation: number,
    onScan: (value: string) => void,
    onError?: (error: unknown) => void,
  ) {
    if (generation === this.generation && this.video) {
      this.timer = setTimeout(() => {
        // decode has a few browser APIs (canvas/video) outside the WASM call
        // that can throw synchronously. Never create an unhandled rejection
        // from the timer; the component must retain manual entry and retry.
        void this.decode(generation, onScan, onError).catch((error) =>
          this.reportDecodeError(error, generation, onError),
        );
      }, 250);
    }
  }
  private async decode(
    generation: number,
    onScan: (value: string) => void,
    onError?: (error: unknown) => void,
  ) {
    if (generation !== this.generation || !this.video || this.decoding) return;
    const video = this.video;
    const width = video.videoWidth || video.clientWidth;
    const height = video.videoHeight || video.clientHeight;
    if (!width || !height) {
      this.scheduleDecode(generation, onScan, onError);
      return;
    }
    const canvas = (this.canvas ||= document.createElement("canvas"));
    canvas.width = width;
    canvas.height = height;
    if (!this.context) this.context = canvas.getContext("2d") || undefined;
    const context = this.context;
    if (!context) {
      this.reportDecodeError(
        new Error("浏览器不支持画布读取，请手动输入或使用扫码枪。"),
        generation,
        onError,
      );
      return;
    }
    context.drawImage(video, 0, 0, width, height);
    this.decoding = true;
    try {
      const { readBarcodes } = await loadZXing();
      const results = await readBarcodes(
        context.getImageData(0, 0, width, height),
        { maxNumberOfSymbols: 1 },
      );
      if (generation === this.generation && results[0]?.text)
        onScan(results[0].text);
    } catch (error) {
      // A damaged frame can fail repeatedly. Keep scanning but do not turn the
      // panel into a 4 Hz error announcer.
      this.reportDecodeError(error, generation, onError);
    } finally {
      this.decoding = false;
      if (generation === this.generation)
        this.scheduleDecode(generation, onScan, onError);
    }
  }
  async stop() {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.cancelVideoWait?.();
    this.cancelVideoWait = undefined;
    this.video?.pause();
    if (this.video) this.video.srcObject = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.openedDeviceId = undefined;
    this.video = undefined;
    this.canvas = undefined;
    this.context = undefined;
    this.container?.replaceChildren();
    this.container = undefined;
    this.decoding = false;
    this.lastDecodeError = 0;
  }
}

export interface ScannerEngineFactories {
  "zxing-wasm": () => ScannerEngine;
}
const STORAGE_KEY = "temple_inventory.scanner_engine";
const CAMERA_STORAGE_KEY = "temple_inventory.scanner_device";
const CAMERA_LABEL_STORAGE_KEY = "temple_inventory.scanner_label";
export class ScannerService {
  private selected: ScannerEngineId;
  private active?: ScannerEngine;
  private queue = Promise.resolve();
  private factories: ScannerEngineFactories;
  private generation = 0;
  private selectedCameraId = "";
  private selectedCameraLabel = "";
  constructor(factories: Partial<ScannerEngineFactories> = {}) {
    this.selected = "zxing-wasm";
    try {
      localStorage.removeItem(STORAGE_KEY);
      this.selectedCameraId = localStorage.getItem(CAMERA_STORAGE_KEY) || "";
      this.selectedCameraLabel =
        localStorage.getItem(CAMERA_LABEL_STORAGE_KEY) || "";
    } catch {
      /* optional storage */
    }
    this.factories = {
      "zxing-wasm": () => new ZxingWasmScannerEngine(),
      ...factories,
    };
  }
  get engineId() {
    return this.selected;
  }
  get engineLabel() {
    return "ZXing-WASM";
  }
  get cameraDeviceId() {
    return this.selectedCameraId;
  }
  get cameraLabel() {
    return this.selectedCameraLabel;
  }
  async enumerateCameras(): Promise<ScannerCamera[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "videoinput")
      .map((device, index) => {
        const stableLabel = device.label.trim();
        return {
          deviceId: device.deviceId,
          label: stableLabel || `相机 ${index + 1}`,
          ...(stableLabel ? { stableLabel } : {}),
        };
      });
  }
  private async actualCameraLabel(deviceId: string) {
    if (!deviceId) return "";
    try {
      const device = (await navigator.mediaDevices.enumerateDevices()).find(
        (row) => row.kind === "videoinput" && row.deviceId === deviceId,
      );
      return device?.label.trim() || "";
    } catch {
      return "";
    }
  }
  private enqueue<T>(operation: () => Promise<T>) {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  start(
    container: HTMLElement,
    onScan: (value: string) => void,
    onError?: (error: unknown) => void,
    deviceId = this.selectedCameraId,
  ) {
    const generation = ++this.generation;
    return this.enqueue(async () => {
      if (generation !== this.generation) return;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "相机需要 HTTPS 或 localhost。请使用安全网址，或手动输入。",
        );
      await this.active?.stop();
      if (generation !== this.generation) return;
      const engine = this.factories[this.selected]();
      this.active = engine;
      try {
        await engine.start(container, onScan, onError, deviceId || undefined);
        if (generation !== this.generation) {
          if (this.active === engine) this.active = undefined;
          await engine.stop();
        } else {
          const selectedCameraId = engine.deviceId || deviceId || "";
          const selectedCameraLabel =
            await this.actualCameraLabel(selectedCameraId);
          if (generation !== this.generation) {
            if (this.active === engine) this.active = undefined;
            await engine.stop();
            return;
          }
          this.selectedCameraId = selectedCameraId;
          this.selectedCameraLabel = selectedCameraLabel;
          try {
            if (this.selectedCameraId) {
              localStorage.setItem(CAMERA_STORAGE_KEY, this.selectedCameraId);
              if (this.selectedCameraLabel)
                localStorage.setItem(
                  CAMERA_LABEL_STORAGE_KEY,
                  this.selectedCameraLabel,
                );
              else localStorage.removeItem(CAMERA_LABEL_STORAGE_KEY);
            } else {
              localStorage.removeItem(CAMERA_STORAGE_KEY);
              localStorage.removeItem(CAMERA_LABEL_STORAGE_KEY);
            }
          } catch {
            /* Camera preference is optional. */
          }
        }
      } catch (error) {
        if (this.active === engine) this.active = undefined;
        await engine.stop();
        throw error;
      }
    });
  }
  stop() {
    ++this.generation;
    const active = this.active;
    this.active = undefined;
    const stopping = active?.stop() || Promise.resolve();
    return this.enqueue(async () => {
      await stopping;
    });
  }
}
