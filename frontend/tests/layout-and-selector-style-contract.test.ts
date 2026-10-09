import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WarehouseSelector from "../src/components/WarehouseSelector.vue";
import CategorySelector from "../src/components/CategorySelector.vue";
import InventoryFilterPanel from "../src/components/InventoryFilterPanel.vue";

const source = (file: string) =>
  readFileSync(resolve(process.cwd(), file), "utf8").replace(/\s+/g, " ");

describe("shared layout and selector style ownership", () => {
  it("keeps sidebar children in one full-width no-wrap submenu column", () => {
    const shell = source("src/features/shell/ApplicationShellDesktopView.vue");

    expect(shell).toContain(
      ".desktop-inventory-context { display: flex; align-items: stretch; flex-direction: column;",
    );
    expect(shell).toContain(
      ".desktop-inventory-context a { display: flex; align-items: center; box-sizing: border-box; width: 100%;",
    );
    expect(shell).toContain("white-space: nowrap;");
  });

  it("keeps normal and compact Movement desktop chrome as distinct grid states", () => {
    const movements = source("src/features/movements/MovementsView.vue");

    expect(movements).toContain(
      '.movement-ledger-header { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-areas: "heading" "actions" "chips";',
    );
    expect(movements).toContain(
      ".movement-ledger .results-column.compact .movement-ledger-header { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);",
    );
    expect(movements).toContain(
      'grid-template-areas: "heading actions" "chips chips";',
    );
    expect(movements).toContain(
      ".movement-ledger .results-column.compact .compact-heading { display: block;",
    );
    expect(movements).toContain(
      ".movement-ledger .results-column.compact .movement-ledger-actions { flex-wrap: nowrap;",
    );
  });

  it("owns hierarchy styling in the shared core for non-Inventory consumers", () => {
    const panel = source("src/components/InventoryFilterPanel.vue");
    const hierarchy = source("src/components/HierarchyFilter.vue");
    const compact = source("src/components/CompactFilterSection.vue");
    const movements = source("src/features/movements/MovementsView.vue");

    expect(panel).not.toContain(".filter-tree");
    expect(panel).not.toContain(".node-toggle");
    expect(hierarchy).toContain('.hierarchy-row input[type="checkbox"]');
    expect(hierarchy).toContain(".hierarchy-row:hover");
    expect(hierarchy).toContain("inline-size: 13px;");
    expect(hierarchy).toContain("block-size: 13px;");
    expect(hierarchy).toContain("inline-size: 16px;");
    expect(compact).not.toContain(".compact-filter-section-body input,");
    expect(movements).not.toContain(
      ".movement-ledger :deep(.filter-sidebar input),",
    );

    const wrapper = mount(WarehouseSelector, {
      props: {
        modelValue: [],
        counts: { leaf: 2 },
        rows: [
          { name: "root", warehouse_name: "总仓", is_group: 1, lft: 1, rgt: 4 },
          {
            name: "leaf",
            warehouse_name: "A-01",
            parent_warehouse: "root",
            count: 2,
          },
        ],
      },
    });
    expect(wrapper.find(".hierarchy-inline-tree").exists()).toBe(true);
    expect(wrapper.findAll(".hierarchy-row")).toHaveLength(2);
    expect(wrapper.text()).toContain("2");

    const inventory = mount(InventoryFilterPanel, {
      props: {
        modelValue: {
          warehouses: [],
          categories: [],
          inStock: false,
          expiry: "all",
        },
        warehouses: [
          { name: "root", label: "总仓", isGroup: true },
          { name: "leaf", label: "A-01", parent: "root", count: 2 },
        ],
        categories: [],
      },
    });
    const category = mount(CategorySelector, {
      props: {
        modelValue: [],
        rows: [
          { name: "group", item_group_name: "类别", is_group: 1 },
          { name: "item", item_group_name: "子类", parent_item_group: "group" },
        ],
      },
    });
    const inventoryCheckbox = inventory.get('input[type="checkbox"]');
    const categoryCheckbox = category.get('input[type="checkbox"]');
    expect(inventoryCheckbox.classes()).toEqual(categoryCheckbox.classes());
    expect(inventoryCheckbox.element.closest(".hierarchy-row")).not.toBeNull();
    expect(categoryCheckbox.element.closest(".hierarchy-row")).not.toBeNull();
  });
});
