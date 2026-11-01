import { describe, expect, it } from "vitest";
import type {
  DataTableEntry,
  DataTableGroup,
  DataTableRecord,
} from "../src/lib/dataTable";
import {
  stockGroupedCardSections,
  stockGroupedSelectionKeys,
} from "../src/features/inventory/useStockBrowseController";

const group = (id: string, label: string, depth = 1): DataTableGroup => ({
  kind: "group",
  id,
  label,
  depth,
  count: 2,
  countLabel: "库存行数",
  expanded: true,
  hasChildren: true,
  value: { unit_totals: [{ stock_uom: "个", available: 7 }] },
});
const record = (id: string): DataTableRecord => ({
  kind: "record",
  id,
  value: { code: id },
});

describe("grouped stock cards", () => {
  it("builds labeled, counted sections for top-level and nested groups", () => {
    const sections = stockGroupedCardSections([
      group("location:a", "东库位"),
      record("ITEM-A"),
      group("category:a", "供灯用品", 2),
      record("ITEM-B"),
    ]);
    expect(
      sections.map(({ group: item, rows }) => [
        item.label,
        item.count,
        rows.length,
      ]),
    ).toEqual([
      ["东库位", 2, 1],
      ["供灯用品", 2, 1],
    ]);
    expect(sections[0].group.value?.unit_totals).toEqual([
      { stock_uom: "个", available: 7 },
    ]);
  });

  it("preserves the shared expanded state for collapsed groups", () => {
    const collapsed = { ...group("location:a", "东库位"), expanded: false };
    const [section] = stockGroupedCardSections([collapsed]);
    expect(section.group.expanded).toBe(false);
    expect(section.rows).toEqual([]);
  });

  it("selects loaded records across all expanded groups", () => {
    const entries: DataTableEntry[] = [
      group("location:a", "东库位"),
      record("ITEM-A"),
      group("location:b", "西库位"),
      record("ITEM-B"),
    ];
    expect(stockGroupedSelectionKeys(entries)).toEqual(["ITEM-A", "ITEM-B"]);
  });

  it("includes newly paged rows in the same per-group card section", () => {
    const firstPage = stockGroupedCardSections([
      group("location:a", "东库位"),
      record("ITEM-A"),
    ]);
    const nextPageEntries: DataTableEntry[] = [
      group("location:a", "东库位"),
      record("ITEM-A"),
      record("ITEM-B"),
    ];
    expect(firstPage[0].rows).toHaveLength(1);
    expect(stockGroupedCardSections(nextPageEntries)[0].rows).toHaveLength(2);
    expect(stockGroupedSelectionKeys(nextPageEntries)).toEqual([
      "ITEM-A",
      "ITEM-B",
    ]);
  });
});
