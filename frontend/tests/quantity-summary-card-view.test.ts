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
});
