export type TableCellValue = string | number | boolean | null | undefined;

export interface DataColumn<Row = Record<string, unknown>> {
  id: (keyof Row & string) | string;
  label: string;
  defaultVisible?: boolean;
  required?: boolean;
  sortable?: boolean;
  sortField?: string;
  minWidth?: string;
  className?: string;
  align?: "start" | "center" | "end";
}

const numericColumnIds = new Set([
  "qty",
  "quantity",
  "whole",
  "transfer_qty",
  "stock_qty",
  "available",
  "loaned",
  "borrowed",
  "returned",
  "damaged",
  "lost",
  "outstanding",
  "opening",
  "incoming",
  "outgoing",
  "adjustment",
  "closing",
  "baseline_qty",
  "actual_qty",
  "current_qty",
  "difference",
  "count",
  "quantities",
]);

/** Shared physical alignment for native tables and dynamic report columns. */
export function dataColumnAlignment(
  column: DataColumn,
): "start" | "center" | "end" {
  if (column.align) return column.align;
  const id = String(column.id);
  if (id === "image" || id === "thumbnail") return "center";
  if (
    numericColumnIds.has(id) ||
    id.endsWith("_qty") ||
    id.endsWith("_count") ||
    column.className?.split(/\s+/).includes("report-quantity-cell")
  )
    return "end";
  return "start";
}

export interface DataTableRecord<Row = Record<string, unknown>> {
  kind: "record";
  id: string;
  value: Row;
  selectable?: boolean;
}

export interface DataTableGroup<Row = Record<string, unknown>> {
  kind: "group";
  id: string;
  parentId?: string;
  label: string;
  labelColumn?: string;
  countColumn?: string;
  depth: number;
  count: number;
  countLabel?: string;
  expanded: boolean;
  hasChildren: boolean;
  loading?: boolean;
  error?: string;
  detailRow?: boolean;
  value?: Row;
}

export type DataTableEntry<Row = Record<string, unknown>> =
  DataTableRecord<Row> | DataTableGroup<Row>;

export interface ColumnPreference {
  order: string[];
  hidden: string[];
}

export interface ReconciledColumns {
  order: string[];
  visible: string[];
}

export interface ColumnPreferencesController {
  order: { value: string[] };
  visible: { value: string[] };
  saveState: { value: "saved" | "saving" | "error" };
  saveError: { value: string };
  toggle: (id: string) => void;
  reorder: (order: string[]) => void;
  reset: () => void;
  retry: () => void;
}

export function reconcileColumns(
  columns: DataColumn[],
  preference?: ColumnPreference | null,
): ReconciledColumns {
  const ids = columns.map((column) => String(column.id));
  const known = new Set(ids);
  const savedOrder = (preference?.order || []).filter(
    (id, index, values) => known.has(id) && values.indexOf(id) === index,
  );
  const savedKnown = new Set(savedOrder);
  const order = [
    ...savedOrder,
    ...ids.filter((id) => !savedOrder.includes(id)),
  ];
  const hidden = new Set(
    (preference?.hidden || []).filter((id) => known.has(id)),
  );
  let visible = order.filter((id) => {
    const column = columns.find((candidate) => String(candidate.id) === id)!;
    if (column.required) return true;
    if (!preference || !savedKnown.has(id))
      return column.defaultVisible !== false;
    return !hidden.has(id);
  });
  if (!visible.length) {
    const fallback = columns.find((column) => column.required) || columns[0];
    if (fallback) visible = [String(fallback.id)];
  }
  return { order, visible };
}

export function moveColumn(order: string[], columnId: string, offset: -1 | 1) {
  const index = order.indexOf(columnId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
