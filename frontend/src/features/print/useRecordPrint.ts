import { onBeforeUnmount, ref } from "vue";
import { preferenceUser } from "../../lib/uiPreferences";
import { showToast } from "../../services/toast";

export function useRecordPrint() {
  const url = ref("");
  const number = ref("");
  const loading = ref(false);
  async function open(doctype: string, name: string) {
    if (loading.value || !name) return;
    loading.value = true;
    try {
      const query = new URLSearchParams({ doctype, name });
      const response = await fetch(
        `/api/method/temple_inventory.printing.print_record_pdf?${query}`,
        {
          credentials: "same-origin",
          headers: preferenceUser.value
            ? { "X-Inventory-Account": preferenceUser.value }
            : {},
        },
      );
      if (!response.ok) {
        const body = await response.text();
        let message = "打印失败，请重试";
        try {
          const payload = JSON.parse(body) as {
            message?: string;
            _server_messages?: string;
          };
          message = payload.message || message;
        } catch {
          if (body.length < 300) message = body || message;
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("打印文件为空，请重试");
      if (url.value) URL.revokeObjectURL(url.value);
      url.value = URL.createObjectURL(blob);
      number.value = name;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "打印失败，请重试",
        "danger",
      );
    } finally {
      loading.value = false;
    }
  }
  function close() {
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = "";
    number.value = "";
  }
  onBeforeUnmount(close);
  return { url, number, loading, open, close };
}
