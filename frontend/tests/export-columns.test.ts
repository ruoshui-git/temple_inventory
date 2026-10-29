import { describe, expect, it } from "vitest";
import { exportFields } from "../src/lib/exportColumns";

describe("exportFields", () => {
  it("preserves visible screen order, de-duplicates fields, and ignores unknown ids", () => {
    expect(
      exportFields(
        {
          image: ["image_file"],
          qty: ["stock_qty", "stock_uom"],
          otherQty: ["stock_uom"],
          hidden: ["hidden_field"],
        },
        ["qty", "unknown", "image", "otherQty", "hidden"],
        ["qty", "image", "otherQty"],
      ),
    ).toEqual(["stock_qty", "stock_uom", "image_file"]);
  });

  it("keeps visible browse labels aligned with exported headers", () => {
    const labels: Record<string, string> = {
      item_name: "物品名称",
      item_code: "物品编号",
      available: "可用数量",
      stock_uom: "库存单位",
      stock_qty: "合计",
      warehouse_label: "库位",
      warehouse: "位置",
      warehouse_path: "完整位置",
      warehouse_native_name: "ERPNext 库位",
      source_warehouse: "来源位置",
      destination_warehouse: "去向位置",
      source_warehouse_path: "来源完整位置",
      source_warehouse_native_name: "来源 ERPNext 库位",
      destination_warehouse_path: "去向完整位置",
      destination_warehouse_native_name: "去向 ERPNext 库位",
      document: "编号",
      date: "日期",
      kind: "类型",
      quantity: "数量（借出为正，归还为负）",
      outstanding: "未归还数量",
      difference: "差异量",
    };
    const cases = [
      {
        columns: [
          { id: "total", label: "合计" },
          { id: "stock_uom", label: "库存单位" },
        ],
        map: { total: ["stock_qty"], stock_uom: ["stock_uom"] },
      },
      {
        columns: [
          { id: "warehouse", label: "位置" },
          { id: "warehouse_path", label: "完整位置" },
          { id: "warehouse_native_name", label: "ERPNext 库位" },
        ],
        map: {
          warehouse: ["warehouse"],
          warehouse_path: ["warehouse_path"],
          warehouse_native_name: ["warehouse_native_name"],
        },
      },
      {
        columns: [
          { id: "source", label: "来源位置" },
          { id: "destination", label: "去向位置" },
          { id: "source_warehouse_path", label: "来源完整位置" },
          { id: "source_warehouse_native_name", label: "来源 ERPNext 库位" },
          { id: "destination_warehouse_path", label: "去向完整位置" },
          {
            id: "destination_warehouse_native_name",
            label: "去向 ERPNext 库位",
          },
        ],
        map: {
          source: ["source_warehouse"],
          destination: ["destination_warehouse"],
          source_warehouse_path: ["source_warehouse_path"],
          source_warehouse_native_name: ["source_warehouse_native_name"],
          destination_warehouse_path: ["destination_warehouse_path"],
          destination_warehouse_native_name: [
            "destination_warehouse_native_name",
          ],
        },
      },
      {
        columns: [
          { id: "document", label: "编号" },
          { id: "date", label: "日期" },
          { id: "kind", label: "类型" },
          { id: "borrowed", label: "数量（借出为正，归还为负）" },
          { id: "outstanding", label: "未归还数量" },
        ],
        map: {
          document: ["document"],
          date: ["date"],
          kind: ["kind"],
          borrowed: ["quantity"],
          outstanding: ["outstanding"],
        },
      },
      {
        columns: [{ id: "difference", label: "差异量" }],
        map: { difference: ["difference"] },
      },
    ];
    for (const { columns, map } of cases) {
      const fields = exportFields(
        map,
        columns.map((column) => column.id),
        columns.map((column) => column.id),
      );
      expect(fields.map((field) => labels[field])).toEqual(
        columns.flatMap((column) =>
          (map[column.id] || []).map((field) => labels[field]),
        ),
      );
      for (const column of columns) {
        const fieldLabels = (map[column.id] || []).map(
          (field) => labels[field],
        );
        expect(fieldLabels).toEqual(
          fieldLabels.length === 2 && fieldLabels[1] === "库存单位"
            ? [column.label, "库存单位"]
            : [column.label],
        );
      }
    }
  });
});
