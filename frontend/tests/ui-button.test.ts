import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import UiButton from "../src/components/UiButton.vue";

describe("UiButton", () => {
  it("keeps native attrs/events and renders one loading label", async () => {
    const wrapper = mount(UiButton, {
      props: { loading: true, variant: "primary", "aria-label": "保存" } as any,
      slots: { default: "保存" },
    });
    const button = wrapper.get("button");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("aria-busy")).toBe("true");
    expect(button.text()).toBe("正在处理…");
    expect(button.findAll(".ui-button-loading-label")).toHaveLength(1);
  });

  it("supports icon-only accessible controls and variants", async () => {
    const wrapper = mount(UiButton, {
      props: {
        icon: "download",
        iconOnly: true,
        label: "导出",
        variant: "ghost",
      },
    });
    const button = wrapper.get("button");
    expect(button.attributes("aria-label")).toBe("导出");
    expect(button.classes()).toContain("is-icon-only");
    await button.trigger("click");
  });
});
