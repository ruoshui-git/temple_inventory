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

  it("separates category and code in the eyebrow only when both are shown", () => {
    const both = mount(ItemCard, {
      props: {
        rowKey: "ITEM-2",
        name: "餐盘",
        code: "ITM-000044",
        category: "园艺与户外",
        selecting: false,
        selected: false,
        selectLabel: "选择餐盘",
      },
      global: { stubs: { ItemImage: true } },
    });
    wrappers.push(both);
    expect(both.get(".eyebrow").text().replace(/\s+/g, " ")).toBe(
      "园艺与户外 · ITM-000044",
    );
    expect(both.find(".item-card-separator").exists()).toBe(true);

    const codeOnly = mount(ItemCard, {
      props: {
        rowKey: "ITEM-3",
        name: "餐盘",
        code: "ITM-000045",
        selecting: false,
        selected: false,
        selectLabel: "选择餐盘",
      },
      global: { stubs: { ItemImage: true } },
    });
    wrappers.push(codeOnly);
    expect(codeOnly.get(".eyebrow").text()).toBe("ITM-000045");
    expect(codeOnly.find(".item-card-separator").exists()).toBe(false);
  });
});

describe("ItemCard optional parts", () => {
  it("omits the media frame when media is false and marks the card text-only", () => {
    const wrapper = mount(ItemCard, {
      props: {
        rowKey: "ITEM-2",
        name: "纯文字物品",
        code: "ITEM-2",
        category: "祭器",
        media: false,
        selecting: false,
        selected: false,
        selectLabel: "选择纯文字物品",
      },
      global: { stubs: { ItemImage: true } },
    });
    wrappers.push(wrapper);
    expect(wrapper.find(".item-card-image").exists()).toBe(false);
    expect(wrapper.get(".item-card").classes()).toContain("is-text-only");
    expect(wrapper.text()).toContain("纯文字物品");
  });

  it("keeps the media frame by default", () => {
    const wrapper = mount(ItemCard, {
      props: {
        rowKey: "ITEM-3",
        name: "图片物品",
        selecting: false,
        selected: false,
        selectLabel: "选择图片物品",
      },
      global: { stubs: { ItemImage: true } },
    });
    wrappers.push(wrapper);
    expect(wrapper.find(".item-card-image").exists()).toBe(true);
    expect(wrapper.get(".item-card").classes()).not.toContain("is-text-only");
  });

  it("omits the eyebrow when category and code are undefined", () => {
    const wrapper = mount(ItemCard, {
      props: {
        rowKey: "ITEM-4",
        name: "无分类",
        selecting: false,
        selected: false,
        selectLabel: "选择无分类",
      },
      global: { stubs: { ItemImage: true } },
    });
    wrappers.push(wrapper);
    expect(wrapper.find(".eyebrow").exists()).toBe(false);
  });

  it("renders only the code when category is undefined", () => {
    const wrapper = mount(ItemCard, {
      props: {
        rowKey: "ITEM-5",
        name: "仅编码",
        code: "ITEM-5",
        selecting: false,
        selected: false,
        selectLabel: "选择仅编码",
      },
      global: { stubs: { ItemImage: true } },
    });
    wrappers.push(wrapper);
    expect(wrapper.find(".item-card-category").exists()).toBe(false);
    expect(wrapper.get(".item-card-code").text()).toBe("ITEM-5");
  });

  it("keeps the 未分类 fallback when category is an empty string", () => {
    const wrapper = mount(ItemCard, {
      props: {
        rowKey: "ITEM-6",
        name: "空分类",
        category: "",
        selecting: false,
        selected: false,
        selectLabel: "选择空分类",
      },
      global: { stubs: { ItemImage: true } },
    });
    wrappers.push(wrapper);
    expect(wrapper.get(".item-card-category").text()).toBe("未分类");
  });
});
