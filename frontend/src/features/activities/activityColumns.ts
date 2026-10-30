import type { DataColumn } from "../../lib/dataTable";

export const activityColumns: DataColumn[] = [
  {
    id: "title",
    label: "活动名称",
    export: ["title"],
    required: true,
    defaultVisible: true,
    sortable: true,
    sortField: "title",
  },
  {
    id: "typeId",
    label: "活动类型",
    defaultVisible: true,
    export: ["activity_type_label"],
  },
  {
    id: "period",
    label: "日期",
    export: ["start_date", "end_date"],
    defaultVisible: true,
    sortable: true,
    sortField: "start_date",
  },
  { id: "status", label: "状态", defaultVisible: true, export: ["status"] },
  {
    id: "modified",
    label: "更新",
    hint: "站点时间",
    export: [],
    defaultVisible: true,
    sortable: true,
    sortField: "modified",
  },
  {
    id: "actions",
    label: "关联流动",
    required: true,
    defaultVisible: true,
    export: [],
  },
  {
    id: "start_date",
    label: "开始日期",
    defaultVisible: false,
    export: ["start_date"],
  },
  {
    id: "end_date",
    label: "结束日期",
    defaultVisible: false,
    export: ["end_date"],
  },
  {
    id: "document_count",
    label: "单据数",
    defaultVisible: false,
    export: ["document_count"],
  },
  {
    id: "description",
    label: "说明",
    defaultVisible: false,
    export: ["description"],
  },
  { id: "notes", label: "备注", defaultVisible: false, export: ["notes"] },
];
