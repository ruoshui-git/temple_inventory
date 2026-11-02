// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import TaskTray from "../src/components/TaskTray.vue";
import {
  backgroundTaskState,
  bindBackgroundTasks,
  downloadTask,
  removeTask,
  resetBackgroundTasks,
  retryTask,
  startPrintPdf,
  trackExport,
} from "../src/services/backgroundTasks";
import {
  createReferenceData,
  provideInventoryServices,
  type ExportJob,
  type InventoryServices,
} from "../src/services/contracts";
import { preferenceUser } from "../src/lib/uiPreferences";

const wrappers: VueWrapper[] = [];
const storageKey = "ti-export-jobs:v1:tray-user";
const job = (
  status: ExportJob["status"] = "Queued",
  overrides: Partial<ExportJob> = {},
): ExportJob => ({
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
  ...overrides,
});
function client(call = vi.fn(async () => job())) {
  return { call: call as unknown as InventoryServices["call"] };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  resetBackgroundTasks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  preferenceUser.value = "";
});

describe("background export tasks", () => {
  it("polls a running export with 500 ms then 750 ms backoff until it completes", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(
        job("Running", { progress: 30, stage: "读取数据" } as never),
      )
      .mockResolvedValueOnce({
        ...job("Running", { progress: 60 }),
        stage: "写入文件",
        progress_detail: "已写入 100 行",
      })
      .mockResolvedValueOnce(job("Completed"));
    const service = client(call as never);
    trackExport(service, job(), { title: "库存列表", format: "XLSX" });
    expect(call).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(call).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(call).toHaveBeenCalledTimes(1);
    expect(backgroundTaskState.tasks[0]?.percent).toBe(30);
    await vi.advanceTimersByTimeAsync(749);
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(call).toHaveBeenCalledTimes(2);
    expect(backgroundTaskState.tasks[0]?.stage).toBe(
      "写入文件 · 已写入 100 行",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    const task = backgroundTaskState.tasks[0]!;
    expect(task.status).toBe("completed");
    expect(task.downloadUrl).toContain("download_export");
    expect(call).toHaveBeenCalledWith(
      "exports.export_status",
      { name: "EXPORT-1" },
      expect.any(AbortSignal),
    );
  });

  it("keeps a job running after a status read fails and never creates a second request", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce(job("Completed"));
    trackExport(client(call as never), job(), {
      title: "库存列表",
      format: "XLSX",
    });
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(backgroundTaskState.tasks[0]?.status).toBe("running");
    expect(backgroundTaskState.tasks[0]?.stage).toBe("网络中断");
    await vi.advanceTimersByTimeAsync(750);
    await flushPromises();
    expect(backgroundTaskState.tasks[0]?.status).toBe("completed");
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      "exports.export_status",
      "exports.export_status",
    ]);
  });

  it("retries a failed job through retry_export and resumes polling", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(job("Failed", { error: "表格损坏" }))
      .mockResolvedValueOnce(job("Running", { attempt: 2 }))
      .mockResolvedValueOnce(job("Completed"));
    trackExport(client(call as never), job(), {
      title: "库存列表",
      format: "XLSX",
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    const failed = backgroundTaskState.tasks[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("表格损坏");
    await retryTask(failed.id);
    expect(call).toHaveBeenNthCalledWith(2, "exports.retry_export", {
      name: "EXPORT-1",
      version: "v1",
    });
    expect(failed.status).toBe("running");
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(failed.status).toBe("completed");
  });

  it("refuses to remove a running task and removes a finished one", async () => {
    trackExport(client(), job(), { title: "库存列表", format: "XLSX" });
    const id = backgroundTaskState.tasks[0]!.id;
    removeTask(id);
    expect(backgroundTaskState.tasks).toHaveLength(1);
    resetBackgroundTasks();
    trackExport(
      client(async () => job("Failed")),
      job("Failed"),
      { title: "库存列表", format: "XLSX" },
    );
    removeTask(backgroundTaskState.tasks[0]!.id);
    expect(backgroundTaskState.tasks).toHaveLength(0);
  });

  it("persists running jobs per account and resumes polling after reload", async () => {
    bindBackgroundTasks(client(), "tray-user");
    trackExport(client(), job(), { title: "库存列表", format: "XLSX" });
    const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
    expect(stored).toEqual([
      expect.objectContaining({
        jobName: "EXPORT-1",
        title: "库存列表",
        format: "XLSX",
      }),
    ]);
    // Simulate a reload: the in-memory tray is gone, storage remains.
    resetBackgroundTasks();
    expect(localStorage.getItem(storageKey)).not.toBeNull();
    const call = vi.fn(async () => job("Completed"));
    bindBackgroundTasks(client(call as never), "tray-user");
    expect(backgroundTaskState.tasks).toHaveLength(1);
    await flushPromises();
    expect(call).toHaveBeenCalledWith(
      "exports.export_status",
      { name: "EXPORT-1" },
      expect.any(AbortSignal),
    );
    expect(backgroundTaskState.tasks[0]?.status).toBe("completed");
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("marks a finished export watched only when the tray is open", async () => {
    const call = vi.fn(async (method: string) =>
      method === "exports.export_status" ? job("Completed") : { watched: true },
    );
    backgroundTaskState.expanded = false;
    trackExport(client(call as never), job(), {
      title: "库存列表",
      format: "XLSX",
    });
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(backgroundTaskState.tasks[0]?.status).toBe("completed");
    expect(call.mock.calls.map(([method]) => method)).not.toContain(
      "exports.mark_watched",
    );
    resetBackgroundTasks();
    backgroundTaskState.expanded = true;
    trackExport(client(call as never), job(), {
      title: "库存列表",
      format: "XLSX",
    });
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(call).toHaveBeenCalledWith("exports.mark_watched", {
      name: "EXPORT-1",
    });
    backgroundTaskState.expanded = false;
  });

  it("streams a completed export with the UTF-8 server filename and blocks duplicate downloads", async () => {
    const call = vi.fn(async (method: string) => ({
      watched: method === "exports.mark_watched",
    }));
    trackExport(client(call as never), job(), {
      title: "库存列表",
      format: "XLSX",
    });
    const task = backgroundTaskState.tasks[0]!;
    task.status = "completed";
    task.downloadUrl =
      "/api/method/temple_inventory.exports.download_export?name=EXPORT-1";
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
                ? "6"
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
    const downloading = downloadTask(task.id);
    await flushPromises();
    expect(task.downloading).toBe(true);
    expect(task.percent).toBe(50);
    await downloadTask(task.id);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    release();
    await downloading;
    expect(click).toHaveBeenCalledOnce();
    expect(downloadedFilename).toBe("库存明细.xlsx");
    expect(task.downloading).toBe(false);
    expect(task.downloaded).toBe(true);
    expect(call).toHaveBeenCalledWith("exports.mark_watched", {
      name: "EXPORT-1",
    });
  });
});

describe("background PDF tasks", () => {
  it("renders a record PDF in the background with the selected account header", async () => {
    preferenceUser.value = "account@example.test";
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:record-pdf");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const fetchMock = vi.fn(
      async () => new Response(new Blob(["%PDF"]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const id = startPrintPdf({
      title: "盘点单",
      doctype: "Stock Reconciliation",
      name: "MAT-REC-1",
    });
    expect(backgroundTaskState.tasks[0]?.status).toBe("running");
    expect(backgroundTaskState.tasks[0]?.percent).toBeNull();
    await flushPromises();
    const task = backgroundTaskState.tasks.find((item) => item.id === id)!;
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/method/temple_inventory.printing.print_record_pdf?doctype=Stock+Reconciliation&name=MAT-REC-1",
      expect.objectContaining({
        headers: { "X-Inventory-Account": "account@example.test" },
      }),
    );
    expect(task.status).toBe("completed");
    expect(task.downloadUrl).toBe("blob:record-pdf");
    expect(task.filename).toBe("MAT-REC-1.pdf");
  });

  it("keeps a failed PDF retryable with the server message", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry-pdf");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "打印失败，请稍后重试" }), {
          status: 417,
        }),
      )
      .mockResolvedValueOnce(new Response(new Blob(["%PDF"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    startPrintPdf({
      title: "盘点单",
      doctype: "Stock Reconciliation",
      name: "MAT-REC-1",
    });
    await flushPromises();
    const task = backgroundTaskState.tasks[0]!;
    expect(task.status).toBe("failed");
    expect(task.error).toBe("打印失败，请稍后重试");
    await retryTask(task.id);
    expect(task.status).toBe("completed");
  });
});

describe("task tray", () => {
  it("shows a pill, expands to per-task actions, and collapses on Escape and keeps an open panel when work ends", async () => {
    const service = client(
      vi.fn(async (method: string) =>
        method === "exports.export_status" ? job("Completed") : job(),
      ) as never,
    );
    const reference = createReferenceData();
    reference.user = "tray-user";
    const wrapper = mount(
      {
        setup() {
          provideInventoryServices(service as InventoryServices, reference);
          return () => h(TaskTray);
        },
      },
      { attachTo: document.body },
    );
    wrappers.push(wrapper);
    expect(wrapper.find("[data-task-tray]").exists()).toBe(false);
    trackExport(service, job(), { title: "库存列表", format: "XLSX" });
    await flushPromises();
    const pill = wrapper.get(".task-tray-pill");
    expect(pill.text()).toContain("正在导出 1 项");
    expect(pill.attributes("aria-expanded")).toBe("false");
    await pill.trigger("click");
    expect(wrapper.get('[role="region"]').attributes("aria-live")).toBe(
      "polite",
    );
    expect(wrapper.text()).toContain("库存列表");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(wrapper.find('[role="region"]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(wrapper.find('[role="region"]').exists()).toBe(false);
    expect(wrapper.get(".task-tray-pill").text()).toContain("1 项任务已完成");
    await wrapper.get(".task-tray-pill").trigger("click");
    expect(wrapper.text()).toContain("下载");
    expect(wrapper.text()).toContain("移除");
    trackExport(service, job(), { title: "效期批次", format: "XLSX" });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    // A panel the user opened stays open when its last job finishes.
    expect(wrapper.find('[role="region"]').exists()).toBe(true);
  });
});
