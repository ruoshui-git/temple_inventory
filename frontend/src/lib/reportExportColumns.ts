import type { DataColumn } from "./dataTable";
import { reportColumnLabels } from "./reportCells";
import type { ReportTable } from "./reportContract";

const tableLabels: Record<string, Record<string, string>> = {
  "inventory.summary": { stock_qty: "合计" },
  "inventory.locations": {
    stock_qty: "合计",
    warehouse: "库位",
    warehouse_label: "库位",
  },
  "inventory.balances": { warehouse: "库位" },
  "expiry.batches": {
    stock_qty: "库存数量",
    warehouse: "位置",
    warehouse_label: "库位",
  },
  "movements.records": {
    document: "编号",
    kind: "类型",
    loan_status: "借用状态",
    date: "日期",
    source: "来源位置",
    destination: "去向位置",
    original_loan: "原借出",
    notes: "备注",
    stock_qty: "库存数量",
    activity_title: "活动",
    available_effect: "可用变化",
  },
  "movements.history": {
    document: "编号",
    warehouse: "位置",
    kind: "类型",
    stock_qty: "数量",
    stock_uom: "单位",
    activity_title: "活动",
    available_effect: "可用变化",
  },
  "movements.lines": {
    document: "编号",
    kind: "流动类型",
    activity_title: "活动",
    available_effect: "可用变化",
  },
  "loans.records": {
    activity_title: "活动",
    available_effect: "可用变化",
    kind: "类型",
    notes: "备注",
    document: "编号",
    loan_status: "借用状态",
    returned: "已归还",
    date: "日期",
    borrowed: "借出数量",
    source: "来源位置",
    destination: "去向位置",
  },
  "loans.loan_history": {
    document: "编号",
    date: "日期",
    stock_uom: "单位",
    quantity: "数量",
    activity_title: "活动",
    kind: "类型",
    source_warehouse: "来源位置",
    destination_warehouse: "去向位置",
  },
  "loans.outcomes": {
    activity_title: "活动",
    borrowed: "借出数量",
    date: "借出日期",
    document: "借出单号",
    loan_status: "借用状态",
    source_warehouse: "原位置",
  },
  "counts.records": {
    activity_title: "活动",
    available_effect: "可用变化",
    destination: "去向位置",
    gains: "增加",
    document: "盘点编号",
    kind: "类型",
    loan_status: "借用状态",
    losses: "减少",
    net: "净差异",
    notes: "备注",
    source: "来源位置",
    stock_uom: "单位",
  },
  "counts.lines": {
    activity_title: "活动",
    available_effect: "可用变化",
    kind: "类型",
    notes: "备注",
    document: "盘点编号",
    stock_uom: "单位",
    warehouse: "盘点库位",
  },
  "activities.metadata": {
    activity: "活动编号",
    description: "说明",
    notes: "备注",
    title: "活动名称",
  },
  "activities.records": {
    activity_title: "活动",
    available_effect: "可用变化",
    destination: "去向位置",
    document: "编号",
    kind: "类型",
    loan_status: "借用状态",
    notes: "备注",
    source: "来源位置",
  },
  "activities.outcomes": {
    activity_title: "活动",
    document: "编号",
    loan_status: "借用状态",
  },
};

const quantityFields = new Set([
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
  "stock_qty",
  "entered_qty",
  "quantity",
  "qty",
  "available_effect",
  "gains",
  "losses",
  "net",
]);

/** Data columns used by ReportTable are the table's export declaration. */
export function reportExportColumns(
  table: ReportTable,
  dataset: string,
  hidden: string[] = [],
): DataColumn[] {
  const tableId = `${dataset}.${table.id}`;
  const hasItem = table.rows.some((row) =>
    Boolean(row.item_code || row.itemId),
  );
  const fields = [
    ...(hasItem && !table.columns.includes("image") ? ["image"] : []),
    ...table.columns,
  ];
  return fields
    .filter((field) => field !== "id" && !hidden.includes(field))
    .map((field) => ({
      id: field,
      label:
        tableLabels[tableId]?.[field] ||
        (field === "image" ? "图片" : reportColumnLabels[field] || field),
      defaultVisible: true,
      export: field === "image" ? [] : [field],
      quantity: quantityFields.has(field),
    }));
}
