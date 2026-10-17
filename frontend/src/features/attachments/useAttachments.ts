import { computed, onBeforeUnmount, reactive, ref } from "vue";
import { useInventoryServices } from "../../services/contracts";
import { fileMime, type NativeFile } from "../../lib/catalogPresentation";
export interface AttachmentEntry {
  id: string;
  name: string;
  type: string;
  url?: string;
  serverName?: string;
  primary?: boolean;
  state: "pending" | "uploading" | "ready" | "error" | "reselect";
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
  const bytes = new Map<string, File>(),
    urls = new Map<string, string>();
  let disposed = false;
  const active = () =>
    !disposed && options.currentAccount() === options.account;
  const busy = computed(() => files.some((row) => row.state === "uploading"));
  const incomplete = computed(() => files.some((row) => row.state !== "ready"));
  function release(id: string) {
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
  }
  function load(values: NativeFile[], primary = "") {
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
        url: services.fileDisplayUrl?.(value) || value.file_url,
        serverName: value.name,
        primary: value.file_url === primary,
        state: "ready",
        progress: 100,
        error: "",
      });
    }
  }
  function clear() {
    for (const id of urls.keys()) release(id);
    bytes.clear();
    files.splice(0);
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
  function add(values: File[]) {
    if (!active() || !options.writable()) return;
    for (const file of values) {
      const id = crypto.randomUUID();
      bytes.set(id, file);
      const url = previewUrl(file);
      if (url) urls.set(id, url);
      files.push({
        id,
        name: file.name,
        type: file.type,
        url,
        state: "pending",
        progress: 0,
        error: "",
      });
    }
    options.changed?.();
    if (options.parent()) void finalize();
  }
  async function upload(entry: AttachmentEntry) {
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
      entry.url = services.fileDisplayUrl?.(value) || value.file_url;
      entry.state = "ready";
      entry.progress = 100;
    } catch (reason) {
      if (active()) {
        entry.state = "error";
        entry.error =
          reason instanceof Error
            ? reason.message
            : "上传失败，文件仍保留在本窗口";
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
  }
  async function remove(entry: AttachmentEntry) {
    if (!active() || !options.writable() || entry.state === "uploading") return;
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
    } catch (reason) {
      if (active())
        error.value = reason instanceof Error ? reason.message : "附件移除失败";
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
    void upload(entry);
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
  async function primary(entry: AttachmentEntry) {
    if (
      !active() ||
      !entry.serverName ||
      !options.primary ||
      !options.writable() ||
      busy.value
    )
      return;
    error.value = "";
    try {
      await options.primary(entry.serverName);
      if (active()) {
        files.forEach((row) => {
          row.primary = row.id === entry.id;
        });
        options.changed?.();
      }
    } catch (reason) {
      if (active())
        error.value = reason instanceof Error ? reason.message : "主图保存失败";
    }
  }
  onBeforeUnmount(() => {
    disposed = true;
    for (const id of urls.keys()) release(id);
    bytes.clear();
  });
  return {
    files,
    error,
    busy,
    incomplete,
    load,
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
