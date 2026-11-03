// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import BrowseEmpty from "../src/components/ui/BrowseEmpty.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("BrowseEmpty", () => {
  it("renders the message as a status with an icon", () => {
    const wrapper = mount(BrowseEmpty, { props: { text: "没有匹配的记录" } });
    wrappers.push(wrapper);
    const root = wrapper.get(".browse-empty");
    expect(root.attributes("role")).toBe("status");
    expect(root.get("p").text()).toBe("没有匹配的记录");
    expect(root.find("span svg").exists()).toBe(true);
  });

  it("renders the slot after the message", () => {
    const wrapper = mount(BrowseEmpty, {
      props: { text: "没有匹配的记录" },
      slots: { default: () => h("button", "清除筛选") },
    });
    wrappers.push(wrapper);
    expect(wrapper.get(".browse-empty button").text()).toBe("清除筛选");
  });
});
