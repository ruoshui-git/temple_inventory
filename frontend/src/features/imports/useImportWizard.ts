import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { request } from "../../lib/api";
import { useReferenceData } from "../../services/contracts";

export interface ImportRow {
  row: number;
  action: "NEW" | "UPDATE" | "UNCHANGED" | "REJECTED";
  target: string;
  item_code?: string;
  errors: string[];
  warnings: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  values: Record<string, unknown>;
}
export interface ImportPreview {
  name: string;
  status: string;
  counts: Record<string, number>;
  rows: ImportRow[];
  plan_hash: string;
  error: string;
  progress?: { percent?: number; heartbeat?: string };
}
export function useImportWizard() {
  const reference = useReferenceData();
  const file = ref<File>(),
    preview = ref<ImportPreview>(),
    error = ref(""),
    busy = ref(false),
    step = ref("start"),
    query = ref(""),
    filter = ref("all"),
    skipRejected = ref(false),
    expanded = ref<number[]>([]),
    jobId = ref("");
  const rejected = computed(() => preview.value?.counts.rejected || 0);
  const visibleRows = computed(() =>
    (preview.value?.rows || []).filter(
      (row) =>
        (filter.value === "all" || row.action === filter.value) &&
        (!query.value ||
          JSON.stringify(row)
            .toLocaleLowerCase()
            .includes(query.value.toLocaleLowerCase())),
    ),
  );
  async function upload() {
    if (!file.value || busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      const form = new FormData();
      form.set("file", file.value);
      form.set("import_type", "Item");
      preview.value = await request(
        "temple_inventory.imports.upload",
        {},
        form,
      );
      step.value = "preview";
    } catch (reason) {
      error.value =
        reason instanceof Error ? reason.message : "上传失败，请检查文件后重试";
    } finally {
      busy.value = false;
    }
  }
  async function repreview() {
    if (!preview.value) return;
    busy.value = true;
    error.value = "";
    try {
      preview.value = await request("temple_inventory.imports.preview", {
        name: preview.value.name,
      });
      step.value = "preview";
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : "重新预览失败";
    } finally {
      busy.value = false;
    }
  }
  async function retry() {
    if (!preview.value) return;
    busy.value = true;
    error.value = "";
    try {
      preview.value = await request("temple_inventory.imports.retry", {
        name: preview.value.name,
      });
      step.value = "preview";
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : "重试失败";
    } finally {
      busy.value = false;
    }
  }
  async function refresh() {
    if (!jobId.value) return;
    try {
      const result = await request("temple_inventory.imports.status", {
        name: jobId.value,
      });
      preview.value = result;
      if (["Completed", "Failed", "Conflict"].includes(result.status))
        step.value = "result";
    } catch (reason) {
      error.value =
        reason instanceof Error ? reason.message : "读取导入状态失败";
    }
  }
  async function commit() {
    if (!preview.value || busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      const result = await request("temple_inventory.imports.commit", {
        name: preview.value.name,
        plan_hash: preview.value.plan_hash,
        skip_rejected: skipRejected.value ? 1 : 0,
      });
      preview.value = result;
      jobId.value = result.name;
      step.value = result.status === "Completed" ? "result" : "running";
      history.replaceState(
        null,
        "",
        `${location.pathname}?import=${encodeURIComponent(result.name)}`,
      );
      if (step.value === "running") poll();
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : "提交导入失败";
    } finally {
      busy.value = false;
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await refresh();
      if (
        preview.value?.status === "Queued" ||
        preview.value?.status === "Running"
      )
        poll();
    }, 1500);
  }
  function reset() {
    clearTimeout(timer);
    preview.value = undefined;
    file.value = undefined;
    error.value = "";
    skipRejected.value = false;
    step.value = "start";
    jobId.value = "";
    history.replaceState(null, "", location.pathname);
  }
  function download(path: string) {
    window.location.href = `/api/method/temple_inventory.imports.${path}`;
  }
  onMounted(() => {
    const value = new URLSearchParams(location.search).get("import");
    if (value) {
      jobId.value = value;
      step.value = "running";
      void refresh().then(() => {
        if (
          preview.value?.status === "Queued" ||
          preview.value?.status === "Running"
        )
          poll();
      });
    }
  });
  onBeforeUnmount(() => clearTimeout(timer));
  return {
    reference,
    file,
    preview,
    error,
    busy,
    step,
    query,
    filter,
    skipRejected,
    rejected,
    expanded,
    visibleRows,
    upload,
    commit,
    refresh,
    repreview,
    retry,
    reset,
    download,
  };
}
