import { describe, expect, it } from "vitest";
import { countEditorColumns } from "../src/features/counts/countEditorColumns";
import { nativeRecordColumns } from "../src/features/drafts/nativeRecordColumns";
import { expiryColumnDefinitions } from "../src/features/expiry/expiryColumns";
import { inventoryColumnsForPage } from "../src/features/inventory/stockColumns";
import {
  operationColumnsFor,
  operationItemColumnsFor,
} from "../src/features/movements/operationColumns";
import { warehouseColumnDefinitions } from "../src/features/warehouses/warehouseColumns";

function column(
  columns: {
    id: string;
    pinned?: string;
    quantity?: boolean;
    hint?: string;
    defaultVisible?: boolean;
    label: string;
  }[],
  id: string,
) {
  return columns.find((candidate) => candidate.id === id)!;
}

describe("DataTable column presentation metadata", () => {
  it("pins browse identity columns at the start for each report grain", () => {
    expect(column(inventoryColumnsForPage(true), "item_name").pinned).toBe(
      "start",
    );
    expect(column(expiryColumnDefinitions, "item_name").pinned).toBe("start");
    expect(column(operationColumnsFor("movements"), "document").pinned).toBe(
      "start",
    );
    expect(column(operationColumnsFor("loans"), "document").pinned).toBe(
      "start",
    );
    expect(
      column(
        operationItemColumnsFor("movements", "history", false),
        "item_name",
      ).pinned,
    ).toBe("start");
    expect(
      column(operationItemColumnsFor("loans", "history", false), "item_name")
        .pinned,
    ).toBe("start");
    expect(
      column(operationItemColumnsFor("loans", "history", false), "document")
        .pinned,
    ).toBeUndefined();
    expect(column(nativeRecordColumns("counts"), "document").pinned).toBe(
      "start",
    );
    expect(column(countEditorColumns, "item_name").pinned).toBe("start");
    expect(column(warehouseColumnDefinitions, "warehouse_label").pinned).toBe(
      "start",
    );
  });

  it("keeps the loan quantity label concise and moves sign meaning into a hint", () => {
    const quantity = column(
      operationItemColumnsFor("loans", "history", false),
      "borrowed",
    );
    expect(quantity.label).toBe("借还数量");
    expect(quantity.hint).toBe("借出为正，归还为负");
  });

  it("keeps export-only browse columns hidden by default with current labels", () => {
    expect(column(expiryColumnDefinitions, "expiry_date").label).toBe(
      "到期日期",
    );
    expect(column(expiryColumnDefinitions, "stock_qty").label).toBe("库存数量");
    expect(
      column(operationColumnsFor("movements"), "related_loans").defaultVisible,
    ).toBe(false);
    for (const family of ["movements", "loans"] as const) {
      const columns = operationColumnsFor(family);
      expect(column(columns, "stock_uom").defaultVisible).toBe(false);
      expect(column(columns, "time").defaultVisible).toBe(false);
    }
  });

  it("marks stock and count quantity fields for cell emphasis", () => {
    for (const id of ["available", "loaned", "damaged", "total"])
      expect(column(inventoryColumnsForPage(true), id).quantity).toBe(true);
    for (const id of ["current_qty", "qty", "difference"])
      expect(column(countEditorColumns, id).quantity).toBe(true);
  });
});
