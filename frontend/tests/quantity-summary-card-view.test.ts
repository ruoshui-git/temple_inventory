import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import QuantitySummary from "../src/components/QuantitySummary.vue";
import InventoryCardGrid from "../src/components/InventoryCardGrid.vue";

describe("quantity summaries and Inventory cards", () => {
  it("keeps incompatible UOM totals separate", () => {
    const wrapper = mount(QuantitySummary, {
      props: {
        metrics: [
          {
            key: "available_stock",
            label: "可用",
            quantities: [
              { uom: "kg", qty: 2.5 },
              { uom: "件", qty: 4 },
            ],
          },
        ],
      },
    });
    expect(wrapper.text()).toContain("2.5 kg");
    expect(wrapper.text()).toContain("4 件");
    expect(wrapper.findAll(".quantity-summary-values strong")).toHaveLength(2);
  });

  it("shows all four stock states and toggles the whole card in selection mode", async () => {
    const wrapper = mount(InventoryCardGrid, {
      props: {
        rows: [
          {
            item_code: "ITEM-1",
            item_name: "大米",
            item_group: "食品",
            stock_uom: "kg",
            available_stock: 8,
            total_stock: 12,
            on_loan_qty: 3,
            damaged_qty: 1,
          },
        ],
        selectionMode: true,
      },
    });
    expect(wrapper.find(".inventory-card-available").text()).toBe("可用8kg");
    expect(wrapper.find(".inventory-card-totals").text()).toContain("总计 12");
    expect(wrapper.find(".inventory-card-totals").text()).toContain("借出 3");
    expect(wrapper.find(".inventory-card-totals").text()).toContain("损坏 1");
    expect(wrapper.find(".inventory-card-totals").text()).toContain("kg");
    await wrapper.find(".inventory-visual-card").trigger("click");
    expect(wrapper.emitted("toggle")?.[0]?.[0]).toMatchObject({
      item_code: "ITEM-1",
    });
    expect(wrapper.emitted("activate")).toBeUndefined();
  });

  it("renders real batch counts and server-relative expiry states", () => {
    const base = {
      item_group: "食品",
      stock_uom: "件",
      available_stock: 1,
      total_stock: 1,
      on_loan_qty: 0,
      damaged_qty: 0,
      has_batch_no: true,
    };
    const wrapper = mount(InventoryCardGrid, {
      props: {
        rows: [
          {
            ...base,
            item_code: "EXPIRED",
            item_name: "过期物品",
            batch_count: 3,
            nearest_expiry_date: "2026-09-20",
            nearest_expiry_days: -9,
          },
          {
            ...base,
            item_code: "SOON",
            item_name: "临期物品",
            batch_count: 2,
            nearest_expiry_date: "2026-10-10",
            nearest_expiry_days: 11,
          },
          {
            ...base,
            item_code: "LATER",
            item_name: "远期物品",
            batch_count: 1,
            nearest_expiry_date: "2027-01-01",
            nearest_expiry_days: 94,
          },
          {
            ...base,
            item_code: "EMPTY",
            item_name: "无批次库存",
            batch_count: 0,
            nearest_expiry_date: null,
            nearest_expiry_days: null,
          },
          {
            ...base,
            item_code: "LEGACY",
            item_name: "旧版响应",
          },
        ],
      },
    });
    const cards = wrapper.findAll(".inventory-visual-card");
    expect(cards[0].text()).toContain("3 批次");
    expect(cards[0].text()).toContain("含过期批次");
    expect(cards[0].text()).toContain("最近效期 2026-09-20");
    expect(cards[0].find(".expiry-badge.danger").exists()).toBe(true);
    expect(cards[1].text()).toContain("2 批次");
    expect(cards[1].text()).toContain("即将到期");
    expect(cards[1].find(".expiry-badge.warning").exists()).toBe(true);
    expect(cards[2].text()).toContain("1 批次");
    expect(cards[2].text()).toContain("最近效期 2027-01-01");
    expect(cards[2].find(".expiry-badge").exists()).toBe(false);
    expect(cards[3].text()).toContain("0 批次");
    expect(cards[3].find(".inventory-card-expiry").exists()).toBe(false);
    expect(cards[4].text()).toContain("批次管理");
  });
});
