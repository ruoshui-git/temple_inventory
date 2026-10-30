import type { DataColumn } from "../../lib/dataTable";

export function nativeRecordColumns(mode: "drafts" | "counts"): DataColumn[] {
  if (mode !== "counts")
    return [
      {
        id: "document",
        label: "编号",
        required: true,
        defaultVisible: true,
        pinned: "start",
      },
      { id: "kind", label: "类型 / 状态", defaultVisible: true },
      { id: "activity_title", label: "活动 / 借用人", defaultVisible: true },
      { id: "summary", label: "整份记录", defaultVisible: true },
      { id: "date", label: "记账日期", defaultVisible: true, sortable: true },
      {
        id: "actions",
        label: "操作",
        required: true,
        defaultVisible: true,
        export: [],
      },
    ];
  return [
    {
      id: "document",
      pinned: "start",
      label: "盘点编号",
      required: true,
      defaultVisible: true,
      kind: "primary",
      className: "count-record-id-column",
      export: ["document"],
    },
    { id: "count_kind", label: "类型", defaultVisible: true, export: ["kind"] },
    {
      id: "status",
      label: "状态",
      defaultVisible: true,
      kind: "status",
      export: ["docstatus"],
    },
    {
      id: "count_scope",
      label: "盘点范围",
      defaultVisible: true,
      export: ["count_scope"],
    },
    {
      id: "line_count",
      label: "明细数",
      defaultVisible: false,
      align: "end",
      export: [],
    },
    {
      id: "item_count",
      label: "物品种数",
      defaultVisible: true,
      align: "end",
      export: ["item_count"],
    },
    {
      id: "gains",
      label: "增加",
      defaultVisible: true,
      export: ["gains"],
      quantity: true,
    },
    {
      id: "losses",
      label: "减少",
      defaultVisible: true,
      export: ["losses"],
      quantity: true,
    },
    {
      id: "net",
      label: "净差异",
      defaultVisible: true,
      export: ["net"],
      quantity: true,
    },
    {
      id: "date",
      label: "日期",
      defaultVisible: true,
      sortable: true,
      kind: "date",
      export: ["date"],
    },
    {
      id: "activity_title",
      label: "活动",
      defaultVisible: true,
      export: ["activity_title"],
    },
    { id: "time", label: "时间", defaultVisible: false, export: ["time"] },
    {
      id: "baseline_qty",
      label: "账面数量",
      defaultVisible: false,
      export: ["baseline_qty"],
    },
    {
      id: "actual_qty",
      quantity: true,
      label: "已核对实点",
      defaultVisible: false,
      export: ["actual_qty"],
    },
    {
      id: "difference",
      quantity: true,
      label: "差异量",
      defaultVisible: false,
      export: ["difference"],
    },
    {
      id: "stock_uom",
      label: "单位",
      defaultVisible: false,
      export: ["stock_uom"],
    },
  ];
}
