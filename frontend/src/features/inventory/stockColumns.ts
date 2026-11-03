import type { DataColumn } from "../../lib/dataTable";
import { expiryStatus, type StockItem } from "../../lib/stockPresentation";
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import type { ReferenceData } from "../../services/contracts";

export function inventoryColumnsForPage(
  desktopColumnsVisible: boolean,
): DataColumn[] {
  return [
    {
      id: "image",
      label: "图片",
      defaultVisible: true,
      export: [],
    },
    {
      id: "item_name",
      pinned: "start",
      label: "物品名称",
      defaultVisible: true,
      export: ["item_name"],
      required: true,
      sortable: true,
    },
    {
      id: "item_code",
      label: "物品编号",
      defaultVisible: true,
      export: ["item_code"],
      sortable: true,
    },
    {
      id: "available",
      quantity: true,
      label: "可用数量",
      defaultVisible: true,
      sortable: true,
      align: "end",
      export: ["available", "stock_uom"],
    },
    {
      id: "stock_uom",
      label: "库存单位",
      defaultVisible: true,
      sortable: true,
      export: ["stock_uom"],
    },
    {
      id: "category",
      label: "类别",
      defaultVisible: desktopColumnsVisible,
      sortable: true,
      export: ["category"],
    },
    {
      id: "locations",
      label: "位置",
      defaultVisible: desktopColumnsVisible,
      kind: "chip",
      export: ["warehouse_label"],
    },
    {
      id: "batches",
      label: "批次",
      defaultVisible: desktopColumnsVisible,
      kind: "chip",
      export: ["batch_no"],
    },
    {
      id: "warehouse_label",
      label: "库位",
      defaultVisible: false,
      export: ["warehouse_label"],
    },
    {
      id: "batch_no",
      label: "批次编号",
      defaultVisible: false,
      export: ["batch_no"],
    },
    {
      id: "serial_nos",
      label: "序列号",
      defaultVisible: false,
      export: ["serial_nos"],
    },
    {
      id: "warehouse_path",
      label: "完整位置",
      defaultVisible: false,
      export: ["warehouse_path"],
    },
    {
      id: "warehouse_native_name",
      label: "ERPNext 库位",
      defaultVisible: false,
      export: ["warehouse_native_name"],
    },
    {
      id: "loaned",
      quantity: true,
      label: "借出",
      defaultVisible: false,
      sortable: true,
      align: "end",
      export: ["loaned", "stock_uom"],
    },
    {
      id: "damaged",
      quantity: true,
      label: "损坏",
      defaultVisible: false,
      sortable: true,
      align: "end",
      export: ["damaged", "stock_uom"],
    },
    {
      id: "total",
      quantity: true,
      label: "合计",
      defaultVisible: false,
      sortable: true,
      sortField: "stock_qty",
      align: "end",
      export: ["stock_qty", "stock_uom"],
    },
    {
      id: "expiry",
      label: "效期",
      defaultVisible: false,
      export: ["expiry_date", "remaining_days", "expiry_state"],
    },
    {
      id: "expiry_date",
      label: "到期日期",
      defaultVisible: false,
      export: ["expiry_date"],
    },
    {
      id: "remaining_days",
      label: "剩余天数",
      defaultVisible: false,
      export: ["remaining_days"],
    },
    {
      id: "expiry_state",
      label: "到期状态",
      defaultVisible: false,
      export: ["expiry_state"],
    },
  ];
}

// Batch-level fields exist only per batch row; any of them needs the batch grain.
const BATCH_LEVEL_COLUMNS = [
  "batches",
  "batch_no",
  "serial_nos",
  "expiry",
  "expiry_date",
  "remaining_days",
  "expiry_state",
];
// Location-level fields need one row per Item and Warehouse, with batches summed.
const LOCATION_LEVEL_COLUMNS = [
  "locations",
  "warehouse_label",
  "warehouse_path",
  "warehouse_native_name",
];

export type StockExportTable = "locations" | "positions" | "summary";

export function stockExportTableFor(
  visibleColumnIds: readonly string[],
): StockExportTable {
  if (visibleColumnIds.some((id) => BATCH_LEVEL_COLUMNS.includes(id)))
    return "locations";
  if (visibleColumnIds.some((id) => LOCATION_LEVEL_COLUMNS.includes(id)))
    return "positions";
  return "summary";
}

export type StockRow = Record<string, unknown>;
export type StockReference = Pick<ReferenceData, "warehouses" | "siteDate">;

export function stockCode(row: StockRow) {
  return String(row.code || row.item_code || "");
}

export function stockName(row: StockRow) {
  return String(row.name || row.item_name || stockCode(row));
}

export function stockIdentity(row: StockRow) {
  return {
    code: stockCode(row),
    name: stockName(row),
    image: String(row.image || ""),
  };
}

export function isStockItemRow(row: StockRow): row is StockRow & StockItem {
  return Array.isArray(row.locations);
}

export function stockLocationLabel(row: StockRow, reference: StockReference) {
  return (
    warehouseLabel(
      row.warehouse || row.warehouse_label,
      reference.warehouses,
      row.warehouse_label,
    ) || "—"
  );
}

export function stockLocationDetail(
  row: StockRow,
  field: "path" | "nativeName",
) {
  if (!isStockItemRow(row))
    return String(
      row[field === "path" ? "warehouse_path" : "warehouse_native_name"] || "",
    );
  return row.locations
    .map((location) => location[field])
    .filter(Boolean)
    .join("；");
}

export function stockWarehousePath(row: StockRow, reference: StockReference) {
  return warehousePath(
    row.warehouse || row.warehouse_label,
    reference.warehouses,
    row.warehouse_label,
  );
}

export function stockComponentDetail(
  row: StockRow,
  field:
    | "warehouse_label"
    | "batch_no"
    | "expiry_date"
    | "remaining_days"
    | "expiry_state",
  siteDate: string,
) {
  const values = isStockItemRow(row)
    ? row.locations.flatMap((location) => {
        if (field === "warehouse_label") return [location.label];
        return (location.batches || []).map((batch) => {
          if (field === "batch_no") return batch.id;
          if (field === "expiry_date") return batch.expiry;
          if (!batch.expiry) return "";
          if (field === "expiry_state")
            return batch.expiry < siteDate ? "已过期" : "未过期";
          return String(
            Math.ceil(
              (Date.parse(`${batch.expiry}T00:00:00Z`) -
                Date.parse(`${siteDate}T00:00:00Z`)) /
                86_400_000,
            ),
          );
        });
      })
    : [row[field]];
  return [
    ...new Set(values.map((value) => String(value || "")).filter(Boolean)),
  ].join("；");
}

/** 效期 badge text: 已过期 / 未过期 for Items with batch expiry, 无效期 for loose rows. */
export function stockExpiryLabel(row: StockRow, siteDate: string) {
  if (isStockItemRow(row)) return expiryStatus(row, siteDate);
  const date = String(row.expiry_date || "");
  return date ? (date < siteDate ? "已过期" : "未过期") : "无效期";
}
