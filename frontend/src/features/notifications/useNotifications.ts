import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import type { InventoryNotification, NotificationPage } from "./model";

export function useNotifications(
  pageSize = 20,
  fullPage = false,
  deferInitialLoad = false,
) {
  const services = useInventoryServices();
  const reference = useReferenceData();
  const account = reference.user;
  const rows = ref<InventoryNotification[]>([]);
  const unreadCount = ref(0);
  const hasRunningExports = ref(false);
  const initialized = ref(false);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref("");
  const unreadOnly = ref(false);
  const notificationType = ref("all");
  const notificationTypes = ref<{ value: string; label: string }[]>([]);
  const hasMore = ref(true);
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let popoverOpen = false;
  let rowsStale = true;
  const active = () => !disposed && reference.user === account;

  async function refreshCount() {
    try {
      const [count, status] = await Promise.all([
        services.call<number>("notifications.unread_count"),
        services.call<NotificationPage>("notifications.inbox", {
          page: 1,
          page_size: 1,
        }),
      ]);
      if (!active()) return;
      const changed = count !== unreadCount.value;
      unreadCount.value = count;
      hasRunningExports.value = status.has_running_exports;
      updateAppBadge(count);
      if (changed) {
        if (popoverOpen) void load();
        else rowsStale = true;
      }
    } catch {
      /* Keep the last known badge while offline. */
    }
  }
  function updateAppBadge(count: number) {
    if (typeof navigator === "undefined") return;
    const badging = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count && badging.setAppBadge)
      void badging.setAppBadge(count).catch(() => undefined);
    else if (!count && badging.clearAppBadge)
      void badging.clearAppBadge().catch(() => undefined);
  }
  async function load(reset = true) {
    const current = reset ? ++generation : generation;
    if (reset) {
      loading.value = true;
      hasMore.value = true;
    } else loadingMore.value = true;
    error.value = "";
    try {
      const page = await services.call<NotificationPage>(
        "notifications.inbox",
        {
          page: reset ? 1 : Math.floor(rows.value.length / pageSize) + 1,
          page_size: pageSize,
          unread_only: fullPage && unreadOnly.value,
          notification_type: fullPage ? notificationType.value : "all",
        },
      );
      if (!active() || current !== generation) return;
      rows.value = reset ? page.items : [...rows.value, ...page.items];
      unreadCount.value = page.unread_count;
      hasRunningExports.value = page.has_running_exports;
      hasMore.value = page.items.length === pageSize;
      initialized.value = true;
      updateAppBadge(page.unread_count);
    } catch (reason) {
      if (active() && current === generation)
        error.value = reason instanceof Error ? reason.message : "读取通知失败";
    } finally {
      if (active() && current === generation) {
        loading.value = false;
        loadingMore.value = false;
      }
    }
  }
  async function setPopoverOpen(value: boolean) {
    popoverOpen = value;
    if (value) {
      if (rowsStale || !initialized.value) {
        rowsStale = false;
        await load();
      }
    } else {
      rowsStale = true;
    }
  }
  async function loadMore() {
    if (!loadingMore.value && hasMore.value) await load(false);
  }
  async function markRead(name: string) {
    await services.call("notifications.mark_read", {
      names: JSON.stringify([name]),
    });
    const row = rows.value.find((item) => item.name === name);
    if (row) row.read = 1;
    await refreshCount();
    window.dispatchEvent(new Event("inventory-notification-refresh"));
  }
  async function markAllRead() {
    await services.call("notifications.mark_all_read");
    rows.value.forEach((row) => {
      row.read = 1;
    });
    unreadCount.value = 0;
    updateAppBadge(0);
    await refreshCount();
    window.dispatchEvent(new Event("inventory-notification-refresh"));
  }
  function refreshOnVisibility() {
    if (document.visibilityState === "visible") void refreshCount();
  }
  function refreshOnFocus() {
    void refreshCount();
  }
  function refreshOnAction() {
    void refreshCount();
  }
  onMounted(() => {
    if (!deferInitialLoad) void load();
    if (fullPage)
      void services
        .call<{ value: string; label: string }[]>("notifications.inbox_types")
        .then((rows) => {
          if (active()) notificationTypes.value = rows;
        })
        .catch(() => undefined);
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("inventory-notification-refresh", refreshOnAction);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshCount();
    }, 60000);
  });
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    if (timer) clearInterval(timer);
    window.removeEventListener("focus", refreshOnFocus);
    window.removeEventListener(
      "inventory-notification-refresh",
      refreshOnAction,
    );
    document.removeEventListener("visibilitychange", refreshOnVisibility);
  });
  const groups = computed(() => rows.value);
  return {
    rows: groups,
    unreadCount,
    hasRunningExports,
    initialized,
    loading,
    loadingMore,
    error,
    unreadOnly,
    notificationType,
    notificationTypes,
    hasMore,
    load,
    loadMore,
    markRead,
    markAllRead,
    refreshCount,
    setPopoverOpen,
    refresh: () => load(true),
  };
}
