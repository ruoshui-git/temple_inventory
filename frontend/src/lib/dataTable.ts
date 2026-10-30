export type TableCellValue = string | number | boolean | null | undefined;

type DataColumnKind =
  | "number"
  | "unit"
  | "code"
  | "date"
  | "datetime"
  | "status"
  | "chip"
  | "thumb"
  | "actions"
  | "text"
  | "primary";

const numberColumns = new Set([
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
  "available_effect",
]);
const dateColumns = new Set([
  "date",
  "posting_date",
  "start_date",
  "end_date",
  "period_from",
  "period_to",
  "expiry_date",
  "manufacturing_date",
  "remaining_days",
  "start",
  "end",
  "expiry",
]);
const dateTimeColumns = new Set([
  "time",
  "date_time",
  "posting_time",
  "posting_timestamp",
  "modified",
  "creation",
  "snapshot",
  "balance_at",
  "baseline_timestamp",
  "created",
  "updated",
]);
const primaryColumns = new Set([
  "item_name",
  "itemName",
  "name",
  "title",
  "activity_title",
  "summary",
  "description",
]);

/** Resolve a semantic width preset for both explicit and legacy column definitions. */
export function dataColumnKind(
  column: Pick<DataColumn, "id" | "label" | "kind">,
): DataColumnKind {
  if (column.kind) return column.kind;
  const id = String(column.id);
  if (id === "quantities") return "text";
  if (numberColumns.has(id) || id.endsWith("_qty") || id.endsWith("_count"))
    return "number";
  if (["uom", "stock_uom", "entered_uom", "unit"].includes(id)) return "unit";
  if (["image", "thumbnail"].includes(id)) return "thumb";
  if (["actions", "_actions"].includes(id) || column.label === "操作")
    return "actions";
  if (
    ["status", "docstatus", "loan_status", "review_state", "outcome"].includes(
      id,
    )
  )
    return "status";
  if (dateTimeColumns.has(id)) return "datetime";
  if (dateColumns.has(id)) return "date";
  if (primaryColumns.has(id)) return "primary";
  if (
    [
      "item_code",
      "code",
      "document",
      "document_id",
      "id",
      "batch",
      "batch_no",
      "line_name",
    ].includes(id)
  )
    return "code";
  if (
    [
      "warehouse",
      "warehouse_label",
      "category",
      "kind",
      "type",
      "activity_type_label",
    ].includes(id)
  )
    return "chip";
  return "text";
}

export function dataColumnPreset(
  column: Pick<DataColumn, "id" | "label" | "kind">,
) {
  const kind = dataColumnKind(column);
  return {
    kind,
    className: `data-column-${kind}`,
  };
}

export interface DataColumn<Row = Record<string, unknown>> {
  id: (keyof Row & string) | string;
  label: string;
  export?: string[];
  defaultVisible?: boolean;
  required?: boolean;
  sortable?: boolean;
  sortField?: string;
  kind?: DataColumnKind;
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
  if (column.kind === "text" || id === "quantities") return "start";
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

interface ReconciledColumns {
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
