import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  useInventoryServices,
  type ExportJob,
  type ReportPage,
} from "../../services/contracts";
import type { ReportQuery } from "../../lib/reportContract";

const relatedTables = new Set([
  "files",
  "items",
  "barcodes",
  "conversions",
  "warehouses",
]);
export const relatedSheetsHelp =
  "另加 物品资料、条码、物品常用换算、位置层级、私有附件引用 5 张工作表";

export function useQuickExport(query: Ref<ReportQuery>) {
  const services = useInventoryServices();
  const open = ref(false),
    format = ref<"xlsx" | "csv">("xlsx"),
    related = ref(false);
  const selectedTable = ref(""),
    selectedSheets = ref<string[]>([]);
  const page = ref<ReportPage>(),
    error = ref(""),
    loading = ref(false),
    generating = ref(false),
    job = ref<ExportJob>();
  let previewRequest: AbortController | undefined;
  let statusRequest: AbortController | undefined;
  let previewGeneration = 0;
  let jobGeneration = 0;
  let disposed = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let jobConfiguration = "";
  const configuration = computed(() =>
    JSON.stringify({
      query: query.value,
      format: format.value,
      related: related.value,
      tables:
        format.value === "csv"
          ? [selectedTable.value]
          : [...selectedSheets.value].sort(),
    }),
  );

  function stopPolling() {
    clearTimeout(poll);
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
  async function preview() {
    if (!open.value || disposed) return;
    const current = ++previewGeneration;
    previewRequest?.abort();
    previewRequest = new AbortController();
    loading.value = true;
    error.value = "";
    try {
      const result = await services.report(
        query.value,
        {
          page_length: 5,
          include_related: related.value,
          ...(selectedTable.value ? { table: selectedTable.value } : {}),
        },
        previewRequest.signal,
      );
      if (current !== previewGeneration || disposed) return;
      page.value = result;
      if (!result.tables.some((table) => table.id === selectedTable.value))
        selectedTable.value = result.table;
      const valid = new Set(result.tables.map((table) => table.id));
      selectedSheets.value = selectedSheets.value.filter((id) => valid.has(id));
      if (!selectedSheets.value.length)
        selectedSheets.value = result.tables
          .filter((table) => !relatedTables.has(table.id))
          .map((table) => table.id);
      if (related.value)
        for (const table of result.tables)
          if (
            relatedTables.has(table.id) &&
            !selectedSheets.value.includes(table.id)
          )
            selectedSheets.value.push(table.id);
    } catch (reason) {
      if (current === previewGeneration && !disposed)
        error.value =
          reason instanceof Error ? reason.message : "导出预览读取失败";
    } finally {
      if (current === previewGeneration && !disposed) loading.value = false;
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
      const result = await services.call<ExportJob>(
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
      if (generating.value) poll = setTimeout(() => void status(current), 1000);
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
    if (generating.value || !page.value || disposed) return;
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
    try {
      const result = failed
        ? await services.call<ExportJob>("exports.retry_export", {
            name: failed.name,
            version: failed.version,
          })
        : await services.call<ExportJob>("exports.request_export", {
            query: JSON.parse(JSON.stringify(query.value)),
            export_format: format.value,
            tables:
              format.value === "csv"
                ? [selectedTable.value]
                : selectedSheets.value.filter((id) =>
                    page.value?.tables.some((table) => table.id === id),
                  ),
            include_related: related.value,
          });
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
  watch([selectedTable, related], () => {
    void preview();
  });
  watch(configuration, () => {
    if (jobConfiguration && jobConfiguration !== configuration.value)
      invalidateJob();
  });
  watch(
    () => JSON.stringify(query.value),
    () => {
      invalidateJob();
      selectedTable.value = "";
      selectedSheets.value = [];
      page.value = undefined;
      void preview();
    },
  );
  watch(open, (value) => {
    if (!value) {
      previewGeneration++;
      previewRequest?.abort();
      loading.value = false;
      stopPolling();
    } else {
      void preview();
      if (job.value) void status();
    }
  });
  onBeforeUnmount(() => {
    disposed = true;
    previewGeneration++;
    jobGeneration++;
    previewRequest?.abort();
    stopPolling();
  });
  return {
    open,
    format,
    related,
    selectedTable,
    selectedSheets,
    page,
    error,
    loading,
    generating,
    job,
    preview,
    status,
    generate,
    canGenerate: computed(
      () =>
        !!page.value &&
        !loading.value &&
        !error.value &&
        !generating.value &&
        (format.value === "csv"
          ? !!selectedTable.value
          : selectedSheets.value.some((id) =>
              page.value?.tables.some((table) => table.id === id),
            )),
    ),
  };
}
