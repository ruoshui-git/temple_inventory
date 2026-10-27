import type { DataColumn } from "../../lib/dataTable";

export function itemPickerColumns(
  quantityLabel: string,
  purpose: "inbound" | "outbound" | "damaged" | "count",
  multiple: boolean,
): DataColumn[] {
  const columns: DataColumn[] = [
    {
      id: "image",
      label: "图片",
      kind: "thumb",
      className: "picker-image-column",
      align: "center",
    },
    {
      id: "name",
      label: "物品名称",
      kind: "primary",
      className: "picker-name-column",
    },
    {
      id: "code",
      label: "编号",
      kind: "code",
      className: "picker-code-column",
    },
    {
      id: "category",
      label: "类别",
      kind: "chip",
      className: "picker-category-column",
      defaultVisible: false,
    },
  ];
  if (purpose !== "inbound")
    columns.push({
      id: "warehouse",
      label: "仓库位置",
      kind: "chip",
      className: "picker-warehouse-column",
    });
  columns.push({
    id: "quantity",
    label: quantityLabel,
    kind: "number",
    className: "picker-quantity-column",
    align: "end",
  });
  if (!multiple)
    columns.push({
      id: "action",
      label: "操作",
      kind: "actions",
      align: "end",
    });
  return columns;
}
