import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { sessionExpired } from "../src/lib/sessionState";
import Scanner from "../src/components/Scanner.vue";

const state = vi.hoisted(() => ({
  starts: [] as string[],
  deviceIds: [] as string[],
  stops: 0,
  callbacks: [] as ((value: string) => void)[],
  presenceCallbacks: [] as ((presence: boolean | null) => void)[],
  errors: [] as ((error: unknown) => void)[],
  startError: undefined as Error | undefined,
  cameras: [] as { deviceId: string; label: string; stableLabel?: string }[],
  openedDeviceId: "",
  fallbackDeviceId: "rear-camera",
  deferredStarts: 0,
  pendingStarts: [] as (() => void)[],
  deferredEnumerations: 0,
  pendingEnumerations: [] as (() => void)[],
}));
vi.mock("../src/lib/scanner", () => ({
  cameraError: (error: any) => String(error?.message || error),
  ScannerService: class {
    selectedCameraId =
      localStorage.getItem("temple_inventory.scanner_device") || "";
    engineId =
      (localStorage.getItem("temple_inventory.scanner_engine") as any) ||
      "zxing-wasm";
    get engineLabel() {
      return this.engineId === "frappe" ? "Frappe 内置" : "ZXing-WASM";
    }
    get cameraDeviceId() {
      return this.selectedCameraId || state.openedDeviceId;
    }
    get cameraLabel() {
      return localStorage.getItem("temple_inventory.scanner_label") || "";
    }
    async enumerateCameras() {
      if (state.deferredEnumerations > 0) {
        state.deferredEnumerations--;
        await new Promise<void>((resolve) =>
          state.pendingEnumerations.push(resolve),
        );
      }
      return state.cameras;
    }
    async start(
      _container: HTMLElement,
      callback: (value: string) => void,
      onError: (error: unknown) => void,
      deviceId?: string,
      onFramePresence?: (presence: boolean | null) => void,
    ) {
      state.deviceIds.push(deviceId || "");
      if (state.startError) {
        const error = state.startError;
        state.startError = undefined;
        throw error;
      }
      if (state.deferredStarts > 0) {
        state.deferredStarts--;
        await new Promise<void>((resolve) => state.pendingStarts.push(resolve));
      }
      state.starts.push(this.engineId);
      state.openedDeviceId = deviceId || state.fallbackDeviceId;
      this.selectedCameraId = state.openedDeviceId;
      localStorage.setItem(
        "temple_inventory.scanner_device",
        this.selectedCameraId,
      );
      const openedCamera = state.cameras.find(
        (camera) => camera.deviceId === this.selectedCameraId,
      );
      if (openedCamera?.stableLabel)
        localStorage.setItem(
          "temple_inventory.scanner_label",
          openedCamera.stableLabel,
        );
      else localStorage.removeItem("temple_inventory.scanner_label");
      state.callbacks.push(callback);
      state.errors.push(onError);
      state.presenceCallbacks.push(onFramePresence || (() => {}));
    }
    async stop() {
      state.stops++;
    }
    async selectEngine(id: any) {
      state.stops++;
      this.engineId = id;
      localStorage.setItem("temple_inventory.scanner_engine", id);
    }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.starts.length = 0;
  state.deviceIds.length = 0;
  state.stops = 0;
  state.callbacks.length = 0;
  state.presenceCallbacks.length = 0;
  state.errors.length = 0;
  state.startError = undefined;
  state.cameras = [];
  state.openedDeviceId = "";
  state.fallbackDeviceId = "rear-camera";
  state.deferredStarts = 0;
  state.pendingStarts.length = 0;
  state.deferredEnumerations = 0;
  state.pendingEnumerations.length = 0;
  localStorage.clear();
  sessionExpired.value = false;
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  const mediaDevices = new EventTarget() as MediaDevices & {
    getUserMedia: typeof navigator.mediaDevices.getUserMedia;
    enumerateDevices: typeof navigator.mediaDevices.enumerateDevices;
  };
  Object.assign(mediaDevices, {
    getUserMedia: vi.fn(),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: mediaDevices,
    configurable: true,
  });
});

describe("Scanner component", () => {
  it("embeds camera feedback without duplicating its parent's manual field and close action", async () => {
    const wrapper = mount(Scanner, { props: { presentation: "camera" } });
    await flushPromises();
    expect(wrapper.find(".scanner-camera").exists()).toBe(true);
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find(".section-title-row").exists()).toBe(false);
    state.errors[0]!(new Error("相机不可用"));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("相机不可用");
    expect(wrapper.get("button").text()).toBe("重试相机");
    wrapper.unmount();
    expect(state.stops).toBeGreaterThan(0);
  });
  it("teleports modal presentation, traps focus, restores body scroll and opener, and stops on close", async () => {
    const opener = document.createElement("button");
    opener.textContent = "open";
    document.body.append(opener);
    opener.focus();
    document.body.style.overflow = "scroll";
    const wrapper = mount(Scanner, { props: { presentation: "modal" } });
    await flushPromises();
    const dialog = document.body.querySelector(
      '[role="dialog"]',
    ) as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("扫描条码");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement?.textContent).toContain("关闭");
    await dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    await (
      document.body.querySelector(".dialog-heading button") as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(state.stops).toBeGreaterThan(0);
    wrapper.unmount();
    await flushPromises();
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("closes modal on Escape and backdrop click, while continuous stays nonmodal and pauses", async () => {
    const modal = mount(Scanner, { props: { presentation: "modal" } });
    await flushPromises();
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    await flushPromises();
    expect(modal.emitted("close")).toHaveLength(1);
    modal.unmount();
    const continuous = mount(Scanner, {
      props: { presentation: "continuous" },
    });
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(continuous.text()).toContain("连续扫码");
    await continuous.setProps({ paused: true });
    await flushPromises();
    expect(state.stops).toBeGreaterThan(0);
    continuous.unmount();
  });

  it("suppresses duplicate camera callbacks with the single decoder", async () => {
    const wrapper = mount(Scanner);
    await flushPromises();
    expect(state.starts).toEqual(["zxing-wasm"]);
    state.callbacks[0]("123");
    state.callbacks[0]("123");
    expect(wrapper.emitted("scan")).toEqual([["123"]]);
    wrapper.unmount();
  });

  it("rearms only after 500ms of successful empty frames and keeps errors from counting as absence", async () => {
    vi.useFakeTimers();
    const wrapper = mount(Scanner);
    await flushPromises();
    state.callbacks[0]!("123");
    state.callbacks[0]!("123");
    state.errors[0]!(new Error("bad frame"));
    vi.advanceTimersByTime(1000);
    state.callbacks[0]!("123");
    expect(wrapper.emitted("scan")).toEqual([["123"]]);

    state.presenceCallbacks[0]!(false);
    vi.advanceTimersByTime(250);
    // A failed frame resets successful-absence timing even if its visible
    // error was throttled and the component never received another error.
    state.presenceCallbacks[0]!(null);
    vi.advanceTimersByTime(500);
    state.presenceCallbacks[0]!(false);
    state.callbacks[0]!("123");
    expect(wrapper.emitted("scan")).toEqual([["123"]]);

    vi.advanceTimersByTime(250);
    state.presenceCallbacks[0]!(false);
    vi.advanceTimersByTime(250);
    state.presenceCallbacks[0]!(false);
    state.callbacks[0]!("123");
    expect(wrapper.emitted("scan")).toEqual([["123"], ["123"]]);
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("has no engine switch and keeps repeated deliberate manual entry usable", async () => {
    localStorage.setItem("temple_inventory.scanner_engine", "frappe");
    const wrapper = mount(Scanner);
    await flushPromises();
    expect(wrapper.find(".scanner-engine").exists()).toBe(false);
    await wrapper.find("input").setValue("A001");
    await wrapper.find("form").trigger("submit");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("scan")).toEqual([["A001"], ["A001"]]);
    wrapper.unmount();
  });

  it("offers a device selector after permission and switches to the selected camera", async () => {
    localStorage.setItem("temple_inventory.scanner_device", "camera-A");
    state.cameras = [
      { deviceId: "camera-A", label: "后置相机" },
      { deviceId: "camera-B", label: "USB 相机" },
    ];
    const wrapper = mount(Scanner, { props: { presentation: "camera" } });
    await flushPromises();
    expect(state.deviceIds).toEqual(["camera-A"]);
    const select = wrapper.get(".scanner-camera-select select");
    expect(select.text()).toContain("后置相机");
    await select.setValue("camera-B");
    await flushPromises();
    expect(state.deviceIds).toEqual(["camera-A", "camera-B"]);
    expect(wrapper.get(".scanner-camera-select select").element).toHaveProperty(
      "value",
      "camera-B",
    );
    wrapper.unmount();
  });

  it("restores a uniquely labeled camera when the browser rotates its device ID", async () => {
    localStorage.setItem("temple_inventory.scanner_device", "old-device-B");
    localStorage.setItem("temple_inventory.scanner_label", "fake_device_1");
    state.cameras = [
      {
        deviceId: "rotated-device-A",
        label: "fake_device_0",
        stableLabel: "fake_device_0",
      },
      {
        deviceId: "rotated-device-B",
        label: "fake_device_1",
        stableLabel: "fake_device_1",
      },
    ];
    state.startError = Object.assign(new Error("device missing"), {
      name: "NotFoundError",
    });
    const wrapper = mount(Scanner, { props: { presentation: "camera" } });
    await flushPromises();
    expect(state.deviceIds).toEqual(["old-device-B", "rotated-device-B"]);
    expect(wrapper.text()).toContain("已按相机名称恢复上次选择");
    expect(wrapper.get(".scanner-camera-select select").element).toHaveProperty(
      "value",
      "rotated-device-B",
    );
    expect(localStorage.getItem("temple_inventory.scanner_device")).toBe(
      "rotated-device-B",
    );
    expect(localStorage.getItem("temple_inventory.scanner_label")).toBe(
      "fake_device_1",
    );
    wrapper.unmount();
  });

  it.each([
    {
      label: "duplicate browser labels",
      cameras: [
        {
          deviceId: "device-A2",
          label: "USB camera",
          stableLabel: "USB camera",
        },
        {
          deviceId: "device-B2",
          label: "USB camera",
          stableLabel: "USB camera",
        },
      ],
    },
    {
      label: "synthesized labels only",
      cameras: [
        { deviceId: "device-A2", label: "相机 1" },
        { deviceId: "device-B2", label: "相机 2" },
      ],
    },
  ])("uses the rear fallback for $label", async ({ cameras }) => {
    localStorage.setItem("temple_inventory.scanner_device", "old-device");
    localStorage.setItem("temple_inventory.scanner_label", "USB camera");
    state.cameras = cameras;
    state.startError = Object.assign(new Error("device missing"), {
      name: "NotFoundError",
    });
    const wrapper = mount(Scanner, { props: { presentation: "camera" } });
    await flushPromises();
    expect(state.deviceIds).toEqual(["old-device", ""]);
    expect(wrapper.text()).toContain("已尝试切换到后置相机");
    wrapper.unmount();
  });

  it("does not reconnect a remembered label when pause wins during device enumeration", async () => {
    localStorage.setItem("temple_inventory.scanner_device", "old-device");
    localStorage.setItem("temple_inventory.scanner_label", "USB camera");
    state.cameras = [
      {
        deviceId: "rotated-device",
        label: "USB camera",
        stableLabel: "USB camera",
      },
    ];
    state.startError = Object.assign(new Error("device missing"), {
      name: "NotFoundError",
    });
    state.deferredEnumerations = 1;
    const wrapper = mount(Scanner, { props: { presentation: "camera" } });
    await flushPromises();
    expect(state.pendingEnumerations).toHaveLength(1);
    await wrapper.setProps({ paused: true });
    await flushPromises();
    state.pendingEnumerations[0]!();
    await flushPromises();
    expect(state.deviceIds).toEqual(["old-device"]);
    expect(wrapper.text()).toContain("请确认数量与位置后继续扫描");
    wrapper.unmount();
  });

  it("falls back only when a remembered camera disappeared and keeps permission errors retryable", async () => {
    localStorage.setItem("temple_inventory.scanner_device", "gone-camera");
    state.cameras = [{ deviceId: "rear-camera", label: "后置相机" }];
    state.startError = Object.assign(new Error("device missing"), {
      name: "NotFoundError",
    });
    const missing = mount(Scanner, { props: { presentation: "camera" } });
    await flushPromises();
    expect(state.deviceIds.slice(0, 2)).toEqual(["gone-camera", ""]);
    expect(missing.text()).toContain("上次选择的相机已不可用");
    expect(state.deviceIds).toHaveLength(2);
    missing.unmount();

    state.deviceIds.length = 0;
    localStorage.setItem("temple_inventory.scanner_device", "gone-camera");
    state.startError = Object.assign(new Error("permission denied"), {
      name: "NotAllowedError",
    });
    const denied = mount(Scanner, { props: { presentation: "camera" } });
    await flushPromises();
    expect(state.deviceIds).toEqual(["gone-camera"]);
    expect(denied.find("[role=alert]").exists()).toBe(true);
    denied.unmount();
  });

  it("switches away from a disconnected selected device and selects the opened fallback", async () => {
    localStorage.setItem("temple_inventory.scanner_device", "camera-A");
    state.cameras = [
      { deviceId: "camera-A", label: "后置相机" },
      { deviceId: "rear-camera", label: "内置相机" },
    ];
    const wrapper = mount(Scanner, { props: { presentation: "camera" } });
    await flushPromises();
    state.cameras = [
      { deviceId: "rear-camera", label: "内置相机" },
      { deviceId: "front-camera", label: "前置相机" },
    ];
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushPromises();
    expect(state.deviceIds).toEqual(["camera-A", ""]);
    expect(wrapper.text()).toContain("当前相机已断开");
    expect(wrapper.get(".scanner-camera-select select").element).toHaveProperty(
      "value",
      "rear-camera",
    );
    wrapper.unmount();
  });

  it("stops on pause, session expiry, close, and unmount, then restarts after recovery", async () => {
    const wrapper = mount(Scanner);
    await flushPromises();
    const initialStarts = state.starts.length;
    await wrapper.setProps({ paused: true });
    await flushPromises();
    expect(state.stops).toBe(1);
    await wrapper.setProps({ paused: false });
    await flushPromises();
    expect(state.starts.length).toBe(initialStarts + 1);
    sessionExpired.value = true;
    await flushPromises();
    expect(state.stops).toBeGreaterThanOrEqual(2);
    sessionExpired.value = false;
    await flushPromises();
    expect(state.deviceIds).toEqual(["", "rear-camera", "rear-camera"]);
    expect(state.starts.length).toBe(initialStarts + 2);
    await wrapper.find(".section-title-row button").trigger("click");
    await flushPromises();
    expect(state.stops).toBe(3);
    wrapper.unmount();
    await flushPromises();
    expect(state.stops).toBe(4);
  });

  it("restarts after pause during a pending camera open and ignores the stale startup", async () => {
    state.deferredStarts = 2;
    const wrapper = mount(Scanner);
    await flushPromises();
    expect(state.pendingStarts).toHaveLength(1);
    await wrapper.setProps({ paused: true });
    await flushPromises();
    await wrapper.setProps({ paused: false });
    await flushPromises();
    expect(state.pendingStarts).toHaveLength(2);

    state.pendingStarts[0]!();
    await flushPromises();
    expect(wrapper.find(".scanner-camera").attributes("aria-busy")).toBe(
      "true",
    );
    state.pendingStarts[1]!();
    await flushPromises();
    expect(wrapper.find(".scanner-camera").attributes("aria-busy")).toBe(
      "false",
    );
    expect(wrapper.find("[role=alert]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("clears stale startup state when presentation changes while camera open is pending", async () => {
    state.deferredStarts = 2;
    const wrapper = mount(Scanner, { props: { presentation: "camera" } });
    await flushPromises();
    expect(state.pendingStarts).toHaveLength(1);
    await wrapper.setProps({ presentation: "modal" });
    await flushPromises();
    expect(state.pendingStarts).toHaveLength(2);

    state.pendingStarts[0]!();
    await flushPromises();
    expect(
      document.body.querySelector('.scanner-camera[aria-busy="true"]'),
    ).toBeTruthy();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    state.pendingStarts[1]!();
    await flushPromises();
    expect(wrapper.text()).not.toContain("正在打开相机");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps manual entry available after an asynchronous decoding failure", async () => {
    const wrapper = mount(Scanner);
    await flushPromises();
    state.errors[0](new Error("camera lost"));
    await flushPromises();
    expect(wrapper.text()).toContain("camera lost");
    await wrapper.find("input").setValue("MANUAL-1");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("scan")).toContainEqual(["MANUAL-1"]);
    wrapper.unmount();
  });

  it("shows an initial startup failure and retries without losing manual entry", async () => {
    state.startError = new Error("initial camera failure");
    const wrapper = mount(Scanner);
    await flushPromises();
    expect(wrapper.text()).toContain("initial camera failure");
    expect(wrapper.find("form").exists()).toBe(true);
    const retry = wrapper
      .findAll("button")
      .find((button) => button.text() === "重试相机");
    expect(retry).toBeDefined();
    await retry!.trigger("click");
    await flushPromises();
    expect(state.starts).toEqual(["zxing-wasm"]);
    expect(wrapper.text()).not.toContain("initial camera failure");
    wrapper.unmount();
  });
});
