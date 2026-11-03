// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import ViewModeToggle from "../src/components/ui/ViewModeToggle.vue";
import type { BrowseView } from "../src/composables/useBrowseViewMode";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

function mountToggle(options: BrowseView[], modelValue: BrowseView = "table") {
  const wrapper = mount(ViewModeToggle, {
    props: {
      ariaLabel: "库存显示方式",
      options,
      modelValue,
      "onUpdate:modelValue": (value: BrowseView) =>
        wrapper.setProps({ modelValue: value }),
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe("ViewModeToggle", () => {
  it("renders the requested options in order with fixed labels", () => {
    const wrapper = mountToggle(["card", "list", "table"]);
    const labels = wrapper.findAll("button").map((button) => button.text());
    expect(labels).toEqual(["卡片", "列表", "表格"]);
    expect(wrapper.attributes("aria-label")).toBe("库存显示方式");
    expect(wrapper.find("button[aria-label='列表视图']").exists()).toBe(true);
  });

  it("uses 表格 and 列表 for the table and list options", () => {
    const wrapper = mountToggle(["list", "table"]);
    expect(wrapper.findAll("button").map((button) => button.text())).toEqual([
      "列表",
      "表格",
    ]);
  });

  it("renders nothing with fewer than two options", () => {
    expect(mountToggle(["card"]).find(".segmented").exists()).toBe(false);
    expect(mountToggle([]).find(".segmented").exists()).toBe(false);
  });

  it("marks the selected view and emits the chosen one", async () => {
    const wrapper = mountToggle(["card", "table"], "table");
    const pressed = () =>
      wrapper
        .findAll("button")
        .map((button) => button.attributes("aria-pressed"));
    expect(pressed()).toEqual(["false", "true"]);
    await wrapper.get("button[aria-label='卡片视图']").trigger("click");
    expect(pressed()).toEqual(["true", "false"]);
  });
});
