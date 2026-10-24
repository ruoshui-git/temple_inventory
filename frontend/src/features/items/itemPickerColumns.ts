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
      minWidth: "56px",
      className: "picker-image-column",
      align: "center",
    },
    {
      id: "name",
      label: "物品名称",
      minWidth: "180px",
      className: "picker-name-column",
    },
    {
      id: "code",
      label: "编号",
      minWidth: "164px",
      className: "picker-code-column",
    },
    {
      id: "category",
      label: "类别",
      minWidth: "150px",
      className: "picker-category-column",
      defaultVisible: false,
    },
  ];
  if (purpose !== "inbound")
    columns.push({
      id: "warehouse",
      label: "仓库位置",
      minWidth: "112px",
      className: "picker-warehouse-column",
    });
  columns.push({
    id: "quantity",
    label: quantityLabel,
    minWidth: "112px",
    className: "picker-quantity-column",
    align: "end",
  });
  if (!multiple)
    columns.push({
      id: "action",
      label: "操作",
      minWidth: "60px",
      align: "end",
    });
  return columns;
}
