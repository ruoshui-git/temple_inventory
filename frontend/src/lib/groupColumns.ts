const impliedByGroup: Record<string, readonly string[]> = {
  item: ["image", "item_name", "item_code", "category", "stock_uom"],
  category: ["category"],
  location: [
    "locations",
    "warehouse",
    "warehouse_label",
    "warehouse_path",
    "warehouse_native_name",
  ],
  batch: ["batches", "batch_no"],
  kind: ["kind", "count_kind"],
  borrower: ["borrower"],
  activity: ["activity_title"],
  source: ["source", "source_warehouse_path", "source_warehouse_native_name"],
  destination: [
    "destination",
    "destination_warehouse_path",
    "destination_warehouse_native_name",
  ],
  status: ["docstatus"],
  outcome: ["outcome"],
};

/** Columns whose value a group key fully determines, so grouped tables need not repeat them. */
export function groupImpliedColumns(groupBy: readonly string[]): string[] {
  const columns = new Set<string>();
  for (const key of groupBy) {
    for (const column of impliedByGroup[key] ?? []) columns.add(column);
  }
  return [...columns];
}
