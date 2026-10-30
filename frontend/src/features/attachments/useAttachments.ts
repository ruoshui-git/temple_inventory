import { computed, onBeforeUnmount, reactive, ref } from "vue";
import { useInventoryServices } from "../../services/contracts";
import { fileMime, type NativeFile } from "../../lib/catalogPresentation";
import { showToast } from "../../services/toast";
export interface AttachmentEntry {
  id: string;
  name: string;
  type: string;
  url?: string;
  serverName?: string;
  primary?: boolean;
  state: "pending" | "uploading" | "ready" | "error" | "reselect";
  size?: number;
  progress: number;
  error: string;
}
export function useAttachments(options: {
  parent(): { doctype: string; name: string } | undefined;
  writable(): boolean;
  currentAccount(): string;
  account: string;
  primary?(file: string): Promise<void>;
  changed?(): void;
  parentChanged?(version: string): void;
}) {
  const services = useInventoryServices();
  const files = reactive<AttachmentEntry[]>([]),
    error = ref("");
  const loading = ref(false),
    initialized = ref(!options.parent());
  const bytes = new Map<string, File>(),
    urls = new Map<string, string>();
  let primarySaved = "";
  let uploadBatchPending = false;
  const uploadBatchIds = new Set<string>();
  let disposed = false,
    generation = 0;
  let request: AbortController | undefined;
  const active = () =>
    !disposed && options.currentAccount() === options.account;
  const busy = computed(() => files.some((row) => row.state === "uploading"));
  const pendingActions = ref<Record<string, "primary" | "remove">>({});
  const actionBusy = computed(
    () => Object.keys(pendingActions.value).length > 0,
  );
  const pendingAction = (entry: AttachmentEntry) =>
    pendingActions.value[entry.id] || "";
  const incomplete = computed(() => files.some((row) => row.state !== "ready"));
  function release(id: string) {
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
  }
  function load(values: NativeFile[], primary = "") {
    loading.value = false;
    initialized.value = true;
    primarySaved =
      values.find((value) => value.file_url === primary)?.name || "";
    for (const value of values) {
      const previous = files.find((row) => row.serverName === value.name);
      if (previous) {
        previous.primary = value.file_url === primary;
        continue;
      }
      files.push({
        id: value.name,
        name: value.file_name,
        type: fileMime(value),
        size: value.file_size,
        url: services.fileDisplayUrl?.(value) || value.file_url,
        serverName: value.name,
        primary: value.file_url === primary,
        state: "ready",
        progress: 100,
        error: "",
      });
    }
  }
  async function fetchFiles() {
    const parent = options.parent();
    if (!parent || !active()) return;
    const current = ++generation;
    request?.abort();
    request = new AbortController();
    loading.value = true;
    error.value = "";
    try {
      const values = await services.call<NativeFile[]>(
        "native_files.attachments",
        parent,
        request.signal,
      );
      if (
        active() &&
        current === generation &&
        options.parent()?.name === parent.name
      )
        load(values);
    } catch (reason) {
      if (active() && current === generation)
        error.value = reason instanceof Error ? reason.message : "附件读取失败";
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  function clear() {
    generation++;
    request?.abort();
    loading.value = false;
    primarySaved = "";
    for (const id of urls.keys()) release(id);
    bytes.clear();
    files.splice(0);
    initialized.value = !options.parent();
  }
  function previewUrl(file: File): string | undefined {
    if (
      !file.type.startsWith("image/") ||
      typeof URL.createObjectURL !== "function"
    )
      return;
    try {
      return URL.createObjectURL(file);
    } catch {
      return;
    }
  }
  function add(values: File[], imagePrimary = false) {
    const firstPrimary = imagePrimary ? values[0] : undefined;
    if (!active() || !options.writable()) return;
    if (firstPrimary) files.forEach((row) => (row.primary = false));
    for (const file of values) {
      const id = crypto.randomUUID();
      bytes.set(id, file);
      const url = previewUrl(file);
      if (url) urls.set(id, url);
      files.push({
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        primary: file === firstPrimary,
        url,
        state: "pending",
        progress: 0,
        error: "",
      });
      uploadBatchIds.add(id);
    }
    uploadBatchPending = uploadBatchIds.size > 0;
    options.changed?.();
    if (options.parent()) void finalize();
  }
  async function upload(entry: AttachmentEntry, explicit = false) {
    if (
      !active() ||
      !options.writable() ||
      entry.state === "uploading" ||
      entry.state === "ready"
    )
      return;
    const parent = options.parent(),
      file = bytes.get(entry.id);
    if (!parent) return;
    if (!file) {
      entry.state = "reselect";
      entry.error = "请重新选择此文件；浏览器恢复不包含文件内容";
      return;
    }
    entry.state = "uploading";
    entry.progress = 0;
    entry.error = "";
    options.changed?.();
    try {
      const value = (await services.upload(
        file,
        parent.doctype,
        parent.name,
        (progress) => {
          if (active()) entry.progress = progress;
        },
      )) as unknown as NativeFile;
      if (!active()) return;
      if (
        !value.name ||
        !value.file_url?.startsWith("/private/files/") ||
        ![true, 1].includes(
          (value as NativeFile & { is_private?: boolean | number })
            .is_private ?? false,
        )
      )
        throw new Error("服务器未确认私有附件，文件尚未完成上传");
      release(entry.id);
      bytes.delete(entry.id);
      entry.serverName = value.name;
      entry.size = value.file_size;
      entry.url = services.fileDisplayUrl?.(value) || value.file_url;
      entry.state = "ready";
      entry.progress = 100;
      if (explicit) showToast("附件已上传");
    } catch (reason) {
      if (active()) {
        entry.state = "error";
        entry.error =
          reason instanceof Error
            ? reason.message
            : "上传失败，文件仍保留在本窗口";
        if (explicit)
          showToast(`附件上传失败：${entry.error}`, "danger", {
            label: "重试",
            action: () => void upload(entry, true),
          });
      }
    } finally {
      if (active()) options.changed?.();
    }
  }
  async function finalize() {
    for (const entry of [...files]) {
      if (!active() || !options.writable()) return;
      await upload(entry);
    }
    const chosen = files.find(
      (entry) => entry.primary && entry.state === "ready",
    );
    if (chosen?.serverName && chosen.serverName !== primarySaved)
      await primary(chosen, false);
    if (uploadBatchPending) {
      const batch = files.filter((entry) => uploadBatchIds.has(entry.id));
      if (
        batch.length &&
        batch.every((entry) => entry.state === "ready") &&
        !error.value
      )
        showToast(`${batch.length} 个附件已上传`);
      else if (batch.some((entry) => entry.state === "error"))
        showToast("部分附件上传失败，请查看文件行并重试", "danger");
      uploadBatchIds.clear();
      uploadBatchPending = false;
    }
  }
  async function remove(entry: AttachmentEntry) {
    if (
      !active() ||
      !options.writable() ||
      entry.state === "uploading" ||
      actionBusy.value
    )
      return;
    pendingActions.value[entry.id] = "remove";
    error.value = "";
    try {
      if (entry.serverName) {
        const parent = options.parent();
        if (!parent) return;
        const result = await services.call<{ parent_version?: string }>(
          "native_files.remove_attachment",
          {
            doctype: parent.doctype,
            name: parent.name,
            file_name: entry.serverName,
          },
        );
        if (active() && result.parent_version)
          options.parentChanged?.(result.parent_version);
      }
      if (!active()) return;
      release(entry.id);
      bytes.delete(entry.id);
      files.splice(files.indexOf(entry), 1);
      options.changed?.();
      showToast("附件已移除");
    } catch (reason) {
      if (active())
        error.value = reason instanceof Error ? reason.message : "附件移除失败";
      if (active())
        showToast(`附件移除失败：${error.value}`, "danger", {
          label: "重试",
          action: () => void remove(entry),
        });
    } finally {
      delete pendingActions.value[entry.id];
    }
  }
  function reselect(entry: AttachmentEntry, file: File) {
    if (!active() || !options.writable()) return;
    if (file.name !== entry.name) {
      error.value = "请选择同名文件，或移除此项后添加新文件";
      return;
    }
    release(entry.id);
    bytes.set(entry.id, file);
    entry.state = "pending";
    entry.type = file.type;
    if (
      file.type.startsWith("image/") &&
      typeof URL.createObjectURL === "function"
    ) {
      entry.url = previewUrl(file);
      if (entry.url) urls.set(entry.id, entry.url);
    }
    void upload(entry, true);
  }
  function restore(values: AttachmentEntry[]) {
    for (const value of values) {
      if (
        files.some(
          (row) =>
            row.id === value.id ||
            (value.serverName && row.serverName === value.serverName),
        )
      )
        continue;
      files.push({
        ...value,
        url: value.serverName ? value.url : undefined,
        state: value.serverName ? "ready" : "reselect",
        progress: value.serverName ? 100 : 0,
        error: value.serverName ? "" : "需要重新选择文件",
      });
    }
  }
  async function primary(entry: AttachmentEntry, announce = true) {
    if (
      !active() ||
      !options.primary ||
      !options.writable() ||
      busy.value ||
      actionBusy.value
    )
      return;
    pendingActions.value[entry.id] = "primary";
    try {
      if (!entry.serverName) {
        files.forEach((row) => {
          row.primary = row.id === entry.id;
        });
        options.changed?.();
        return;
      }
      error.value = "";
      try {
        await options.primary(entry.serverName);
        primarySaved = entry.serverName;
        if (active()) {
          files.forEach((row) => {
            row.primary = row.id === entry.id;
          });
          options.changed?.();
          if (announce) showToast("主图已更换；原文件仍作为附件保留");
        }
      } catch (reason) {
        if (active())
          error.value =
            reason instanceof Error ? reason.message : "主图保存失败";
        if (active() && announce)
          showToast(`主图保存失败：${error.value}`, "danger", {
            label: "重试",
            action: () => void primary(entry),
          });
      }
    } finally {
      delete pendingActions.value[entry.id];
    }
  }
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    request?.abort();
    for (const id of urls.keys()) release(id);
    bytes.clear();
  });
  return {
    files,
    loading,
    initialized,
    error,
    busy,
    pendingAction,
    actionBusy,
    incomplete,
    load,
    fetch: fetchFiles,
    clear,
    add,
    finalize,
    upload,
    remove,
    reselect,
    restore,
    primary,
  };
}
