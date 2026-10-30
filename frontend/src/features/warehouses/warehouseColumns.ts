import type { DataColumn } from "../../lib/dataTable";

export const warehouseColumnDefinitions: DataColumn[] = [
  { id: "image", label: "图片", align: "center", export: [] },
  { id: "item_name", label: "物品名称", sortable: true, export: ["item_name"] },
  {
    id: "item_code",
    label: "物品编号",
    sortable: true,
    className: "warehouse-code",
    export: ["item_code"],
  },
  {
    id: "warehouse_label",
    pinned: "start",
    label: "库位",
    sortable: true,
    export: ["warehouse_label"],
  },
  { id: "batch_no", label: "批次编号", sortable: true, export: ["batch_no"] },
  {
    id: "stock_qty",
    quantity: true,
    label: "合计",
    sortable: true,
    align: "end",
    className: "tabular-nums",
    export: ["stock_qty", "stock_uom"],
  },
  {
    id: "stock_uom",
    label: "库存单位",
    defaultVisible: false,
    export: ["stock_uom"],
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
