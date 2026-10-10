import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MobileSubnav from "../src/components/MobileSubnav.vue";

const RouterLink = defineComponent({
  props: ["to"],
  template: '<a :href="to.path"><slot /></a>',
});

const items = [
  { key: "first", label: "明细", path: "/movements/items" },
  { key: "second", label: "记录", path: "/movements/records" },
];

describe("MobileSubnav", () => {
  it("compacts after scrolling past 80px and resets when route context changes", async () => {
    const wrapper = mount(MobileSubnav, {
      props: { items, activeKey: "first" },
      global: { stubs: { RouterLink } },
    });
    const nav = wrapper.find("nav");
    expect(nav.classes()).not.toContain("compact");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 81 });
    window.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(nav.classes()).toContain("compact");

    await wrapper.setProps({ activeKey: "second" });
    await nextTick();
    expect(nav.classes()).not.toContain("compact");

    const unrelatedScrollSurface = document.createElement("div");
    Object.defineProperty(unrelatedScrollSurface, "scrollTop", {
      configurable: true,
      value: 81,
    });
    document.body.appendChild(unrelatedScrollSurface);
    unrelatedScrollSurface.dispatchEvent(
      new Event("scroll", { bubbles: true }),
    );
    await nextTick();
    expect(nav.classes()).not.toContain("compact");

    const resultsScrollSurface = document.createElement("div");
    resultsScrollSurface.className = "results-scroll";
    Object.defineProperty(resultsScrollSurface, "scrollTop", {
      configurable: true,
      value: 81,
    });
    document.body.appendChild(resultsScrollSurface);
    resultsScrollSurface.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextTick();
    expect(nav.classes()).toContain("compact");
    await wrapper.setProps({
      items: items.map((item) => ({ ...item, query: { refresh: "1" } })),
    });
    await nextTick();
    expect(nav.classes()).not.toContain("compact");
    unrelatedScrollSurface.remove();
    resultsScrollSurface.remove();
    wrapper.unmount();
  });
});
