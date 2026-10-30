import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expiryColumnDefinitions } from "../src/features/expiry/expiryColumns";
import { activityColumns } from "../src/features/activities/activityColumns";
import { countEditorColumns } from "../src/features/counts/countEditorColumns";
import { nativeRecordColumns } from "../src/features/drafts/nativeRecordColumns";
import { productBatchColumns } from "../src/features/items/itemDetailColumns";
import { inventoryColumnsForPage } from "../src/features/inventory/stockColumns";
import {
  operationColumnsFor,
  operationItemColumnsFor,
} from "../src/features/movements/operationColumns";
import { warehouseColumnDefinitions } from "../src/features/warehouses/warehouseColumns";
import { exportFields } from "../src/lib/exportColumns";
import { reportExportColumns } from "../src/lib/reportExportColumns";
import type { DataColumn } from "../src/lib/dataTable";

type ExportContract = {
  allowed_columns: Record<string, Record<string, string[]>>;
  labels: Record<string, Record<string, Record<string, string>>>;
};

const contract = JSON.parse(
  readFileSync(
    new URL("./fixtures/export-columns.json", import.meta.url),
    "utf8",
  ),
) as ExportContract;

const inventory = inventoryColumnsForPage(true);
const inventorySummary = inventory.filter((column) =>
  [
    "image",
    "item_name",
    "item_code",
    "available",
    "stock_uom",
    "category",
    "loaned",
    "damaged",
    "total",
    "actions",
  ].includes(String(column.id)),
);
const tables: { dataset: string; table: string; columns: DataColumn[] }[] = [
  { dataset: "inventory", table: "summary", columns: inventorySummary },
  { dataset: "inventory", table: "locations", columns: inventory },
  { dataset: "expiry", table: "batches", columns: expiryColumnDefinitions },
  {
    dataset: "inventory",
    table: "locations",
    columns: warehouseColumnDefinitions,
  },
  {
    dataset: "movements",
    table: "records",
    columns: operationColumnsFor("movements"),
  },
  {
    dataset: "movements",
    table: "history",
    columns: operationItemColumnsFor("movements", "history", false),
  },
  { dataset: "loans", table: "records", columns: operationColumnsFor("loans") },
  {
    dataset: "loans",
    table: "loan_history",
    columns: operationItemColumnsFor("loans", "history", false),
  },
  { dataset: "activities", table: "metadata", columns: activityColumns },
  {
    dataset: "counts",
    table: "records",
    columns: nativeRecordColumns("counts"),
  },
  { dataset: "counts", table: "lines", columns: countEditorColumns },
  { dataset: "inventory", table: "locations", columns: productBatchColumns },
];
const reportTables = [
  ["inventory", "summary"],
  ["inventory", "locations"],
  ["inventory", "balances"],
  ["expiry", "batches"],
  ["movements", "summary"],
  ["movements", "records"],
  ["movements", "lines"],
  ["movements", "history"],
  ["loans", "records"],
  ["loans", "loan_items"],
  ["loans", "outcomes"],
  ["loans", "loan_history"],
  ["activities", "metadata"],
  ["activities", "records"],
  ["activities", "outcomes"],
  ["counts", "records"],
  ["counts", "lines"],
] as const;

describe("exportFields", () => {
  it("preserves visible screen order, de-duplicates fields, and ignores unknown ids", () => {
    expect(
      exportFields(
        [
          { id: "qty", label: "数量", export: ["stock_qty", "stock_uom"] },
          { id: "otherQty", label: "其它数量", export: ["stock_uom"] },
          { id: "hidden", label: "隐藏", export: ["hidden_field"] },
          { id: "image", label: "图片", export: [] },
        ],
        ["qty", "unknown", "image", "otherQty", "hidden"],
        ["qty", "image", "otherQty"],
      ),
    ).toEqual(["stock_qty", "stock_uom"]);
  });

  it("keeps each real browse table within its own backend allow-list and labels", () => {
    const runtimeReportTables = reportTables.map(([dataset, table]) => ({
      dataset,
      table,
      columns: reportExportColumns(
        {
          id: table,
          label: table,
          columns: contract.allowed_columns[dataset]?.[table] || [],
          rows: [],
        },
        dataset,
      ),
    }));
    for (const { dataset, table, columns } of [
      ...tables,
      ...runtimeReportTables,
    ]) {
      const allowed = new Set(contract.allowed_columns[dataset]?.[table] || []);
      const labels = contract.labels[dataset]?.[table] || {};
      for (const column of columns) {
        const fields = column.export || [];
        for (const field of fields)
          expect(
            allowed.has(field),
            `${dataset}.${table}.${String(column.id)} exports disallowed ${field}`,
          ).toBe(true);
        if (fields.length === 1) {
          expect(
            labels[fields[0]!],
            `${dataset}.${table}.${String(column.id)} label`,
          ).toBe(column.label);
        } else if (fields.length === 2 && fields[1] === "stock_uom") {
          expect(labels[fields[0]!]).toBe(column.label);
          expect(labels.stock_uom).toBeTruthy();
          expect(
            columns.some(
              (candidate) =>
                candidate.export?.length === 1 &&
                candidate.export[0] === "stock_uom" &&
                candidate.label === labels.stock_uom,
            ),
          ).toBe(true);
        } else if (fields.length > 1) {
          for (const field of fields)
            expect(
              columns.some(
                (candidate) =>
                  candidate.export?.length === 1 &&
                  candidate.export[0] === field &&
                  candidate.label === labels[field],
              ),
              `${dataset}.${table}.${String(column.id)} needs standalone ${field}`,
            ).toBe(true);
        }
      }
    }
  });

  it("keeps dashboard dataset-selection exports on backend defaults because no table is previewed", () => {
    expect(contract.allowed_columns).toHaveProperty("inventory");
    expect(contract.allowed_columns).toHaveProperty("movements");
  });
});
