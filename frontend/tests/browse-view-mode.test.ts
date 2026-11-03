// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import {
  browseLayoutStorageKey,
  useBrowseViewMode,
} from "../src/composables/useBrowseViewMode";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("useBrowseViewMode", () => {
  it("defaults to table for both phone and desktop", () => {
    const mode = useBrowseViewMode(ref(false));
    expect(mode.view.value).toBe("table");
    expect(mode.phoneView.value).toBe("table");
    expect(mode.desktopView.value).toBe("table");
  });

  it("keeps separate phone and desktop choices", () => {
    const isMobile = ref(false);
    const mode = useBrowseViewMode(isMobile, {
      phone: "card",
      desktop: "list",
    });
    expect(mode.view.value).toBe("list");
    isMobile.value = true;
    expect(mode.view.value).toBe("card");
    mode.view.value = "table";
    expect(mode.phoneView.value).toBe("table");
    isMobile.value = false;
    expect(mode.view.value).toBe("list");
  });

  it("reads the stored layout at init and writes every change", async () => {
    window.localStorage.setItem(
      "layout-key",
      JSON.stringify({ phone: "card", desktop: "list" }),
    );
    const mode = useBrowseViewMode(ref(false), { storageKey: "layout-key" });
    expect(mode.desktopView.value).toBe("list");
    expect(mode.phoneView.value).toBe("card");
    mode.desktopView.value = "card";
    await nextTick();
    expect(JSON.parse(window.localStorage.getItem("layout-key")!)).toEqual({
      phone: "card",
      desktop: "card",
    });
  });

  it("ignores invalid stored values and falls back to defaults", () => {
    window.localStorage.setItem(
      "layout-key",
      JSON.stringify({ phone: "grid", desktop: 3 }),
    );
    const mode = useBrowseViewMode(ref(false), {
      phone: "card",
      desktop: "table",
      storageKey: "layout-key",
    });
    expect(mode.phoneView.value).toBe("card");
    expect(mode.desktopView.value).toBe("table");
    window.localStorage.setItem("layout-key", "{not json");
    const broken = useBrowseViewMode(ref(false), { storageKey: "layout-key" });
    expect(broken.desktopView.value).toBe("table");
  });

  it("reloads the choice when the storage key changes", async () => {
    window.localStorage.setItem(
      "key-b",
      JSON.stringify({ phone: "table", desktop: "list" }),
    );
    const key = ref<string | undefined>("key-a");
    const mode = useBrowseViewMode(ref(false), { storageKey: key });
    mode.desktopView.value = "card";
    await nextTick();
    key.value = "key-b";
    await nextTick();
    expect(mode.desktopView.value).toBe("list");
    expect(JSON.parse(window.localStorage.getItem("key-a")!).desktop).toBe(
      "card",
    );
  });

  it("keeps working when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const mode = useBrowseViewMode(ref(false), { storageKey: "layout-key" });
    expect(mode.desktopView.value).toBe("table");
    mode.view.value = "list";
    await nextTick();
    expect(mode.desktopView.value).toBe("list");
  });

  it("restores the three views and the legacy view field", () => {
    const mode = useBrowseViewMode(ref(false));
    mode.restore({ phoneView: "list", desktopView: "card" });
    expect(mode.snapshot()).toEqual({ phoneView: "list", desktopView: "card" });
    mode.restore({ view: "card" });
    expect(mode.snapshot()).toEqual({
      phoneView: "table",
      desktopView: "card",
    });
    mode.restore({ phoneView: "bogus", desktopView: "list" });
    expect(mode.snapshot()).toEqual({
      phoneView: "table",
      desktopView: "list",
    });
  });

  it("builds an encoded per-account layout key", () => {
    expect(browseLayoutStorageKey("dev site", "a/b", "stock")).toBe(
      "temple-inventory:browse-layout:v1:dev%20site:a%2Fb:stock",
    );
  });
});
