import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { useInventoryServices, type ExportJob } from "../../services/contracts";
import { trackExport } from "../../services/backgroundTasks";
import type { ReportQuery } from "../../lib/reportContract";

export type ExportFormat = "xlsx" | "csv" | "pdf";
export type IncludeFiles = "none" | "images" | "all";
export type PdfOrientation = "auto" | "portrait" | "landscape";
export interface ExportPrintFormat {
  name: string;
  label: string;
  count_sheet: boolean;
}

const formatLabels: Record<ExportFormat, string> = {
  xlsx: "XLSX",
  csv: "CSV",
  pdf: "PDF",
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
  const printFormat = ref("");
  const loadingPrintFormats = ref(false);
  const printFormatError = ref("");
  const orientation = ref<PdfOrientation>("auto");
  const grouped = ref(true);
  const includeFiles = ref<IncludeFiles>("none");
  const matchedCount = ref<number>();
  const error = ref("");
  const loading = ref(false);
  const generating = ref(false);
  let countRequest: AbortController | undefined;
  let generation = 0;
  let formatsGeneration = 0;
  let printFormatsLoadedFor = "";
  let requestGeneration = 0;
  let disposed = false;

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
    printFormatError.value = "";
    try {
      const result = await services.call<ExportPrintFormat[]>(
        "exports.export_print_formats",
        {
          dataset: query.value.dataset,
        },
      );
      if (current !== formatsGeneration || disposed) return;
      printFormats.value = Array.isArray(result) ? result : [];
      printFormatsLoadedFor = query.value.dataset;
      if (!printFormats.value.some((item) => item.name === printFormat.value))
        printFormat.value = printFormats.value[0]?.name || "";
    } catch (reason) {
      if (current !== formatsGeneration || disposed) return;
      // A stale layout must not stay selected: PDF export stays blocked until a layout loads.
      printFormats.value = [];
      printFormat.value = "";
      printFormatsLoadedFor = "";
      printFormatError.value =
        reason instanceof Error ? reason.message : "读取 PDF 版式失败";
    } finally {
      if (current === formatsGeneration) loadingPrintFormats.value = false;
    }
  }

  const configuration = computed(() =>
    JSON.stringify({
      query: query.value,
      table: table?.value,
      columns: columns?.value,
      title: title?.value,
      format: format.value,
      printFormat: printFormat.value,
      orientation: orientation.value,
      grouped:
        (format.value === "xlsx" || format.value === "pdf") &&
        query.value.groupBy.length > 0 &&
        grouped.value,
      includeFiles: includeFiles.value,
      sortBy: sortBy?.value,
      sort: sort?.value,
    }),
  );

  // Starts the server job, hands it to the background tray and closes the dialog.
  async function generate() {
    if (generating.value || !canGenerate.value || disposed) return;
    const current = ++requestGeneration;
    generating.value = true;
    error.value = "";
    const args: Record<string, unknown> = {
      query: JSON.parse(JSON.stringify(query.value)),
      export_format: format.value,
      include_files: includeFiles.value,
      summary: {
        title: title?.value || "导出",
        filters: [...filterLabels.value],
      },
    };
    if (format.value === "pdf") {
      args.print_format = printFormat.value;
      args.orientation = orientation.value;
    }
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
      const result = await services.call<ExportJob>(
        "exports.request_export",
        args,
      );
      if (current !== requestGeneration || disposed) return;
      trackExport(services, result, {
        title: title?.value || "导出",
        format: formatLabels[format.value],
      });
      open.value = false;
    } catch (reason) {
      if (current !== requestGeneration || disposed) return;
      error.value =
        reason instanceof Error ? reason.message : "导出请求失败，请重试";
    } finally {
      if (current === requestGeneration) generating.value = false;
    }
  }

  watch(configuration, () => {
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
    } else {
      void count();
      if (format.value === "pdf") void loadPrintFormats();
    }
  });
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    requestGeneration++;
    countRequest?.abort();
  });
  const canGenerate = computed(
    () =>
      matchedCount.value !== undefined &&
      !loading.value &&
      !generating.value &&
      (format.value !== "pdf" ||
        (!loadingPrintFormats.value &&
          !printFormatError.value &&
          Boolean(printFormat.value))),
  );
  return {
    open,
    format,
    printFormats,
    printFormat,
    printFormatError,
    loadingPrintFormats,
    orientation,
    grouped,
    includeFiles,
    matchedCount,
    error,
    loading,
    generating,
    count,
    loadPrintFormats,
    generate,
    canGenerate,
  };
}
