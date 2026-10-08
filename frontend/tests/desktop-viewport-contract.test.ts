import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ApplicationShellDesktopView from "../src/features/shell/ApplicationShellDesktopView.vue";

const RouterLink = defineComponent({
  props: ["to", "ariaCurrent"],
  template:
    '<a :href="typeof to === \'string\' ? to : to.path" :aria-current="ariaCurrent"><slot /></a>',
});

const destinations = [
  { key: "inventory", label: "库存", path: "/" },
  { key: "movements", label: "货物流动", path: "/movements" },
  { key: "adjustments", label: "盘点调整", path: "/adjustments" },
  { key: "loans", label: "借用", path: "/loans" },
  { key: "warehouses", label: "仓库", path: "/warehouses" },
  { key: "more", label: "更多", path: "/more" },
] as const;

describe("desktop shell presentation contract", () => {
  it("mounts an independently scrollable navigation surface with context links", () => {
    const wrapper = mount(ApplicationShellDesktopView, {
      props: {
        destinations: [...destinations],
        activeDestination: "/",
        inventoryExpanded: true,
        inventoryContextItems: [
          { key: "current", label: "当前库存", path: "/", query: {} },
          { key: "expiry", label: "效期批次", path: "/expiry", query: {} },
        ],
        contextItems: [],
        contextKey: "current",
        pending: 2,
        expiryCount: 3,
        user: "tester",
      },
      global: { stubs: { RouterLink } },
    });

    expect(wrapper.find(".desktop-nav").exists()).toBe(true);
    expect(wrapper.find(".desktop-module-navigation").exists()).toBe(true);
    expect(
      wrapper
        .find(".desktop-module-navigation")
        .findAll(":scope > a, :scope > button"),
    ).toHaveLength(destinations.length);
    expect(wrapper.findAll(".desktop-inventory-context a")).toHaveLength(2);
    expect(wrapper.find(".shell-actions").text()).toContain("tester");
  });
});
