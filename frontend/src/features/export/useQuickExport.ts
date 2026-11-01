import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { useInventoryServices, type ExportJob } from "../../services/contracts";
import type { ReportQuery } from "../../lib/reportContract";

export type ExportFormat = "xlsx" | "csv" | "pdf";
export type IncludeFiles = "none" | "images" | "all";
export interface ExportPrintFormat {
  name: string;
  label: string;
  count_sheet: boolean;
}
type ExportProgressJob = ExportJob & {
  stage?: string;
  progress_detail?: string;
};

export function useQuickExport(
  query: Readonly<Ref<ReportQuery>>,
  table?: Readonly<Ref<string | undefined>>,
  columns?: Readonly<Ref<string[] | undefined>>,
  title?: Readonly<Ref<string>>,
  sortBy?: Readonly<Ref<string | undefined>>,
  sort?: Readonly<Ref<"asc" | "desc" | undefined>>,
  filterLabels: Readonly<Ref<string[]>> = ref([]),
) {
  const services = useInventoryServices();
  const open = ref(false);
  const format = ref<ExportFormat>("xlsx");
  const printFormats = ref<ExportPrintFormat[]>([]);
  const printFormat = ref("物资表格");
  const loadingPrintFormats = ref(false);
  const grouped = ref(true);
  const includeFiles = ref<IncludeFiles>("none");
  const matchedCount = ref<number>();
  const error = ref("");
  const loading = ref(false);
  const generating = ref(false);
  const job = ref<ExportProgressJob>();
  const downloading = ref(false);
  const downloadProgress = ref("");
  const downloadError = ref("");
  let countRequest: AbortController | undefined;
  let statusRequest: AbortController | undefined;
  let generation = 0;
  let formatsGeneration = 0;
  let printFormatsLoadedFor = "";
  let jobGeneration = 0;
  let disposed = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let jobConfiguration = "";
  let pollDelay = 500;

  const configuration = computed(() =>
    JSON.stringify({
      query: query.value,
      table: table?.value,
      columns: columns?.value,
      title: title?.value,
      format: format.value,
      printFormat: printFormat.value,
      grouped:
        (format.value === "xlsx" || format.value === "pdf") &&
        query.value.groupBy.length > 0 &&
        grouped.value,
      includeFiles: includeFiles.value,
      sortBy: sortBy?.value,
      sort: sort?.value,
    }),
  );

  function stopPolling() {
    clearTimeout(poll);
    pollDelay = 500;
    statusRequest?.abort();
    statusRequest = undefined;
  }

  function invalidateJob() {
    jobGeneration++;
    stopPolling();
    job.value = undefined;
    jobConfiguration = "";
    generating.value = false;
  }

  async function count() {
    if (!open.value || disposed) return;
    const current = ++generation;
    countRequest?.abort();
    countRequest = new AbortController();
    loading.value = true;
    error.value = "";
    matchedCount.value = undefined;
    try {
      const result = await services.report(
        query.value,
        { ...(table?.value ? { table: table.value } : {}), page_length: 1 },
        countRequest.signal,
      );
      if (current === generation && !disposed)
        matchedCount.value = result.matched_count;
    } catch (reason) {
      if (current === generation && !disposed)
        error.value =
          reason instanceof Error ? reason.message : "读取匹配数量失败";
    } finally {
      if (current === generation && !disposed) loading.value = false;
    }
  }

  async function loadPrintFormats() {
    const current = ++formatsGeneration;
    loadingPrintFormats.value = true;
    try {
      const result = await services.call<ExportPrintFormat[]>(
        "exports.export_print_formats",
        { dataset: query.value.dataset },
      );
      if (current !== formatsGeneration || disposed) return;
      printFormats.value = Array.isArray(result) ? result : [];
      printFormatsLoadedFor = query.value.dataset;
      if (!printFormats.value.some((item) => item.name === printFormat.value))
        printFormat.value = printFormats.value[0]?.name || "";
    } catch (reason) {
      if (current !== formatsGeneration || disposed) return;
      error.value =
        reason instanceof Error ? reason.message : "读取 PDF 版式失败";
    } finally {
      if (current === formatsGeneration) loadingPrintFormats.value = false;
    }
  }

  async function status(current = jobGeneration) {
    if (!job.value || !open.value || disposed || current !== jobGeneration)
      return;
    const name = job.value.name;
    statusRequest?.abort();
    const request = new AbortController();
    statusRequest = request;
    try {
      const result = await services.call<ExportProgressJob>(
        "exports.export_status",
        { name },
        request.signal,
      );
      if (
        current !== jobGeneration ||
        disposed ||
        !open.value ||
        job.value?.name !== name
      )
        return;
      job.value = result;
      generating.value =
        result.status === "Queued" || result.status === "Running";
      if (generating.value) {
        poll = setTimeout(() => void status(current), pollDelay);
        pollDelay = Math.min(2000, pollDelay + 250);
      }
    } catch (reason) {
      if (request.signal.aborted || current !== jobGeneration || disposed)
        return;
      error.value =
        reason instanceof Error ? reason.message : "无法读取导出进度，请重试";
      // A failed status request does not mean the server job failed. Keep generation
      // locked until its state is known, so a retry cannot create a duplicate job.
    }
  }

  async function generate() {
    if (generating.value || matchedCount.value === undefined || disposed)
      return;
    const current = ++jobGeneration;
    const chosenConfiguration = configuration.value;
    const failed =
      job.value?.status === "Failed" && jobConfiguration === chosenConfiguration
        ? job.value
        : undefined;
    jobConfiguration = chosenConfiguration;
    generating.value = true;
    error.value = "";
    stopPolling();
    const args: Record<string, unknown> = {
      query: JSON.parse(JSON.stringify(query.value)),
      export_format: format.value,
      include_files: includeFiles.value,
      summary: {
        title: title?.value || "导出",
        filters: [...filterLabels.value],
      },
    };
    if (format.value === "pdf") args.print_format = printFormat.value;
    if (table?.value) args.table = table.value;
    if (columns?.value) args.columns = columns.value;
    if (sortBy?.value) args.sort_by = sortBy.value;
    if (sort?.value) args.sort = sort.value;
    if (
      (format.value === "xlsx" || format.value === "pdf") &&
      query.value.groupBy.length
    )
      args.grouped = grouped.value;
    try {
      const result = failed
        ? await services.call<ExportProgressJob>("exports.retry_export", {
            name: failed.name,
            version: failed.version,
          })
        : await services.call<ExportProgressJob>(
            "exports.request_export",
            args,
          );
      if (current !== jobGeneration || disposed) return;
      job.value = result;
      jobConfiguration = chosenConfiguration;
      generating.value =
        result.status === "Queued" || result.status === "Running";
      if (generating.value) void status(current);
    } catch (reason) {
      if (current !== jobGeneration || disposed) return;
      generating.value = false;
      error.value =
        reason instanceof Error ? reason.message : "导出请求失败，请重试";
    }
  }

  function contentDispositionFilename(value: string | null) {
    if (!value) return "";
    const encoded = value.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1]?.trim();
    if (encoded) {
      try {
        return decodeURIComponent(encoded.replace(/^"|"$/g, ""));
      } catch {
        // Fall through to the quoted filename if the server header is malformed.
      }
    }
    return value.match(/filename="?([^";]+)"?/i)?.[1]?.trim() || "";
  }

  async function download() {
    const url = job.value?.download_url;
    if (!url || downloading.value) return;
    downloading.value = true;
    downloadProgress.value = "正在准备下载…";
    downloadError.value = "";
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) {
        const body = await response.text();
        let message = "下载失败，请重试";
        try {
          const payload = JSON.parse(body) as {
            message?: string;
            _server_messages?: string;
          };
          message = payload.message || message;
        } catch {
          if (body && body.length < 300) message = body;
        }
        throw new Error(message);
      }
      const total = Number(response.headers.get("content-length") || 0);
      const reader = response.body?.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const chunk = new Uint8Array(value.byteLength);
          chunk.set(value);
          chunks.push(chunk.buffer);
          received += value.byteLength;
          const current = (received / 1024 / 1024).toFixed(1);
          downloadProgress.value = total
            ? `已下载 ${current} / ${(total / 1024 / 1024).toFixed(1)} MB`
            : `已下载 ${current} MB`;
        }
      } else {
        const blob = await response.blob();
        chunks.push(await blob.arrayBuffer());
        received = blob.size;
      }
      const blob = new Blob(chunks, {
        type:
          response.headers.get("content-type") || "application/octet-stream",
      });
      const filename =
        contentDispositionFilename(
          response.headers.get("content-disposition"),
        ) ||
        job.value?.file_label ||
        "inventory-export";
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      downloadProgress.value = `已下载 ${(received / 1024 / 1024).toFixed(1)} MB`;
    } catch (reason) {
      downloadError.value =
        reason instanceof Error ? reason.message : "下载失败，请重试";
      downloadProgress.value = "";
    } finally {
      downloading.value = false;
    }
  }

  watch(configuration, () => {
    if (jobConfiguration && jobConfiguration !== configuration.value)
      invalidateJob();
    if (open.value) void count();
  });
  watch(
    () => query.value.dataset,
    () => {
      if (
        open.value &&
        format.value === "pdf" &&
        printFormatsLoadedFor !== query.value.dataset
      )
        void loadPrintFormats();
    },
  );
  watch(format, (value) => {
    if (
      value === "pdf" &&
      open.value &&
      printFormatsLoadedFor !== query.value.dataset
    )
      void loadPrintFormats();
  });
  watch(open, (value) => {
    if (!value) {
      formatsGeneration++;
      loadingPrintFormats.value = false;
      printFormatsLoadedFor = "";
      generation++;
      countRequest?.abort();
      loading.value = false;
      stopPolling();
    } else {
      void count();
      if (format.value === "pdf") void loadPrintFormats();
      if (job.value) void status();
    }
  });
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    jobGeneration++;
    countRequest?.abort();
    stopPolling();
  });
  return {
    open,
    format,
    printFormats,
    printFormat,
    loadingPrintFormats,
    grouped,
    includeFiles,
    matchedCount,
    error,
    loading,
    generating,
    job,
    downloading,
    downloadProgress,
    downloadError,
    download,
    count,
    status,
    generate,
    canGenerate: computed(
      () =>
        matchedCount.value !== undefined &&
        !loading.value &&
        !generating.value &&
        (format.value !== "pdf" ||
          (!loadingPrintFormats.value && Boolean(printFormat.value))),
    ),
  };
}
