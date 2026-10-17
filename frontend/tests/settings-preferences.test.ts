import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import DisplaySettingsPage from "../src/features/settings/DisplaySettingsPage.vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import {
  density,
  theme,
  textScale,
  hydrateUiPreferences,
  preferenceSaveState,
} from "../src/lib/uiPreferences";
const wrappers: VueWrapper[] = [];
const defaults = {
  theme: "jade" as const,
  density: "balanced" as const,
  textScale: 100 as const,
};
beforeEach(() => {
  localStorage.clear();
  hydrateUiPreferences("alice", defaults);
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});
function setup(
  call = vi.fn(async (endpoint, args) =>
    endpoint === "session.info"
      ? { user: "alice", ui_preferences: defaults }
      : args,
  ),
) {
  const reference = createReferenceData();
  Object.assign(reference, { user: "alice", site: "site" });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(DisplaySettingsPage);
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  return { wrapper, reference, call };
}
describe("shared account display settings", () => {
  it("applies all three themes and independent text/density tokens through the rendered controls", async () => {
    const { wrapper, call } = setup();
    await flushPromises();
    const blue = wrapper
      .findAll(".theme-option")
      .find((button) => button.text().includes("靛蓝"))!;
    await blue.trigger("click");
    await flushPromises();
    expect(theme.value).toBe("blue");
    expect(
      document.documentElement.style.getPropertyValue("--p-radius-control"),
    ).toBe("6px");
    await wrapper.find('input[value="compact"]').setValue(true);
    await flushPromises();
    await wrapper.find('select[aria-label="文字大小"]').setValue("175");
    await flushPromises();
    expect(density.value).toBe("compact");
    expect(textScale.value).toBe(175);
    expect(document.documentElement.dataset.tiDensity).toBe("compact");
    expect(
      document.documentElement.style.getPropertyValue("--p-text-scale"),
    ).toBe("1.75");
    expect(call).toHaveBeenLastCalledWith(
      "preferences.save_display_preferences",
      { theme: "blue", density: "compact", textScale: 175 },
    );
  });
  it("retains failed working preferences, preserves the confirmed cache and retries the same selection", async () => {
    let fail = true;
    const call = vi.fn(async (endpoint, args) => {
      if (endpoint === "session.info")
        return { user: "alice", ui_preferences: defaults };
      if (fail) throw new Error("保存失败");
      return args;
    });
    const { wrapper } = setup(call);
    await flushPromises();
    await wrapper.find('input[value="spacious"]').setValue(true);
    await flushPromises();
    expect(density.value).toBe("spacious");
    expect(preferenceSaveState.value).toBe("error");
    const cache = () =>
      JSON.parse(
        localStorage.getItem("temple-inventory:ui-preferences:v2:alice")!,
      );
    expect(cache().values.density).toBe("balanced");
    expect(wrapper.text()).toContain("本次会话");
    fail = false;
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "重试保存偏好")!
      .trigger("click");
    await flushPromises();
    expect(preferenceSaveState.value).toBe("saved");
    expect(cache().values.density).toBe("spacious");
  });
  it("ignores an old account response after account switching", async () => {
    let resolve!: (value: unknown) => void;
    const { reference } = setup(
      vi.fn(() => new Promise((done) => (resolve = done))),
    );
    reference.user = "bob";
    hydrateUiPreferences("bob", {
      theme: "bronze",
      density: "spacious",
      textScale: 125,
    });
    resolve({ user: "alice", ui_preferences: defaults });
    await flushPromises();
    expect(theme.value).toBe("bronze");
    expect(density.value).toBe("spacious");
    expect(textScale.value).toBe(125);
  });
  it("keeps server saving available when browser storage is denied", async () => {
    const { wrapper, call } = setup();
    await flushPromises();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    await wrapper.find('input[value="compact"]').setValue(true);
    await flushPromises();
    expect(preferenceSaveState.value).toBe("saved");
    expect(call).toHaveBeenCalledWith("preferences.save_display_preferences", {
      ...defaults,
      density: "compact",
    });
  });
});
