// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import PendingPage from "../src/features/pending/PendingPage.vue";
import { pendingColumns } from "../src/features/pending/pendingColumns";
import { exportFields } from "../src/lib/exportColumns";
import { reportExportColumns } from "../src/lib/reportExportColumns";
import { newReportQuery, type ReportRow } from "../src/lib/reportContract";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { createMemoryHistory, createRouter } from "vue-router";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

const imageUrl = "/files/damaged-tool.jpg";
const row = {
  id: JSON.stringify(["ITEM-A", "DAMAGED / A,1", "BATCH-A"]),
  item_code: "ITEM-A",
  item_name: "损坏工具",
  image: imageUrl,
  warehouse: "DAMAGED / A,1",
  warehouse_label: "损坏待处理 / A",
  batch_no: "BATCH-A",
  stock_uom: "Nos",
  available: 0,
  loaned: 0,
  damaged: 5,
  stock_qty: 5,
};
const table = {
  id: "locations",
  label: "位置",
  columns: [
    "item_name",
    "warehouse_label",
    "batch_no",
    "available",
    "loaned",
    "damaged",
    "stock_qty",
    "stock_uom",
    "item_code",
    "warehouse",
  ],
  rows: [row],
} as never;

describe("damaged page columns", () => {
  it("shows only the damaged column set in stock-page order", () => {
    const columns = pendingColumns(
      reportExportColumns(table, "inventory", ["warehouse"]),
    );
    expect(columns.map((column) => String(column.id))).toEqual([
      "image",
      "item_name",
      "item_code",
      "damaged",
      "stock_uom",
      "batch_no",
      "warehouse_label",
    ]);
    expect(columns.find((column) => column.id === "item_name")).toMatchObject({
      pinned: "start",
    });
    expect(columns.find((column) => column.id === "damaged")?.quantity).toBe(
      true,
    );
  });

  it("exports exactly the visible damaged columns and never the dropped quantities", () => {
    const columns = pendingColumns(
      reportExportColumns(table, "inventory", ["warehouse"]),
    );
    const ids = columns.map((column) => String(column.id));
    const fields = exportFields(columns, ids, ids);
    expect(fields).toEqual([
      "item_name",
      "item_code",
      "damaged",
      "stock_uom",
      "batch_no",
      "warehouse_label",
    ]);
    for (const dropped of ["available", "loaned", "stock_qty"])
      expect(fields).not.toContain(dropped);
    expect(
      exportFields(
        columns,
        ids,
        ids.filter((id) => id !== "batch_no"),
      ),
    ).not.toContain("batch_no");
  });
});

describe("damaged page rendering", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the item thumbnail, never the raw image URL, and unit text for stock_uom", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const reference = createReferenceData();
    Object.assign(reference, {
      user: "volunteer",
      site: "site",
      operations: { Repair: true, Disposal: true },
    });
    const report = vi.fn(async (query: unknown) => ({
      query,
      table: "locations",
      columns: table.columns,
      rows: [row as ReportRow],
      matched_count: 1,
      next_start: null,
      tables: [{ id: "locations", label: "位置", count: 1 }],
      summary: [{ stock_uom: "Nos", damaged: 5 }],
      snapshot: "now",
      period: { date_from: "", date_to: "" },
    }));
    const root = defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report, upload: vi.fn() } as never,
          reference,
        );
        return () =>
          h(PendingPage, { initialQuery: newReportQuery("inventory") });
      },
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/items/:code",
          name: "item-detail",
          component: { template: "<div />" },
        },
      ],
    });
    const wrapper = mount(root, { global: { plugins: [router] } });
    wrappers.push(wrapper);
    await flushPromises();

    const results = wrapper.get(".damaged-results-card");
    const headers = results
      .findAll("thead th:not(.data-table-settings-heading)")
      .map((header) => header.text());
    expect(headers).toEqual([
      "图片",
      "物品名称",
      "物品编号",
      "损坏",
      "库存单位",
      "批次编号",
    ]);
    const cell = results.get(".table-item-image");
    expect(cell.find("button").exists()).toBe(true);
    expect(results.text()).not.toContain(imageUrl);
    expect(results.text()).not.toContain("可用数量");
    expect(results.text()).not.toContain("合计");
    expect(results.get("tbody").text()).toContain("Nos");
  });
});
