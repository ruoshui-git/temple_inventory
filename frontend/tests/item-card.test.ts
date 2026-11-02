// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import ItemCard from "../src/components/ui/ItemCard.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("ItemCard", () => {
  it("renders page details and status, and preserves BrowseCard selection", async () => {
    const wrapper = mount(ItemCard, {
      props: {
        rowKey: "ITEM-1",
        name: "法器",
        code: "ITEM-1",
        category: "祭器",
        quantity: 3,
        unit: "件",
        status: "待处理",
        statusTone: "warning",
        selecting: true,
        selected: false,
        selectLabel: "选择法器",
      },
      global: { stubs: { ItemImage: true } },
      slots: { default: "批次 B-1" },
    });
    wrappers.push(wrapper);
    expect(wrapper.text()).toContain("法器");
    expect(wrapper.text()).toContain("批次 B-1");
    expect(wrapper.get(".stock-number").text()).toContain("3");
    expect(wrapper.get(".art-badge.warning").text()).toBe("待处理");
    expect(wrapper.get("[role=checkbox]").attributes("aria-checked")).toBe(
      "false",
    );
    await wrapper.get("[role=checkbox]").trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });
});
