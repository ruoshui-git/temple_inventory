import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import TruncatedTextPopover from "../src/components/TruncatedTextPopover.vue";

describe("TruncatedTextPopover", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders an em dash without an interactive popover for empty notes", () => {
    const wrapper = mount(TruncatedTextPopover, { props: { text: "  " } });

    expect(wrapper.get(".truncated-text").text()).toBe("—");
    expect(wrapper.find(".detail-popover-trigger").exists()).toBe(false);
  });

  it("keeps desktop truncation and exposes the full note accessibly", async () => {
    const note = "这是一段很长的备注，需要在表格中保持单行显示";
    const wrapper = mount(TruncatedTextPopover, {
      props: { text: note, label: "查看完整备注", mobileLines: 3 },
    });

    const text = wrapper.get(".truncated-text");
    expect(text.classes()).toContain("truncated-text");
    expect(text.attributes("style")).toContain("--mobile-lines: 3");
    expect(wrapper.get("button").attributes("aria-label")).toBe("查看完整备注");

    await wrapper.get("button").trigger("click");
    expect(document.body.textContent).toContain(note);
  });
});
