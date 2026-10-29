// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
  type ExportJob,
  type InventoryServices,
  type ReportPage,
} from "../src/services/contracts";
import { newReportQuery } from "../src/lib/reportContract";
import { useStockBrowseController } from "../src/features/inventory/useStockBrowseController";
import { useReportController } from "../src/features/export/useReportController";
import { useDashboardController } from "../src/features/dashboard/useDashboardController";
import { useQuickExport } from "../src/features/export/useQuickExport";
import { useExportWorkspaceController } from "../src/features/export/useReportController";
import QuickExport from "../src/components/QuickExport.vue";
import {
  browseDestination,
  countDestination,
  loanDestination,
  operationDestination,
  personDestination,
} from "../src/lib/nativeNavigation";
import DashboardView from "../src/features/dashboard/DashboardView.vue";
import { RouterLinkStub } from "./support/RouterLinkStub";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const query = () => newReportQuery("inventory");
function page(overrides: Partial<ReportPage> = {}): ReportPage {
  return {
    query: query(),
    scope: query().scope,
    period: { key: "all", date_from: "", date_to: "" },
    snapshot: "2026-10-16 11:00",
    table: "summary",
    columns: ["id", "item_code", "available"],
    rows: [{ id: "A", item_code: "A", available: 3 }],
    matched_count: 205,
    next_start: 30,
    summary: [{ stock_uom: "个", available: 615 }],
    tables: [
      { id: "summary", label: "汇总", count: 205 },
      { id: "locations", label: "明细", count: 410 },
    ],
    ...overrides,
  };
}
function services(): InventoryServices {
  return {
    call: vi.fn(async () => []) as InventoryServices["call"],
    report: vi.fn(async () => page()),
    upload: vi.fn(),
  };
}
function setup<T>(service: InventoryServices, controller: () => T) {
  let result!: T;
  const child = defineComponent({
    setup() {
      result = controller();
      return () => h("div");
    },
  });
  const root = defineComponent({
    setup() {
      const reference = createReferenceData();
      reference.siteDate = "2026-10-16";
      provideInventoryServices(service, reference);
      return () => h(child);
    },
  });
  wrappers.push(mount(root));
  return result;
}
async function setNativeSelect(element: Element, value: string) {
  (element as HTMLSelectElement).value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
  await Promise.resolve();
}
const job = (status: ExportJob["status"] = "Queued"): ExportJob => ({
  name: "EXPORT-1",
  status,
  progress: status === "Completed" ? 100 : 0,
  error: "",
  version: "v1",
  attempt: 1,
  generated_at: "",
  row_count: 205,
  download_url:
    status === "Completed"
      ? "/api/method/temple_inventory.exports.download_export?name=EXPORT-1"
      : null,
});

const stockPage = (code: string, overrides: Record<string, unknown> = {}) => ({
  rows: [
    {
      code,
      name: code,
      category: "物品",
      uom: "个",
      available: 1,
      loaned: 0,
      damaged: 0,
      tracksBatch: false,
      tracksExpiry: false,
      locations: [],
    },
  ],
  matched_count: 205,
  next_start: 30,
  summary: [{ stock_uom: "个", available: 615 }],
  snapshot: "2026-10-16 11:00",
  query: query(),
  analysis: { category: [], location: [] },
  ...overrides,
});

describe("scope and permission refresh boundaries", () => {
  it("does not request or canonicalize a malformed stock scope", async () => {
    const service = services(),
      props = reactive({
        initialQuery: query(),
        queryError: "链接中的范围无效",
      }),
      changed = vi.fn();
    vi.mocked(service.call).mockResolvedValue(stockPage("A"));
    const controller = setup(service, () =>
      useStockBrowseController(props, vi.fn(), vi.fn(), changed),
    );
    await flushPromises();
    expect(service.call).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    props.queryError = "";
    await flushPromises();
    expect(controller.data.rows[0]?.code).toBe("A");
    vi.mocked(service.call).mockRejectedValueOnce(
      Object.assign(new Error("已无权读取"), {
        status: 403,
        kind: "PermissionError",
      }),
    );
    await controller.load();
    expect(controller.data.rows).toEqual([]);
    expect(controller.data.summary).toEqual([]);
    expect(controller.data.error).toBe("已无权读取");
  });
  it("removes permission-revoked report data and retains the chosen query", async () => {
    const service = services(),
      current = ref(query());
    const controller = setup(service, () =>
      useReportController(current, { personalViews: false }),
    );
    await flushPromises();
    expect(controller.mainTable.value?.rows).toHaveLength(1);
    vi.mocked(service.report).mockRejectedValueOnce(
      Object.assign(new Error("已无权读取"), {
        status: 403,
        kind: "PermissionError",
      }),
    );
    await controller.refresh();
    expect(controller.result.tables).toEqual([]);
    expect(controller.result.summary).toEqual([]);
    expect(controller.result.error).toBe("已无权读取");
    expect(current.value.dataset).toBe("inventory");
  });
  it("blocks malformed export scopes until an explicit reset and routes historical inventory to its report", async () => {
    const service = services(),
      changed = vi.fn();
    const controller = setup(service, () =>
      useExportWorkspaceController({ routeQuery: "{" }, changed),
    );
    await flushPromises();
    expect(controller.routeError.value).toBeTruthy();
    expect(service.report).toHaveBeenCalledOnce();
    expect(vi.mocked(service.report).mock.calls[0]?.[0]).toMatchObject({
      dataset: "inventory",
      view: "summary",
    });
    expect(changed).not.toHaveBeenCalled();
    controller.clear();
    await flushPromises();
    expect(service.report).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
    const historical = { ...query(), view: "historical" };
    expect(browseDestination(historical)).toMatchObject({
      name: "reports",
      query: {
        query: JSON.stringify({ dataset: "inventory", view: "historical" }),
      },
    });
  });
});

describe("native browse service controllers", () => {
  it("builds person record routes from the shared browse destination", () => {
    const target = personDestination("张三", "handler");
    expect(target.name).toBe("movements");
    expect(target.query?.view).toBe("records");
    expect(JSON.parse(String(target.query?.query))).toMatchObject({
      person: { name: "张三", role: "handler" },
    });
  });
  it("routes Loan links from batch movement history to the loan detail and back", () => {
    expect(loanDestination("Loan / 01", "/batches/BATCH-1")).toEqual({
      name: "loan-overview",
      params: { name: "Loan / 01" },
      query: { back: "/batches/BATCH-1" },
    });
  });

  it("keeps complete server totals, selection and valid rows on a failed next page", async () => {
    const service = services();
    vi.mocked(service.call)
      .mockResolvedValueOnce(stockPage("A"))
      .mockRejectedValueOnce(new Error("下一页失败"))
      .mockResolvedValueOnce(stockPage("B", { next_start: null }));
    const controller = setup(service, () =>
      useStockBrowseController({}, vi.fn(), vi.fn()),
    );
    await flushPromises();
    controller.toggle("A");
    expect(controller.data.total).toBe(205);
    expect(controller.metrics.value[0]!.quantities).toEqual([
      { uom: "个", qty: 615 },
    ]);
    await controller.load(true);
    expect(controller.data.rows.map((row) => row.code)).toEqual(["A"]);
    expect(controller.data.moreError).toBe("下一页失败");
    expect(controller.selected.value).toEqual(["A"]);
    await controller.load(true);
    expect(controller.data.rows.map((row) => row.code)).toEqual(["A", "B"]);
    expect(controller.data.total).toBe(205);
    expect(controller.data.next).toBeNull();
  });
  it("keeps load-more local and distinguishes it from a stale full refresh", async () => {
    const service = services(),
      pending = deferred<any>(),
      refreshPending = deferred<any>();
    vi.mocked(service.call)
      .mockResolvedValueOnce(stockPage("A"))
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(refreshPending.promise);
    const controller = setup(service, () =>
      useStockBrowseController({}, vi.fn(), vi.fn()),
    );
    await flushPromises();
    const nextPage = controller.load(true);
    expect(controller.loadingMore.value).toBe(true);
    expect(controller.status.value).toBe("more");
    pending.resolve(stockPage("B", { next_start: null }));
    await nextPage;
    expect(controller.loadingMore.value).toBe(false);
    expect(controller.status.value).toBe("ready");

    const refresh = controller.load(false, true);
    expect(controller.data.stale).toBe(true);
    expect(controller.data.refreshFailed).toBe(false);
    expect(controller.status.value).toBe("refresh");
    expect(controller.data.rows.map((row) => row.code)).toEqual(["A", "B"]);
    refreshPending.reject(new Error("刷新失败"));
    await refresh;
    expect(controller.data.rows.map((row) => row.code)).toEqual(["A", "B"]);
    expect(controller.data.stale).toBe(false);
    expect(controller.data.refreshFailed).toBe(true);
    expect(controller.status.value).toBe("ready");
  });
  it("ignores late results and preserves restrictive-empty inherited scope when clearing filters", async () => {
    const service = services(),
      first = deferred<unknown>();
    vi.mocked(service.call)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(stockPage("NEW"));
    const incoming = query();
    incoming.restrictItems = true;
    incoming.itemCodes = [];
    incoming.restrictAllocations = true;
    incoming.allocationKeys = ["ALLOCATION-EXACT"];
    const props = reactive({ initialQuery: incoming });
    const controller = setup(service, () =>
      useStockBrowseController(props, vi.fn(), vi.fn()),
    );
    controller.search.value = "新";
    await flushPromises();
    expect(controller.data.rows[0]?.code).toBe("NEW");
    first.resolve(stockPage("OLD"));
    await flushPromises();
    expect(controller.data.rows[0]?.code).toBe("NEW");
    expect(controller.query.value.restrictItems).toBe(true);
    expect(controller.query.value.itemCodes).toEqual([]);
    controller.clear();
    expect(controller.query.value.restrictItems).toBe(true);
    expect(controller.query.value.restrictAllocations).toBe(true);
    expect(controller.query.value.allocationKeys).toEqual(["ALLOCATION-EXACT"]);
  });
  it("loads detail tables independently and does not replace a new report with an old response", async () => {
    const service = services(),
      old = deferred<ReportPage>(),
      current = ref(query());
    vi.mocked(service.report)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page({ rows: [{ id: "NEW", item_code: "NEW" }] }))
      .mockRejectedValueOnce(new Error("明细失败"))
      .mockResolvedValueOnce(
        page({
          table: "locations",
          rows: [{ id: "LOCATION" }],
          matched_count: 410,
        }),
      );
    const controller = setup(service, () => useReportController(current));
    current.value.search = "新";
    await flushPromises();
    old.resolve(page({ rows: [{ id: "OLD" }] }));
    await flushPromises();
    expect(controller.mainTable.value?.rows[0]?.id).toBe("NEW");
    const details = controller.result.tables.find(
      (row) => row.id === "locations",
    )!;
    await controller.loadTable(details);
    expect(details.error).toBe("明细失败");
    expect(controller.mainTable.value?.rows[0]?.id).toBe("NEW");
    await controller.loadTable(details);
    expect(details.rows[0]?.id).toBe("LOCATION");
    expect(details.total).toBe(410);
  });
});

describe("background quick export", () => {
  it("counts the selected page table and exports one table with page options", async () => {
    const service = services();
    vi.mocked(service.call).mockResolvedValue(job());
    const child = defineComponent({
      setup() {
        provideInventoryServices(service, createReferenceData());
        return () =>
          h(QuickExport, {
            query: query(),
            title: "库存列表",
            table: "locations",
            columns: ["item_code", "stock_qty"],
          });
      },
    });
    const wrapper = mount(child);
    wrappers.push(wrapper);
    await wrapper.get(".quick-report").trigger("click");
    await flushPromises();
    expect(vi.mocked(service.report)).toHaveBeenCalledWith(
      expect.anything(),
      { table: "locations", page_length: 1 },
      expect.any(AbortSignal),
    );
    const dialog = document.body.querySelector(".quick-export-dialog")!;
    expect(dialog.textContent).toContain("共 205 行");
    expect(dialog.querySelector(".report-table")).toBeNull();
    expect(dialog.textContent).not.toContain("打开报表");
    expect(dialog.textContent).not.toContain("预览");
    expect(dialog.textContent).toContain("图片以物品编号命名");
    Array.from(dialog.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "开始导出")!
      .click();
    await flushPromises();
    expect(vi.mocked(service.call)).toHaveBeenCalledWith(
      "exports.request_export",
      expect.objectContaining({
        export_format: "xlsx",
        table: "locations",
        columns: ["item_code", "stock_qty"],
        include_files: "none",
        summary: { title: "库存列表", filters: [] },
      }),
    );
  });

  it("sends grouping only for grouped XLSX, plus file choice and visible filter labels", async () => {
    const service = services();
    const groupedQuery = query();
    groupedQuery.groupBy = ["kind"];
    vi.mocked(service.call).mockResolvedValue(job());
    const controller = setup(service, () => useQuickExport(ref(groupedQuery)));
    controller.open.value = true;
    await flushPromises();
    controller.includeFiles.value = "images";
    await controller.generate();
    expect(vi.mocked(service.call).mock.calls[0]).toEqual([
      "exports.request_export",
      expect.objectContaining({ grouped: true, include_files: "images" }),
    ]);
    controller.format.value = "csv";
    await flushPromises();
    expect(controller.job.value).toBeUndefined();
    await controller.generate();
    expect(vi.mocked(service.call).mock.calls[1]?.[1]).not.toHaveProperty(
      "grouped",
    );
  });

  it("previews and exports a dashboard-selected dataset without committing on cancel", async () => {
    localStorage.clear();
    const service = services();
    const baseQuery = query();
    const queryForDataset = (dataset: ReportQuery["dataset"]) => {
      const next = newReportQuery(dataset);
      next.scope = structuredClone(baseQuery.scope);
      return next;
    };
    vi.mocked(service.call).mockImplementation(async (method) => {
      if (method === "exports.request_export") return job("Completed");
      return undefined as never;
    });
    vi.mocked(service.report).mockImplementation(async (selected) =>
      page({
        query: structuredClone(selected),
        scope: structuredClone(selected.scope),
      }),
    );
    const reference = createReferenceData();
    const committed = vi.fn();
    const child = defineComponent({
      setup() {
        return () =>
          h(QuickExport, {
            query: baseQuery,
            title: "首页",
            queryForDataset,
            initialDataset: "inventory",
            allowDatasetSelection: true,
            onCommitDataset: committed,
          });
      },
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideInventoryServices(service, reference);
          return () => h(child);
        },
      }),
    );
    wrappers.push(wrapper);
    await wrapper.get(".quick-report").trigger("click");
    await flushPromises();
    expect(
      document.body.querySelector('select[aria-label="数据范围"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector('select[aria-label="格式"]'),
    ).not.toBeNull();
    expect(document.body.querySelector(".report-table")).toBeNull();
    expect(
      document.body.querySelector('select[aria-label="XLSX 预览表"]'),
    ).toBeNull();
    const dataset = document.body.querySelector(".ui-dialog select")!;
    await setNativeSelect(dataset, "movements");
    await flushPromises();
    expect(vi.mocked(service.report).mock.calls.at(-1)?.[0].dataset).toBe(
      "movements",
    );
    await Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "关闭")!
      .click();
    await flushPromises();
    expect(committed).not.toHaveBeenCalled();

    await wrapper.get(".quick-report").trigger("click");
    await flushPromises();
    const reopenedDataset = document.body.querySelector(".ui-dialog select")!;
    expect((reopenedDataset as HTMLSelectElement).value).toBe("inventory");
    await setNativeSelect(reopenedDataset, "movements");
    await flushPromises();
    await Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "开始导出")!
      .click();
    await flushPromises();

    const exportRequest = vi
      .mocked(service.call)
      .mock.calls.find(([method]) => method === "exports.request_export");
    expect(exportRequest?.[1]).toMatchObject({
      query: { dataset: "movements" },
      include_files: "none",
      summary: { title: "首页" },
    });
    expect(committed).toHaveBeenCalledWith("movements");
    await setNativeSelect(
      document.body.querySelector(".ui-dialog select")!,
      "counts",
    );
    await flushPromises();
    expect(vi.mocked(service.report).mock.calls.at(-1)?.[0].dataset).toBe(
      "counts",
    );
    expect(document.body.textContent).not.toContain("已生成");
  });

  it("keeps a pending job after a status failure and retries reading without creating another", async () => {
    const service = services();
    vi.mocked(service.call)
      .mockResolvedValueOnce(job())
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce(job("Completed"));
    const controller = setup(service, () => useQuickExport(ref(query())));
    controller.open.value = true;
    await flushPromises();
    await controller.generate();
    await flushPromises();
    expect(controller.generating.value).toBe(true);
    expect(controller.canGenerate.value).toBe(false);
    expect(controller.error.value).toBe("网络中断");
    await controller.generate();
    await controller.status();
    expect(controller.job.value?.download_url).toBe(
      "/api/method/temple_inventory.exports.download_export?name=EXPORT-1",
    );
    expect(
      vi
        .mocked(service.call)
        .mock.calls.filter(([method]) => method === "exports.request_export"),
    ).toHaveLength(1);
  });
  it("backs off export polling from 500 ms to 750 ms and displays worker progress", async () => {
    vi.useFakeTimers();
    const service = services();
    vi.mocked(service.call)
      .mockResolvedValueOnce(job())
      .mockResolvedValueOnce({
        ...job(),
        stage: "读取数据",
        progress_detail: "已读取 250 行",
      })
      .mockResolvedValueOnce({ ...job("Completed"), stage: "完成" });
    const controller = setup(service, () => useQuickExport(ref(query())));
    controller.open.value = true;
    await flushPromises();
    await controller.generate();
    await flushPromises();
    expect(controller.job.value?.stage).toBe("读取数据");
    await vi.advanceTimersByTimeAsync(499);
    expect(vi.mocked(service.call)).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(vi.mocked(service.call)).toHaveBeenCalledTimes(3);
    expect(controller.job.value?.status).toBe("Completed");
  });

  it("streams a completed export, uses the UTF-8 server filename, and blocks duplicate downloads", async () => {
    const service = services();
    const controller = setup(service, () => useQuickExport(ref(query())));
    controller.job.value = {
      ...job("Completed"),
      download_url:
        "/api/method/temple_inventory.exports.download_export?name=EXPORT-1",
      file_label: "库存明细.xlsx",
    };
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
      .mockImplementationOnce(async () => {
        await pending;
        return { done: true, value: undefined };
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-disposition"
              ? "attachment; filename*=UTF-8''%E5%BA%93%E5%AD%98%E6%98%8E%E7%BB%86.xlsx"
              : name === "content-length"
                ? "3"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: { getReader: () => ({ read }) },
      })),
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:export"),
      revokeObjectURL: vi.fn(),
    });
    let downloadedFilename = "";
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function () {
        downloadedFilename = this.download;
      });
    const downloading = controller.download();
    await flushPromises();
    expect(controller.downloading.value).toBe(true);
    await controller.download();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    release();
    await downloading;
    expect(click).toHaveBeenCalledOnce();
    expect(downloadedFilename).toBe("库存明细.xlsx");
    expect(controller.downloading.value).toBe(false);
  });
  it("drops a completed or failed job when format changes and makes a new request", async () => {
    const service = services();
    vi.mocked(service.call)
      .mockResolvedValueOnce(job("Failed"))
      .mockResolvedValueOnce(job("Completed"));
    const controller = setup(service, () => useQuickExport(ref(query())));
    controller.open.value = true;
    await flushPromises();
    await controller.generate();
    expect(controller.job.value?.status).toBe("Failed");
    controller.format.value = "csv";
    await flushPromises();
    expect(controller.job.value).toBeUndefined();
    await controller.generate();
    expect(vi.mocked(service.call).mock.calls[1]).toEqual([
      "exports.request_export",
      expect.objectContaining({ export_format: "csv", include_files: "none" }),
    ]);
  });
  it("ignores late polling after closing and resumes the same job on reopening", async () => {
    const service = services(),
      pending = deferred<ExportJob>();
    vi.mocked(service.call)
      .mockResolvedValueOnce(job())
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(job("Completed"));
    const controller = setup(service, () => useQuickExport(ref(query())));
    controller.open.value = true;
    await flushPromises();
    await controller.generate();
    controller.open.value = false;
    await flushPromises();
    pending.resolve(job("Failed"));
    await flushPromises();
    expect(controller.job.value?.status).toBe("Queued");
    controller.open.value = true;
    await flushPromises();
    expect(controller.job.value?.status).toBe("Completed");
    expect(
      vi
        .mocked(service.call)
        .mock.calls.filter(([method]) => method === "exports.request_export"),
    ).toHaveLength(1);
  });
});

describe("native dashboard cards", () => {
  it("routes permission-qualified dashboard actions and keeps uncategorized in shared filters", async () => {
    localStorage.clear();
    const service = services();
    vi.mocked(service.call).mockImplementation(
      async (_endpoint, args) =>
        ({
          query: query(),
          snapshot: "dashboard-test",
          rows:
            args?.card === "distribution"
              ? args.distribution === "category"
                ? [{ id: "", label: "无分类", item_count: 2 }]
                : Array.from({ length: 9 }, (_, index) => ({
                    id: `L${index}`,
                    label: `位置 ${index}`,
                    item_count: 10 - index,
                  }))
              : args?.card === "movement"
                ? []
                : [],
          empty_count:
            args?.card === "distribution" && args.distribution !== "category"
              ? 2
              : 0,
          empty_labels: ["空位置甲", "空位置乙"],
          expiry_preview_limit: 5,
          expiry_rows: {
            expired: [
              {
                item_code: "I1",
                item_name: "物资一",
                batch_no: "B1",
                expiry_date: "2026-10-01",
                warehouse: "A",
                available: 1,
                stock_uom: "Nos",
              },
            ],
            upcoming: [
              {
                item_code: "I2",
                item_name: "物资二",
                batch_no: "B2",
                expiry_date: "2026-11-01",
                warehouse: "A",
                available: 1,
                stock_uom: "Nos",
              },
            ],
          },
          kind_counts: { Issue: 1 },
          totals:
            args?.card === "movement"
              ? ["Nos", "Box", "Set"].map((stock_uom, index) => ({
                  kind: "Issue",
                  stock_qty: 9 - index,
                  stock_uom,
                  available_effect: -1,
                }))
              : args?.card === "inventory"
                ? ["Nos", "Box", "Set", "Kg"].map((stock_uom) => ({
                    available: 1,
                    stock_qty: 1,
                    loaned: 1,
                    damaged: 1,
                    stock_uom,
                  }))
                : [],
          buckets: [
            { id: "expired_1_30", count: 3 },
            { id: "expired_31_90", count: 2 },
            { id: "expired_91_plus", count: 1 },
            { id: "upcoming_0_30", count: 4 },
            { id: "upcoming_31_90", count: 2 },
            { id: "upcoming_91_plus", count: 1 },
          ],
          matched_count: 0,
          item_count: args?.card === "distribution" ? 20 : 0,
          expired_count: 0,
          damaged_item_count: 0,
        }) as never,
    );
    const reference = createReferenceData();
    Object.assign(reference, {
      site: "dashboard-actions.local",
      siteDate: "2026-10-16",
      user: "planner",
      capabilities: {
        "Stock Entry": { create: true, read: true },
        "Stock Reconciliation": { create: true },
      },
      operations: {
        Receive: true,
        Issue: true,
        Loan: true,
        Transfer: true,
        Return: true,
        Damage: true,
        Loss: true,
        Repair: true,
        Disposal: true,
        Reconcile: true,
      },
      warehouses: [
        {
          name: "ROOM-A",
          label: "A02",
          local_label: "演示室甲",
          short_label: "A02",
          full_label: "演示室甲",
          path: "T2 / A02",
          search_text: "T2 A02 演示室甲",
          kind: "room",
          owner: "",
          direct: false,
          storable: true,
          missing_direct: false,
          parent: "T2",
          is_group: true,
          disabled: false,
          version: "v1",
          protected: false,
          can_edit: true,
          lft: 1,
          rgt: 2,
        },
      ],
      categories: [
        {
          name: "CATEGORY-A",
          label: "服装",
          local_label: "服装",
          is_group: false,
          lft: 1,
          rgt: 2,
        },
      ],
    });
    const navigate = vi.fn();
    let controller!: ReturnType<typeof useDashboardController>;
    const view = defineComponent({
      setup() {
        controller = useDashboardController(navigate);
        return () =>
          h(DashboardView, {
            controller,
            onNavigate: navigate,
          });
      },
    });
    const root = defineComponent({
      setup() {
        provideInventoryServices(service, reference);
        return () => h(view);
      },
    });
    const wrapper = mount(root, {
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    wrappers.push(wrapper);
    await flushPromises();

    const inventoryCard = wrapper.get('[data-section="inventory"]');
    expect(
      inventoryCard.findAll(".dashboard-inventory-quantities strong"),
    ).toHaveLength(12);
    expect(inventoryCard.findAll(".dashboard-unit-disclosure")).toHaveLength(4);
    const firstDisclosure = inventoryCard.findAll(
      ".dashboard-unit-disclosure",
    )[0]!;
    expect(firstDisclosure.text()).toContain("+1 单位");
    await firstDisclosure.trigger("click");
    expect(firstDisclosure.attributes("aria-expanded")).toBe("true");
    expect(
      inventoryCard.findAll(".dashboard-inventory-quantities strong"),
    ).toHaveLength(13);

    const movementLink = wrapper.get(".dashboard-movement-tile");
    expect(movementLink.element.tagName).toBe("A");
    expect(movementLink.attributes("href")).toContain("/movements");
    const movementDisclosure = wrapper.get(".dashboard-movement-disclosure");
    expect(movementDisclosure.text()).toContain("+1 单位");
    await movementDisclosure.trigger("click");
    expect(movementDisclosure.text()).toBe("收起");
    expect(
      wrapper.findAll(".dashboard-movement-unit-line .stock-effect"),
    ).toHaveLength(3);

    expect(wrapper.findAll('.dashboard-distribution [role="tab"]').length).toBe(
      2,
    );
    expect(
      wrapper
        .get('[data-distribution-tab="location"]')
        .attributes("aria-selected"),
    ).toBe("true");
    expect(
      wrapper.get('[data-expiry-tab="expired"]').attributes("aria-selected"),
    ).toBe("true");
    expect(wrapper.findAll(".distribution > .chart-bar")).toHaveLength(8);
    expect(wrapper.find(".chart-bar-axis").exists()).toBe(false);
    expect(wrapper.text()).toContain("其余 1 个位置");
    expect(wrapper.text()).toContain("另有 2 个位置当前无可用库存");
    await wrapper.get(".dashboard-inline-disclosure summary").trigger("click");
    await nextTick();
    expect(
      wrapper.findAll(".dashboard-inline-disclosure[open] .chart-bar"),
    ).toHaveLength(1);
    await wrapper.get(".dashboard-empty-locations summary").trigger("click");
    await nextTick();
    expect(wrapper.findAll(".dashboard-empty-locations li")).toHaveLength(2);
    await wrapper.get('[data-distribution-tab="category"]').trigger("click");
    await flushPromises();
    expect(
      wrapper
        .get('[data-distribution-tab="category"]')
        .attributes("aria-selected"),
    ).toBe("true");
    expect(wrapper.text()).toContain("无分类");
    expect(wrapper.find(".dashboard-empty-locations").exists()).toBe(false);

    expect(wrapper.findAll('.dashboard-expiry [role="tab"]').length).toBe(2);
    expect(wrapper.text()).toContain("最早到期的 5 个批次 · 共 6 个");
    await wrapper.get(".dashboard-expiry .browse-rank-row").trigger("click");
    expect(navigate.mock.calls.at(-1)?.[0].scope.period).toMatchObject({
      key: "custom",
      from: "1000-01-01",
      to: "2026-10-15",
    });
    await wrapper.get(".dashboard-expiry-all").trigger("click");
    expect(navigate.mock.calls.at(-1)?.[0].scope.period).toMatchObject({
      key: "custom",
      from: "1000-01-01",
      to: "2026-10-15",
    });
    await wrapper.get('[data-expiry-tab="upcoming"]').trigger("click");
    await wrapper.get(".dashboard-expiry .browse-rank-row").trigger("click");
    expect(navigate.mock.calls.at(-1)?.[0].scope.period).toMatchObject({
      key: "custom",
      from: "2026-10-16",
      to: "9999-12-31",
    });
    await wrapper.get(".dashboard-expiry-all").trigger("click");
    expect(navigate.mock.calls.at(-1)?.[0].scope.period).toMatchObject({
      key: "custom",
      from: "2026-10-16",
      to: "9999-12-31",
    });
    expect(wrapper.text()).toContain("最早到期的 5 个批次 · 共 7 个");
    expect(wrapper.text()).toContain("+1 单位");

    const primary = wrapper
      .findAll(".dashboard-quick-actions > button")
      .map((button) => button.text().trim());
    expect(primary).toEqual(["入库", "出库", "借出", "调拨"]);
    await wrapper
      .findAll(".dashboard-quick-actions > button")
      .find((button) => button.text().trim() === "借出")!
      .trigger("click");
    expect(navigate).toHaveBeenCalledWith(operationDestination("Loan"));

    await wrapper
      .get('.dashboard-more-actions [aria-label="更多"]')
      .trigger("click");
    const disposal = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".dashboard-more-actions-menu button",
      ),
    ).find((button) => button.textContent?.trim() === "报废")!;
    disposal.click();
    await flushPromises();
    expect(navigate).toHaveBeenLastCalledWith(operationDestination("Disposal"));
    expect(
      wrapper
        .get('.dashboard-more-actions [aria-label="更多"]')
        .attributes("aria-expanded"),
    ).toBe("false");
    expect(document.body.textContent).toContain("归还 · 选择未结清借用");

    await wrapper
      .get('.dashboard-more-actions [aria-label="更多"]')
      .trigger("click");
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".dashboard-more-actions-menu button",
      ),
    )
      .find((button) => button.textContent?.trim() === "盘点调整")!
      .click();
    await flushPromises();
    expect(navigate).toHaveBeenLastCalledWith(countDestination());
    await wrapper
      .get('.dashboard-more-actions [aria-label="更多"]')
      .trigger("click");
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".dashboard-more-actions-menu button",
      ),
    )
      .find((button) => button.textContent?.includes("归还"))!
      .click();
    await flushPromises();
    const chooser = navigate.mock.lastCall![0] as {
      name: string;
      query: Record<string, unknown>;
    };
    expect(chooser.name).toBe("loans");
    expect(chooser.query.view).toBe("items");
    const loanQuery = JSON.parse(String(chooser.query.query));
    expect(loanQuery.outstandingOnly).toBe(true);
    expect(loanQuery).not.toHaveProperty("statuses");

    reference.operations.Transfer = false;
    await nextTick();
    expect(
      wrapper
        .findAll(".dashboard-quick-actions > button")
        .some((button) => button.text().trim() === "调拨"),
    ).toBe(false);
    reference.operations.Disposal = false;
    await nextTick();
    expect(
      wrapper
        .findAll(".dashboard-more-actions button")
        .some((button) => button.text().trim() === "报废"),
    ).toBe(false);
    reference.operations.Reconcile = false;
    reference.operations.Damage = false;
    reference.operations.Loss = false;
    reference.operations.Repair = false;
    reference.operations.Return = false;
    await nextTick();
    expect(wrapper.find(".dashboard-more-actions").exists()).toBe(false);

    await wrapper
      .get('.dashboard-scope-control button[aria-haspopup="dialog"]')
      .trigger("click");
    await flushPromises();
    const filters = document.body.querySelector(".browse-filter-fields")!;
    expect(
      Array.from(
        filters.querySelectorAll<HTMLElement>("[data-filter-field]"),
      ).map((field) => field.dataset.filterField),
    ).toEqual(["categories", "warehouses"]);
    const category = filters.querySelector<HTMLElement>(
      '[data-filter-field="categories"]',
    )!;
    const uncategorized = category.querySelector<HTMLInputElement>(
      "label.form-check input[type=checkbox]",
    )!;
    uncategorized.click();
    await nextTick();
    expect(controller.filters.uncategorized).toBe(true);
    expect(
      document.body.querySelector('[data-filter-field="uncategorized"]'),
    ).toBeNull();
  });

  it("keeps failed card snapshots readable and blocks their drill-through until retry", async () => {
    const service = services(),
      navigate = vi.fn();
    let fail = false;
    vi.mocked(service.call).mockImplementation(async (_endpoint, args) => {
      if (args?.card === "distribution" && fail)
        throw new Error("仓库读取失败");
      return {
        query: query(),
        snapshot: "snapshot-1",
        item_count: 1,
        rows: [{ id: "A", label: "A", item_count: 1 }],
        totals: [],
      } as any;
    });
    const controller = setup(service, () => useDashboardController(navigate));
    await flushPromises();
    expect(service.call).toHaveBeenCalledTimes(6);
    fail = true;
    await controller.refresh();
    expect(controller.sections.inventory.status).toBe("ready");
    expect(controller.sections.distribution.status).toBe("error");
    expect(controller.sections.distribution.result.snapshot).toBe("snapshot-1");
    expect(controller.sections.distribution.hasResult).toBe(true);
    controller.distributionDrill({ id: "A" });
    expect(navigate).not.toHaveBeenCalled();
    fail = false;
    await controller.updateSection("distribution", true);
    controller.distributionDrill({ id: "A" });
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ warehouses: ["A"] }),
      }),
    );
  });
  it("refreshes only movement for its date, and only distribution for its dimension", async () => {
    const service = services();
    vi.mocked(service.call).mockResolvedValue({
      query: query(),
      rows: [],
      totals: [],
    });
    const controller = setup(service, () => useDashboardController(vi.fn()));
    await flushPromises();
    vi.mocked(service.call).mockClear();
    controller.filters.period = { key: "last_7_days", from: "", to: "" };
    await flushPromises();
    expect(
      vi.mocked(service.call).mock.calls.map(([, args]) => args?.card),
    ).toEqual(["movement"]);
    vi.mocked(service.call).mockClear();
    controller.filters.distribution = "category";
    await flushPromises();
    expect(
      vi.mocked(service.call).mock.calls.map(([, args]) => args?.card),
    ).toEqual(["distribution"]);
    vi.mocked(service.call).mockClear();
    controller.filters.warehouses = ["ROOM"];
    await flushPromises();
    expect(service.call).toHaveBeenCalledTimes(6);
  });
});
