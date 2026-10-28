// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import ReportsPage from "../src/features/export/ReportsPage.vue";
import { newReportQuery } from "../src/lib/reportContract";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

describe("report table sorting", () => {
  it("opens QuickExport from the Reports primary action", async () => {
    const query = newReportQuery("inventory");
    const service: InventoryServices = {
      call: vi.fn(async () => ({ value: false })) as InventoryServices["call"],
      report: vi.fn(async (current) => ({
        query: current,
        scope: current.scope,
        period: { key: "all", date_from: "", date_to: "" },
        snapshot: "2026-10-20 10:00",
        table: "summary",
        columns: ["item_code", "available"],
        rows: [{ id: "row-1", item_code: "ITEM-1", available: 3 }],
        matched_count: 1,
        next_start: null,
        summary: [{ stock_uom: "Nos", available: 3 }],
        tables: [{ id: "summary", label: "库存汇总", count: 1 }],
      })),
      upload: vi.fn(),
    };
    const reference = createReferenceData();
    Object.assign(reference, {
      site: "export-test.local",
      user: "export-user",
    });
    const root = defineComponent({
      setup() {
        provideInventoryServices(service, reference);
        return () => h(ReportsPage, { initialQuery: query });
      },
    });
    const wrapper = mount(root, { attachTo: document.body });
    wrappers.push(wrapper);
    await flushPromises();
    const exportButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("导出"));
    expect(exportButton).toBeDefined();
    await exportButton!.trigger("click");
    await flushPromises();
    expect(document.body.querySelector(".quick-export-dialog")).not.toBeNull();
    expect(wrapper.find(".browse-header-actions .quick-report").exists()).toBe(
      false,
    );
  });

  it("sorts the primary report from its scalar header and refreshes the query", async () => {
    const initial = newReportQuery("inventory");
    const service: InventoryServices = {
      call: vi.fn(async () => ({ value: false })) as InventoryServices["call"],
      report: vi.fn(async (query) => ({
        query,
        scope: query.scope,
        period: { key: "all", date_from: "", date_to: "" },
        snapshot: "2026-10-20 10:00",
        table: "summary",
        columns: ["item_code", "available"],
        rows: [{ id: "row-1", item_code: "ITEM-1", available: 3 }],
        matched_count: 1,
        next_start: null,
        summary: [{ stock_uom: "Nos", available: 3 }],
        tables: [{ id: "summary", label: "库存汇总", count: 1 }],
      })),
      upload: vi.fn(),
    };
    const reference = createReferenceData();
    Object.assign(reference, { site: "sort-test.local", user: "sort-user" });
    const root = defineComponent({
      setup() {
        provideInventoryServices(service, reference);
        return () =>
          h(ReportsPage, { initialQuery: initial }, { default: () => null });
      },
    });
    const wrapper = mount(root, { attachTo: document.body });
    wrappers.push(wrapper);
    await flushPromises();
    const page = wrapper.findComponent(ReportsPage);
    const sortHeader = wrapper
      .findAll(".data-table-sort")
      .find((button) => button.text().includes("可用"));
    expect(sortHeader).toBeDefined();
    await sortHeader!.trigger("click");
    await flushPromises();
    expect(page.vm.controller.query.value).toMatchObject({
      sortBy: "available",
      sort: "asc",
    });
    expect(service.report).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortBy: "available", sort: "asc" }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    await sortHeader!.trigger("click");
    await flushPromises();
    expect(page.vm.controller.query.value.sort).toBe("desc");
  });
});
