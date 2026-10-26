// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import StockBrowsePage from "../src/features/inventory/StockBrowsePage.vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
let mobile = false;
const mediaListeners = new Set<(event: { matches: boolean }) => void>();
beforeEach(() => {
  mobile = false;
  mediaListeners.clear();
  localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query.includes("min-width") ? !mobile : false;
      },
      addEventListener: (
        _: string,
        listener: (event: { matches: boolean }) => void,
      ) => mediaListeners.add(listener),
      removeEventListener: (
        _: string,
        listener: (event: { matches: boolean }) => void,
      ) => mediaListeners.delete(listener),
    })),
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("inventory grouped table", () => {
  it("loads category, Item, and stock leaves lazily using projection row fields", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const groupCalls: Array<{
      parent_path: string[];
      parent_unit: string | null;
    }> = [];
    const call = vi.fn(async (endpoint: string, args: Record<string, any>) => {
      if (endpoint === "browse.inventory_page")
        return {
          rows: [
            {
              code: "ITEM-1",
              name: "Noodles",
              image: "",
              category: "Food",
              uom: "Nos",
              available: 4,
              loaned: 0,
              damaged: 0,
              locations: [],
              batches: [],
            },
          ],
          matched_count: 1,
          next_start: null,
          snapshot: "2026-10-20",
          summary: [],
          analysis: { category: [], location: [] },
        };
      if (endpoint === "temple_inventory.projections.group_page") {
        const path = (args.parent_path || []) as string[];
        const unit = (args.parent_unit as string | null) || null;
        groupCalls.push({ parent_path: path, parent_unit: unit });
        if (path.length === 0)
          return {
            rows: [
              {
                id: "category-food",
                row_grain: "group",
                group_path: ["Food"],
                group_depth: 1,
                group_label: "Food",
                has_children: true,
                stock_uom: "Nos",
                item_count: 1,
                row_count: 1,
                available: 4,
              },
            ],
            matched_count: 1,
            next_start: null,
          };
        if (path.length === 1)
          return {
            rows: [
              {
                id: "item-food-noodles",
                row_grain: "group",
                parent_group_id: "category-food",
                group_path: ["Food", "ITEM-1"],
                group_depth: 2,
                group_label: "Noodles",
                has_children: true,
                item_code: "ITEM-1",
                item_name: "Noodles",
                image: "/files/noodles.png",
                category: "Food",
                stock_uom: "Nos",
                item_count: 1,
                row_count: 1,
                available: 4,
              },
            ],
            matched_count: 1,
            next_start: null,
          };
        return {
          rows: [
            {
              id: '["ITEM-1","Main Warehouse","BATCH-1"]',
              item_code: "ITEM-1",
              item_name: "Noodles",
              category: "Food",
              stock_uom: "Nos",
              image: "",
              warehouse: "WH-1",
              warehouse_label: "Main Warehouse",
              batch_no: "BATCH-1",
              expiry_date: "2027-01-30",
              available: 4,
              loaned: 0,
              damaged: 0,
              stock_qty: 4,
            },
          ],
          matched_count: 1,
          next_start: null,
        };
      }
      if (endpoint === "table_preferences.get_column_preferences")
        return { order: [], hidden: [] };
      if (endpoint === "table_preferences.get_presentation_preference")
        return true;
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });
    const reference = createReferenceData();
    reference.user = "manager";
    reference.site = "test";
    const wrapper = mount(
      defineComponent({
        setup() {
          provideInventoryServices(
            { call, report: vi.fn(), upload: vi.fn() },
            reference,
          );
          return () => h(StockBrowsePage);
        },
      }),
      { attachTo: document.body },
    );
    wrappers.push(wrapper);
    await flushPromises();
    const page = wrapper.getComponent(StockBrowsePage);
    page.vm.controller.inStockOnly.value = false;
    await flushPromises();
    const zeroStockChip = wrapper
      .findAll(".browse-active-chip-label")
      .find((chip) => chip.text().includes("零库存"));
    expect(zeroStockChip).toBeDefined();
    await zeroStockChip!.trigger("click");
    await flushPromises();
    const zeroStockDisclosure = document.querySelector<HTMLDetailsElement>(
      '.preview-filter-popover [data-filter-field="includeZero"]',
    );
    expect(zeroStockDisclosure?.open).toBe(true);
    expect(document.activeElement).toBe(
      zeroStockDisclosure?.querySelector('input[type="checkbox"]'),
    );
    document
      .querySelector<HTMLButtonElement>(
        ".preview-filter-popover header button",
      )!
      .click();
    await flushPromises();
    page.vm.controller.inStockOnly.value = true;
    await flushPromises();
    expect(wrapper.find(".stock-grid").exists()).toBe(false);
    expect(
      wrapper.find('[data-browse-scroll="inventory-table"]').exists(),
    ).toBe(true);
    await wrapper
      .get('.segmented button[aria-pressed="false"]')
      .trigger("click");
    expect(wrapper.find(".stock-grid").exists()).toBe(true);
    expect(
      wrapper.find('[data-browse-scroll="inventory-table"]').exists(),
    ).toBe(false);
    await wrapper
      .get('.segmented button[aria-pressed="false"]')
      .trigger("click");
    mobile = true;
    mediaListeners.forEach((listener) => listener({ matches: false }));
    await flushPromises();
    expect(wrapper.find(".stock-list").exists()).toBe(true);
    expect(wrapper.findAll(".stock-list-row").length).toBeGreaterThan(0);
    expect(
      wrapper.find('[data-browse-scroll="inventory-table"]').exists(),
    ).toBe(false);
    page.vm.controller.setGroupBy(["category", "item"]);
    await flushPromises();
    expect(wrapper.find(".stock-grid").exists()).toBe(false);
    expect(
      wrapper.find('[data-browse-scroll="inventory-table"]').exists(),
    ).toBe(true);
    expect(groupCalls).toEqual([{ parent_path: [], parent_unit: null }]);
    await wrapper.get(".data-table-group-toggle").trigger("click");
    await flushPromises();
    expect(groupCalls[1]).toEqual({
      parent_path: ["Food"],
      parent_unit: "Nos",
    });
    const itemGroup = wrapper.findAll(".data-table-group-row")[1]!;
    expect(
      itemGroup.find(".table-item-image .item-image-button").exists(),
    ).toBe(true);
    expect(itemGroup.find(".data-table-group-identity").text()).toContain(
      "库存行数 1",
    );
    await wrapper.findAll(".data-table-group-toggle")[1]!.trigger("click");
    await flushPromises();
    expect(groupCalls[2]).toEqual({
      parent_path: ["Food", "ITEM-1"],
      parent_unit: "Nos",
    });
    expect(wrapper.get('[data-browse-row="ITEM-1"]').text()).toContain(
      "Noodles",
    );
    // At the default 1024px test viewport, location and batch stay behind
    // column settings as secondary detail.
    expect(wrapper.text()).not.toContain("Main Warehouse · BATCH-1");
    expect(wrapper.find('[aria-label="选择Noodles"]').exists()).toBe(true);
    await wrapper.get('[aria-label="选择Noodles"]').setValue(true);
    expect(page.vm.controller.selected.value).toEqual(["ITEM-1"]);
    await wrapper.get(".item-name").trigger("click");
    expect(page.emitted("openItem")).toEqual([["ITEM-1"]]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(
      call.mock.calls.some(
        ([endpoint]) => endpoint === "browse.inventory_page",
      ),
    ).toBe(true);
  });
});
