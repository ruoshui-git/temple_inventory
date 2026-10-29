import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { movementLabels } from "../../lib/presentationLabels";
import { detectInstallPlatform } from "../../lib/installGuidance";

export const notificationEvents = [
  { key: "movement_submitted", label: "新货物流动" },
  { key: "movement_cancelled", label: "流动撤销与修改" },
  { key: "count_adjustment", label: "盘点调整" },
  { key: "export_result", label: "导出结果" },
  { key: "expiry_digest", label: "每日效期提醒", defaultOff: true },
] as const;
export interface NotificationPreferences {
  enabled: boolean;
  movement_submitted: boolean;
  movement_cancelled: boolean;
  count_adjustment: boolean;
  export_result: boolean;
  expiry_digest: boolean;
  movement_kinds: Record<string, boolean>;
}
interface Device {
  name: string;
  user_agent_label: string;
  last_success?: string;
  last_error?: string;
}
const kinds = [
  "Receive",
  "Issue",
  "Loss",
  "Transfer",
  "Loan",
  "Return",
  "Damage",
  "Repair",
  "Disposal",
];
function decodeKey(value: string) {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
/** Ask for permission when needed, subscribe this browser and register it for the account. */
export async function subscribePushDevice(
  services: ReturnType<typeof useInventoryServices>,
  requestPermission: boolean,
) {
  const permission = requestPermission
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== "granted")
    throw new Error(
      permission === "denied"
        ? "浏览器已阻止通知，请在浏览器设置中允许。"
        : "尚未允许通知权限。请重试开启。",
    );
  const publicKey = await services.call<string>("push.public_key");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeKey(publicKey),
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
    throw new Error("浏览器未返回完整的推送信息");
  const saved = await services.call<{ name: string }>("push.subscribe", {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
  });
  return { subscription, publicKey, name: saved.name };
}
export function resolvePushState(state: {
  supported: boolean;
  secure?: boolean;
  dev?: boolean;
  ios: boolean;
  standalone: boolean;
  permission?: string;
  subscribed: boolean;
}) {
  if (!state.supported || state.dev) return "unsupported";
  if (state.secure === false) return "insecure";
  if (state.ios && !state.standalone) return "install";
  if (state.permission === "denied") return "denied";
  return state.subscribed ? "subscribed" : "off";
}

export function useNotificationSettings() {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const preferences = ref<NotificationPreferences>();
  const original = ref("");
  const devices = ref<Device[]>([]);
  const loading = ref(false),
    saving = ref(false),
    error = ref(""),
    saveError = ref(""),
    initialized = ref(false);
  const pushBusy = ref(false),
    pushError = ref(""),
    pushMessage = ref(""),
    localSubscription = ref<PushSubscription | null>(null),
    publicKey = ref("");
  const currentDeviceName = ref("");
  const standalone = computed(
    () =>
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  );
  const ios = computed(
    () =>
      detectInstallPlatform(
        navigator.userAgent,
        navigator.platform,
        navigator.maxTouchPoints,
      ) === "ios",
  );
  const pushSupported = computed(
    () =>
      !import.meta.env.DEV &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
  );
  const pushState = computed(() =>
    resolvePushState({
      supported: pushSupported.value,
      secure: window.isSecureContext,
      dev: import.meta.env.DEV,
      ios: ios.value,
      standalone: standalone.value,
      permission:
        typeof Notification === "undefined"
          ? undefined
          : Notification.permission,
      subscribed: !!localSubscription.value,
    }),
  );
  let disposed = false;
  const active = () => !disposed && reference.user === account;
  async function load() {
    loading.value = true;
    error.value = "";
    try {
      const [prefs, deviceRows] = await Promise.all([
        services.call<NotificationPreferences>("notifications.get_preferences"),
        services.call<Device[]>("push.my_devices"),
      ]);
      if (!active()) return;
      preferences.value = prefs;
      original.value = JSON.stringify(prefs);
      devices.value = deviceRows;
      initialized.value = true;
      await readLocalSubscription();
    } catch (reason) {
      if (active())
        error.value =
          reason instanceof Error ? reason.message : "读取通知设置失败";
    } finally {
      if (active()) loading.value = false;
    }
  }
  async function readLocalSubscription() {
    if (!pushSupported.value) return;
    try {
      localSubscription.value = await (
        await navigator.serviceWorker.ready
      ).pushManager.getSubscription();
    } catch {
      localSubscription.value = null;
    }
  }
  const dirty = computed(
    () =>
      !!preferences.value &&
      JSON.stringify(preferences.value) !== original.value,
  );
  async function save() {
    if (!preferences.value || saving.value || !dirty.value) return;
    saving.value = true;
    saveError.value = "";
    try {
      const saved = await services.call<NotificationPreferences>(
        "notifications.save_preferences",
        { preferences: JSON.stringify(preferences.value) },
      );
      preferences.value = saved;
      original.value = JSON.stringify(saved);
    } catch (reason) {
      saveError.value =
        reason instanceof Error ? reason.message : "通知设置保存失败";
    } finally {
      saving.value = false;
    }
  }
  async function subscribeDevice(requestPermission = false) {
    if (!pushSupported.value || pushBusy.value || pushState.value === "install")
      return;
    pushBusy.value = true;
    pushError.value = "";
    try {
      const saved = await subscribePushDevice(services, requestPermission);
      publicKey.value = saved.publicKey;
      localSubscription.value = saved.subscription;
      currentDeviceName.value = saved.name;
      await loadDevices();
    } catch (reason) {
      pushError.value =
        reason instanceof Error ? reason.message : "开启推送失败";
    } finally {
      pushBusy.value = false;
    }
  }
  const enablePush = () =>
    subscribeDevice(Notification.permission !== "granted");
  async function recheckPermission() {
    await subscribeDevice(false);
  }
  async function loadDevices() {
    devices.value = await services.call<Device[]>("push.my_devices");
  }
  async function testPush() {
    pushBusy.value = true;
    pushError.value = "";
    try {
      const result = await services.call<{ sent: number; failed: number }>(
        "push.send_test",
      );
      pushMessage.value = `已发送 ${result.sent} 台，失败 ${result.failed} 台`;
    } catch (reason) {
      pushError.value =
        reason instanceof Error ? reason.message : "测试通知发送失败";
    } finally {
      pushBusy.value = false;
    }
  }
  async function disablePush() {
    if (pushBusy.value) return;
    pushBusy.value = true;
    pushError.value = "";
    try {
      const device =
        devices.value.find((row) => row.name === currentDeviceName.value) ||
        devices.value.find(
          (row) => row.user_agent_label === navigator.userAgent.slice(0, 140),
        );
      if (localSubscription.value) {
        await localSubscription.value.unsubscribe();
        localSubscription.value = null;
      }
      if (device)
        await services.call("push.unsubscribe", { name: device.name });
      currentDeviceName.value = "";
      await loadDevices();
    } catch (reason) {
      pushError.value =
        reason instanceof Error ? reason.message : "关闭推送失败";
    } finally {
      pushBusy.value = false;
    }
  }
  async function removeDevice(device: Device) {
    try {
      await services.call("push.unsubscribe", { name: device.name });
      await loadDevices();
    } catch (reason) {
      pushError.value =
        reason instanceof Error ? reason.message : "移除此设备失败";
    }
  }
  onMounted(() => void load());
  onBeforeUnmount(() => {
    disposed = true;
  });
  return {
    account,
    preferences,
    kinds,
    kindLabels: movementLabels,
    notificationEvents,
    devices,
    loading,
    saving,
    error,
    saveError,
    initialized,
    pushBusy,
    pushError,
    pushMessage,
    pushSupported,
    pushState,
    standalone,
    dirty,
    load,
    save,
    enablePush,
    recheckPermission,
    testPush,
    disablePush,
    removeDevice,
  };
}
export type NotificationSettings = ReturnType<typeof useNotificationSettings>;
