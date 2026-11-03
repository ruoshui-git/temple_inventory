import type { DataColumn } from "../../lib/dataTable";
import type { ReportRow } from "../../lib/reportContract";

export const expiryColumnDefinitions: DataColumn[] = [
  { id: "image", label: "图片", defaultVisible: true, export: [] },
  {
    id: "item_name",
    pinned: "start",
    label: "物品名称",
    required: true,
    defaultVisible: true,
    sortable: true,
    export: ["item_name"],
  },
  {
    id: "item_code",
    label: "物品编号",
    defaultVisible: true,
    sortable: true,
    export: ["item_code"],
  },
  {
    id: "category",
    label: "类别",
    defaultVisible: true,
    sortable: true,
    export: ["category"],
  },
  {
    id: "batch_no",
    label: "批次编号",
    required: true,
    defaultVisible: true,
    sortable: true,
    export: ["batch_no"],
  },
  {
    id: "expiry_date",
    label: "到期日期",
    defaultVisible: true,
    sortable: true,
    export: ["expiry_date"],
  },
  {
    id: "expiry_state",
    label: "到期状态",
    defaultVisible: false,
    export: ["expiry_state"],
  },
  {
    id: "remaining_days",
    label: "剩余天数",
    defaultVisible: true,
    sortable: true,
    export: ["remaining_days"],
  },
  {
    id: "stock_qty",
    quantity: true,
    label: "库存数量",
    defaultVisible: true,
    sortable: true,
    align: "end",
    export: ["stock_qty", "stock_uom"],
  },
  {
    id: "stock_uom",
    label: "库存单位",
    defaultVisible: true,
    sortable: true,
    export: ["stock_uom"],
  },
  {
    id: "warehouse",
    label: "位置",
    defaultVisible: true,
    sortable: true,
    export: ["warehouse"],
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
];

/** The 到期状态 badge: expired, expiring within 30 days, not expired, or undated. */
export function expiryStatusOf(row: ReportRow, siteDate: string) {
  if (!row.expiry_date) return { label: "无效期", tone: "is-neutral" };
  if (String(row.expiry_date) < siteDate)
    return { label: "已过期", tone: "is-danger" };
  if (typeof row.remaining_days === "number" && row.remaining_days <= 30)
    return { label: "即将到期", tone: "is-warning" };
  return { label: "未过期", tone: "is-success" };
}

export function expiryRemainingText(days: number) {
  return days < 0
    ? `过期${Math.abs(days)}天`
    : days === 0
      ? "今天到期"
      : `剩${days}天`;
}
