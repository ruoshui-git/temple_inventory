import {
  computed,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { moreNavigation } from "../../lib/appNavigation";
import {
  installInstructions,
  type InstallPlatform,
} from "../../lib/installGuidance";
import { useLogoutController } from "./useLogoutController";
export interface MoreHost {
  platform(): InstallPlatform;
  standalone(): boolean;
  install(): Promise<boolean>;
  logout(): Promise<void>;
  afterLogout(): void;
}
export function useMoreController(
  host: MoreHost,
  visible: () => boolean = () => true,
) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const installOpen = ref(false),
    installBusy = ref(false),
    installError = ref("");
  const logoutController = useLogoutController(host, () => reference.user),
    logoutOpen = logoutController.open,
    busy = computed(() => installBusy.value || logoutController.busy.value),
    error = computed(() => logoutController.error.value || installError.value),
    summaryError = ref(""),
    loading = ref(false),
    draftCount = ref<number>();
  let generation = 0,
    disposed = false;
  const active = () => !disposed && reference.user === account;
  const guidance = computed(() => installInstructions(host.platform()));
  const canInstall = computed(() => !host.standalone());
  async function load() {
    const current = ++generation;
    loading.value = true;
    summaryError.value = "";
    try {
      const value = await services.call<{ draft_count: number }>(
        "browse.more_summary",
      );
      if (active() && current === generation)
        draftCount.value = value.draft_count;
    } catch (reason) {
      if (active() && current === generation)
        summaryError.value =
          reason instanceof Error ? reason.message : "读取草稿数量失败";
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  async function install() {
    if (busy.value || !active()) return;
    installBusy.value = true;
    installError.value = "";
    try {
      if (!(await host.install()) && active() && visible())
        installOpen.value = true;
    } catch (reason) {
      if (active())
        installError.value =
          reason instanceof Error ? reason.message : "无法打开安装选项";
    } finally {
      if (active()) installBusy.value = false;
    }
  }
  function close() {
    if (!busy.value) {
      installOpen.value = false;
      logoutController.close();
    }
  }
  function deactivate() {
    installOpen.value = false;
    logoutController.close();
  }
  watch(visible, (value) => {
    if (!value) deactivate();
  });
  onDeactivated(deactivate);
  onMounted(() => void load());
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
  });
  return {
    reference,
    groups: moreNavigation,
    installOpen,
    installBusy,
    logoutOpen,
    busy,
    error,
    summaryError,
    loading,
    draftCount,
    guidance,
    canInstall,
    load,
    install,
    logout: logoutController.logout,
    close,
  };
}
export type MoreController = ReturnType<typeof useMoreController>;
