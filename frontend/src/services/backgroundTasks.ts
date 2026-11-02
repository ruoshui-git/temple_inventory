import { reactive } from "vue";
import { markExportWatched } from "../features/export/watchedExport";
import { preferenceUser } from "../lib/uiPreferences";
import type { ExportJob, InventoryServices } from "./contracts";
import { showToast } from "./toast";

export type BackgroundTaskKind = "export" | "print-pdf";
export type BackgroundTaskStatus = "running" | "completed" | "failed";

export interface BackgroundTask {
  id: string;
  kind: BackgroundTaskKind;
  title: string;
  stage: string;
  /** null renders an indeterminate progress bar. */
  percent: number | null;
  status: BackgroundTaskStatus;
  error: string;
  downloading: boolean;
  downloaded: boolean;
  downloadError: string;
  /** Export: the server job. */
  jobName: string;
  version: string;
  format: string;
  /** Export: server download URL. Print PDF: blob URL once rendered. */
  downloadUrl: string;
  /** Print PDF: the server URL to fetch, and the file name to save as. */
  source: string;
  filename: string;
}

type ExportProgressJob = ExportJob & {
  stage?: string;
  progress_detail?: string;
};
type Client = Pick<InventoryServices, "call">;

interface PersistedExport {
  id: string;
  jobName: string;
  title: string;
  format: string;
}

const state = reactive({
  tasks: [] as BackgroundTask[],
  /** Set by TaskTray; terminal export results are marked watched only when it is open. */
  expanded: false,
});
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const requests = new Map<string, AbortController>();
const delays = new Map<string, number>();
let client: Client | undefined;
let account = "";
let generation = 0;

export const backgroundTaskState = state;

function find(id: string) {
  return state.tasks.find((task) => task.id === id);
}

function storageKey(user: string) {
  return `ti-export-jobs:v1:${user}`;
}

function persist() {
  if (!account) return;
  const entries: PersistedExport[] = state.tasks
    .filter((task) => task.kind === "export" && task.status === "running")
    .map((task) => ({
      id: task.id,
      jobName: task.jobName,
      title: task.title,
      format: task.format,
    }));
  try {
    if (entries.length)
      window.localStorage.setItem(storageKey(account), JSON.stringify(entries));
    else window.localStorage.removeItem(storageKey(account));
  } catch {
    // Storage can be blocked; the running jobs still poll for this page session.
  }
}

function readPersisted(user: string): PersistedExport[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey(user)) || "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is PersistedExport =>
            typeof entry?.id === "string" && typeof entry?.jobName === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function newTask(
  partial: Partial<BackgroundTask> & Pick<BackgroundTask, "kind" | "title">,
) {
  return reactive({
    id: partial.id || crypto.randomUUID(),
    stage: "",
    percent: null,
    status: "running",
    error: "",
    downloading: false,
    downloaded: false,
    downloadError: "",
    jobName: "",
    version: "",
    format: "",
    downloadUrl: "",
    source: "",
    filename: "",
    ...partial,
  }) as BackgroundTask;
}

function stopTask(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  delays.delete(id);
  requests.get(id)?.abort();
  requests.delete(id);
}

function schedule(task: BackgroundTask) {
  const delay = delays.get(task.id) ?? 500;
  delays.set(task.id, Math.min(2000, delay + 250));
  timers.set(
    task.id,
    setTimeout(() => void poll(task.id), delay),
  );
}

function markWatched(task: BackgroundTask) {
  if (!client || !task.jobName) return;
  void markExportWatched(client, task.jobName).catch(() => undefined);
}

function applyJob(task: BackgroundTask, job: ExportProgressJob) {
  const wasRunning = task.status === "running";
  task.version = job.version || task.version;
  if (job.status === "Completed") {
    task.status = "completed";
    task.percent = 100;
    task.stage = "已生成";
    task.downloadUrl = job.download_url || "";
    task.error = "";
    if (wasRunning) {
      showToast("导出文件已准备好", "success", {
        label: "下载",
        action: () => void downloadTask(task.id),
      });
      if (state.expanded) markWatched(task);
    }
  } else if (job.status === "Failed") {
    task.status = "failed";
    task.percent = null;
    task.error = job.error || "导出失败";
    task.stage = "生成失败";
    if (wasRunning && state.expanded) markWatched(task);
  } else {
    task.percent = job.progress ?? null;
    task.stage = [job.stage || "后台生成中", job.progress_detail]
      .filter(Boolean)
      .join(" · ");
  }
  persist();
}

async function poll(id: string) {
  timers.delete(id);
  const task = find(id);
  if (!task || task.status !== "running" || !client || !task.jobName) return;
  const current = generation;
  const request = new AbortController();
  requests.set(id, request);
  try {
    const job = await client.call<ExportProgressJob>(
      "exports.export_status",
      { name: task.jobName },
      request.signal,
    );
    if (current !== generation || !find(id)) return;
    applyJob(task, job);
    if (task.status === "running") schedule(task);
  } catch (reason) {
    if (request.signal.aborted || current !== generation || !find(id)) return;
    // A failed status read does not mean the server job failed; keep polling.
    task.stage =
      reason instanceof Error ? reason.message : "无法读取导出进度，正在重试";
    schedule(task);
  } finally {
    if (requests.get(id) === request) requests.delete(id);
  }
}

/** Hands a queued or running export job to the tray and starts polling it. */
export function trackExport(
  source: Client,
  job: ExportJob,
  meta: { title: string; format: string },
) {
  client = source;
  const task = newTask({
    id: crypto.randomUUID(),
    kind: "export",
    title: meta.title,
    format: meta.format,
    jobName: job.name,
    version: job.version,
  });
  state.tasks.push(task);
  applyJob(task, job);
  if (task.status === "running") schedule(task);
  return task.id;
}

/** Restores running export jobs saved for this account, so polling resumes after reload. */
export function bindBackgroundTasks(source: Client, user: string) {
  client = source;
  if (user === account) return;
  if (account) resetBackgroundTasks();
  account = user;
  if (!user) return;
  for (const entry of readPersisted(user)) {
    if (find(entry.id)) continue;
    const task = newTask({
      id: entry.id,
      kind: "export",
      title: entry.title,
      format: entry.format,
      jobName: entry.jobName,
      stage: "正在恢复导出进度…",
    });
    state.tasks.push(task);
    delays.set(task.id, 500);
    void poll(task.id);
  }
}

async function fetchPrintPdf(task: BackgroundTask) {
  const current = generation;
  const request = new AbortController();
  requests.set(task.id, request);
  task.status = "running";
  task.stage = "正在生成 PDF…";
  task.percent = null;
  task.error = "";
  task.downloaded = false;
  try {
    const response = await fetch(task.source, {
      credentials: "same-origin",
      headers: preferenceUser.value
        ? { "X-Inventory-Account": preferenceUser.value }
        : {},
      signal: request.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      let message = "PDF 生成失败，请重试";
      try {
        const payload = JSON.parse(body) as { message?: string };
        message = payload.message || message;
      } catch {
        if (body && body.length < 300) message = body;
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("PDF 文件为空，请重试");
    if (current !== generation || !find(task.id)) return;
    if (task.downloadUrl) URL.revokeObjectURL(task.downloadUrl);
    task.downloadUrl = URL.createObjectURL(blob);
    task.status = "completed";
    task.stage = "PDF 已准备好";
  } catch (reason) {
    if (request.signal.aborted || current !== generation || !find(task.id))
      return;
    task.status = "failed";
    task.error =
      reason instanceof Error ? reason.message : "PDF 生成失败，请重试";
    task.stage = "生成失败";
  } finally {
    if (requests.get(task.id) === request) requests.delete(task.id);
  }
}

/** Renders a record slip as a PDF in the background (for 下载 PDF). */
export function startPrintPdf(meta: {
  title: string;
  doctype: string;
  name: string;
}) {
  const query = new URLSearchParams({ doctype: meta.doctype, name: meta.name });
  const task = newTask({
    kind: "print-pdf",
    title: meta.title,
    source: `/api/method/temple_inventory.printing.print_record_pdf?${query}`,
    filename: `${meta.name}.pdf`,
  });
  state.tasks.push(task);
  void fetchPrintPdf(task);
  return task.id;
}

/** Saves a completed export or PDF. Export downloads stream with byte progress. */
export async function downloadTask(id: string) {
  const task = find(id);
  if (!task || task.downloading || task.status !== "completed") return;
  if (task.kind === "print-pdf") {
    saveBlob(task.downloadUrl, task.filename);
    task.downloaded = true;
    return;
  }
  const url = task.downloadUrl;
  if (!url) return;
  task.downloading = true;
  task.downloadError = "";
  task.percent = null;
  task.stage = "正在准备下载…";
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.text();
      let message = "下载失败，请重试";
      try {
        const payload = JSON.parse(body) as { message?: string };
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
        task.percent = total
          ? Math.min(99, Math.round((received * 100) / total))
          : null;
        const current = (received / 1024 / 1024).toFixed(1);
        task.stage = total
          ? `已下载 ${current} / ${(total / 1024 / 1024).toFixed(1)} MB`
          : `已下载 ${current} MB`;
      }
    } else {
      const blob = await response.blob();
      chunks.push(await blob.arrayBuffer());
      received = blob.size;
    }
    const blob = new Blob(chunks, {
      type: response.headers.get("content-type") || "application/octet-stream",
    });
    const filename =
      contentDispositionFilename(response.headers.get("content-disposition")) ||
      task.filename ||
      "inventory-export";
    saveBlob(URL.createObjectURL(blob), filename, true);
    task.downloaded = true;
    task.percent = 100;
    task.stage = `已下载 ${(received / 1024 / 1024).toFixed(1)} MB`;
    markWatched(task);
  } catch (reason) {
    task.downloadError =
      reason instanceof Error ? reason.message : "下载失败，请重试";
    task.stage = "下载失败";
    task.percent = null;
  } finally {
    task.downloading = false;
  }
}

function saveBlob(url: string, filename: string, revoke = false) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function contentDispositionFilename(value: string | null) {
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

/** Retries a failed export job, a failed PDF render, or a failed save. */
export async function retryTask(id: string) {
  const task = find(id);
  if (!task || task.status === "running") {
    if (task?.downloadError) await downloadTask(id);
    return;
  }
  if (task.kind === "print-pdf") {
    await fetchPrintPdf(task);
    return;
  }
  if (task.status !== "failed" || !client) return;
  const current = generation;
  try {
    const job = await client.call<ExportProgressJob>("exports.retry_export", {
      name: task.jobName,
      version: task.version,
    });
    if (current !== generation || !find(id)) return;
    task.status = "running";
    task.error = "";
    applyJob(task, job);
    if (task.status === "running") {
      delays.set(id, 500);
      schedule(task);
    }
  } catch (reason) {
    task.error =
      reason instanceof Error ? reason.message : "重试失败，请稍后再试";
  }
}

/** Removes a finished task and releases its blob URL. Running tasks cannot be removed. */
export function removeTask(id: string) {
  const task = find(id);
  if (!task || task.status === "running") return;
  stopTask(id);
  if (task.kind === "print-pdf" && task.downloadUrl)
    URL.revokeObjectURL(task.downloadUrl);
  state.tasks.splice(state.tasks.indexOf(task), 1);
  persist();
}

/** Forgets every task and polling timer. Used when the account changes and in tests. */
export function resetBackgroundTasks() {
  generation++;
  for (const id of [...timers.keys(), ...requests.keys()]) stopTask(id);
  for (const task of state.tasks) {
    if (task.kind === "print-pdf" && task.downloadUrl)
      URL.revokeObjectURL(task.downloadUrl);
  }
  state.tasks.splice(0);
  state.expanded = false;
  // Persisted running jobs stay in storage: they belong to the account, not this session.
  account = "";
}
