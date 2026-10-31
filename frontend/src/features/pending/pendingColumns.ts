import type { DataColumn } from "../../lib/dataTable";
import { sortableColumnsForView } from "../../lib/reportContract";

/**
 * Damaged rows only ever carry a damaged quantity (available, loaned and total
 * repeat or zero it), so the page shows the stock page's identity order with
 * the damaged quantity in place of the other quantities. Export follows these
 * visible columns, so the export never carries the dropped quantities.
 */
const pendingColumnIds = [
  "image",
  "item_name",
  "item_code",
  "damaged",
  "stock_uom",
  "batch_no",
] as const;

export function pendingColumns(columns: DataColumn[]): DataColumn[] {
  const byId = new Map(columns.map((column) => [String(column.id), column]));
  const sortable = new Set(sortableColumnsForView("inventory", "locations"));
  return pendingColumnIds.flatMap((id) => {
    const column = byId.get(id);
    if (!column) return [];
    return [
      {
        ...column,
        defaultVisible: true,
        pinned: id === "item_name" ? "start" : undefined,
        sortable: sortable.has(id) || undefined,
      },
    ];
  });
}
