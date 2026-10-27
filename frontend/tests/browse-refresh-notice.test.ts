// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import BrowseRefreshNotice from "../src/components/ui/BrowseRefreshNotice.vue";

describe("browse refresh failure notice", () => {
  it("shows a plain retry callout only after a failed refresh", async () => {
    const retry = vi.fn();
    const wrapper = mount(BrowseRefreshNotice, {
      props: { show: false, retry },
    });
    expect(wrapper.text()).toBe("");
    await wrapper.setProps({ show: true });
    expect(wrapper.text()).toContain("更新失败");
    expect(wrapper.text()).toContain("重试");
    await wrapper.get("button").trigger("click");
    expect(retry).toHaveBeenCalledOnce();
  });
});
