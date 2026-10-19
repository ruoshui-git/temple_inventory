import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive, ref } from "vue";
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
import { browseDestination } from "../src/lib/nativeNavigation";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
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
const job = (status: ExportJob["status"] = "Queued"): ExportJob => ({
  name: "EXPORT-1",
  status,
  progress: status === "Completed" ? 100 : 0,
  error: "",
  version: "v1",
  attempt: 1,
  generated_at: "",
  row_count: 205,
  download_url: status === "Completed" ? "/private/files/result.xlsx" : null,
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
    expect(service.report).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    controller.clear();
    await flushPromises();
    expect(service.report).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
    const historical = { ...query(), view: "historical" };
    expect(browseDestination(historical)).toMatchObject({
      path: "/reports",
      query: { query: JSON.stringify(historical) },
    });
  });
});

describe("native browse service controllers", () => {
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
      "/private/files/result.xlsx",
    );
    expect(
      vi
        .mocked(service.call)
        .mock.calls.filter(([method]) => method === "exports.request_export"),
    ).toHaveLength(1);
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
      expect.objectContaining({ export_format: "csv", tables: ["summary"] }),
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
