// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import StockDetails from "../src/components/StockDetails.vue";
import {
  inventoryColumnsForPage,
  stockExportTableFor,
} from "../src/features/inventory/stockColumns";
import type { StockItem } from "../src/lib/stockPresentation";

const wrappers: VueWrapper[] = [];

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function item(changes: Partial<StockItem> = {}): StockItem {
  return {
    code: "ITEM-A",
    name: "大米",
    category: "食品",
    uom: "kg",
    available: 8,
    loaned: 0,
    damaged: 0,
    tracksBatch: true,
    tracksExpiry: true,
    locations: [
      {
        location: "ROOM-A",
        label: "东库",
        available: 8,
        loaned: 0,
        damaged: 0,
        batches: [
          { id: "BATCH-A", available: 5, expiry: "2026-10-15" },
          { id: "BATCH-B", available: 3, expiry: "2026-10-16" },
        ],
      },
    ],
    ...changes,
  };
}

function column(id: string, desktop = true) {
  const found = inventoryColumnsForPage(desktop).find(
    (entry) => entry.id === id,
  );
  if (!found) throw new Error(`missing column ${id}`);
  return found;
}

describe("stock columns", () => {
  it("hides 效期 by default and keeps 位置 and 批次 as separate desktop chips", () => {
    expect(column("expiry").defaultVisible).toBe(false);
    expect(column("locations")).toMatchObject({
      label: "位置",
      defaultVisible: true,
      export: ["warehouse_label"],
    });
    expect(column("batches")).toMatchObject({
      label: "批次",
      defaultVisible: true,
      export: ["batch_no"],
    });
    expect(column("locations", false).defaultVisible).toBe(false);
    expect(column("batches", false).defaultVisible).toBe(false);
  });

  it("chooses the export grain from the visible columns", () => {
    expect(stockExportTableFor(["item_name", "available", "stock_uom"])).toBe(
      "summary",
    );
    // Location-level columns alone need one row per Item and Warehouse.
    expect(stockExportTableFor(["item_name", "locations"])).toBe("positions");
    expect(stockExportTableFor(["item_name", "warehouse_label"])).toBe(
      "positions",
    );
    expect(stockExportTableFor(["item_name", "warehouse_path"])).toBe(
      "positions",
    );
    expect(stockExportTableFor(["item_name", "warehouse_native_name"])).toBe(
      "positions",
    );
    // Any batch-level field needs the batch grain, even with location columns.
    for (const id of [
      "batches",
      "batch_no",
      "serial_nos",
      "expiry",
      "expiry_date",
      "remaining_days",
      "expiry_state",
    ]) {
      expect(stockExportTableFor(["locations", id])).toBe("locations");
    }
  });

  it("renders only the requested half of the location and batch chips", () => {
    const locations = mount(StockDetails, {
      props: { item: item(), part: "locations" },
    });
    wrappers.push(locations);
    expect(locations.text()).toContain("东库");
    expect(locations.text()).not.toContain("个批次");

    const batches = mount(StockDetails, {
      props: { item: item(), part: "batches" },
    });
    wrappers.push(batches);
    expect(batches.text()).toContain("2 个批次");
    expect(batches.text()).not.toContain("东库");
  });

  it("shows a dash in the batch chip for items that do not track batches", () => {
    const plain = mount(StockDetails, {
      props: {
        item: item({ tracksBatch: false, tracksExpiry: false, locations: [] }),
        part: "batches",
      },
    });
    wrappers.push(plain);
    expect(plain.text()).toBe("—");
  });
});
