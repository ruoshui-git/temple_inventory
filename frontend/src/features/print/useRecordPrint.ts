import { onBeforeUnmount, ref } from "vue";
import { preferenceUser } from "../../lib/uiPreferences";
import { startPrintPdf } from "../../services/backgroundTasks";
import { showToast } from "../../services/toast";

// The hidden iframe stays mounted until afterprint; the timeout covers browsers that never fire it.
const cleanupFallbackMs = 120_000;
const loadTimeoutMs = 10_000;

export function useRecordPrint() {
  const loading = ref(false);
  let frame: HTMLIFrameElement | undefined;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

  function removeFrame() {
    clearTimeout(cleanupTimer);
    frame?.remove();
    frame = undefined;
  }

  function loaded(element: HTMLIFrameElement) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("打印页面加载超时，请重试")),
        loadTimeoutMs,
      );
      element.addEventListener(
        "load",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  // Printing goes through the browser: the server renders standalone HTML and the
  // browser's own print dialog produces the paper output (no PDF preview step).
  async function print(doctype: string, name: string) {
    if (loading.value || !name) return;
    loading.value = true;
    try {
      const query = new URLSearchParams({ doctype, name });
      const response = await fetch(
        `/api/method/temple_inventory.printing.print_record_html?${query}`,
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
      const payload = (
        (await response.json()) as { message?: { html?: string } }
      ).message;
      if (!payload?.html) throw new Error("打印内容为空，请重试");
      removeFrame();
      const element = document.createElement("iframe");
      element.setAttribute("aria-hidden", "true");
      element.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      const ready = loaded(element);
      element.srcdoc = payload.html;
      document.body.append(element);
      frame = element;
      await ready;
      await element.contentDocument?.fonts?.ready;
      const target = element.contentWindow;
      if (!target) throw new Error("无法打开打印窗口，请使用下载 PDF");
      target.addEventListener("afterprint", removeFrame, { once: true });
      cleanupTimer = setTimeout(removeFrame, cleanupFallbackMs);
      target.focus();
      target.print();
    } catch (error) {
      removeFrame();
      showToast(
        error instanceof Error ? error.message : "打印失败，请重试",
        "danger",
      );
    } finally {
      loading.value = false;
    }
  }

  // 下载 PDF runs as a background tray task, so the page stays usable while it renders.
  function downloadPdf(doctype: string, name: string, title: string) {
    if (!name) return;
    startPrintPdf({ title, doctype, name });
  }

  onBeforeUnmount(removeFrame);
  return { loading, print, downloadPdf };
}
