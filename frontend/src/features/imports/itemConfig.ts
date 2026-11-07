export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
}
export const itemImportColumns: ImportColumn[] = [
  { key: "item_code", label: "物品编号" },
  { key: "ti_import_ref", label: "导入参考号" },
  { key: "item_name", label: "物品名称", required: true },
  { key: "item_group", label: "类别" },
  { key: "stock_uom", label: "库存单位", required: true },
  { key: "description", label: "说明" },
  { key: "barcode", label: "条码" },
  { key: "tracking", label: "追踪方式" },
  { key: "has_expiry_date", label: "记录效期" },
  { key: "serial_no_series", label: "编号规则" },
];
export const openingImportColumns: ImportColumn[] = [
  { key: "item_name", label: "物品名称" },
  { key: "item_code", label: "物品编号" },
  { key: "location_label", label: "位置" },
  { key: "qty", label: "数量" },
  { key: "valuation_rate", label: "估值单价" },
  { key: "line_value", label: "估值金额" },
  { key: "batch_no", label: "批次" },
  { key: "serials", label: "序列号" },
];
export const actionLabels: Record<string, string> = {
  NEW: "新建",
  UPDATE: "更新",
  UNCHANGED: "无变化",
  REJECTED: "无法导入",
};
export const openingActionLabels: Record<string, string> = {
  NEW: "新增",
  UNCHANGED: "无变化",
  REJECTED: "无法导入",
};
