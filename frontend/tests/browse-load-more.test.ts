// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import BrowseLoadMore from "../src/components/ui/BrowseLoadMore.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("BrowseLoadMore", () => {
  it("shows progress and emits paging intent", async () => {
    const wrapper = mount(BrowseLoadMore, {
      props: { loadedCount: 30, totalCount: 72, hasMore: true },
    });
    wrappers.push(wrapper);
    expect(wrapper.text()).toContain("加载更多 · 30 / 72");
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("loadMore")).toHaveLength(1);
  });

  it("hides when complete and offers retry on a paging error", async () => {
    const wrapper = mount(BrowseLoadMore, {
      props: {
        loadedCount: 30,
        totalCount: 30,
        hasMore: false,
        error: "请求失败",
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.text()).toContain("请求失败");
    await wrapper.get("button").trigger("click");
    expect(wrapper.text()).toContain("重试加载");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });
});
