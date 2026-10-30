import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ApiError, refreshSession, sessionExpired } from "../../lib/api";
import { applyUpdate, registerPwa } from "../../lib/pwa";
import { updateBlocked } from "../../lib/updateSafety";
import {
  createReferenceData,
  hydrateReferenceData,
  type BootstrapData,
  type InventoryServices,
  type ReferenceData,
} from "../../services/contracts";
export interface InitializationStatus {
  version?: string;
  setup_required: boolean;
  is_manager?: boolean;
  can_initialize?: boolean;
  selected_company?: string;
  companies?: string[];
  blockers: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
}
export function useApplication(
  reference: ReferenceData,
  services: InventoryServices,
  session = refreshSession,
) {
  const state = reactive({
    gate: "loading" as
      "loading" | "ready" | "login" | "forbidden" | "error" | "setup",
    loading: false,
    error: "",
    accessBlocked: false,
    status: undefined as InitializationStatus | undefined,
    selectedCompany: "",
    setupBusy: false,
    version: 0,
  });
  const resuming = ref(false);
  let generation = 0,
    disposed = false;
  let referenceChannel: BroadcastChannel | undefined;
  let lastCheck = 0;
  const current = (value: number) => !disposed && value === generation;
  async function check() {
    const wasReady = state.gate === "ready";
    const openingAccount = reference.user;
    const request = ++generation;
    lastCheck = Date.now();
    state.loading = true;
    state.error = "";
    try {
      const authenticated = await session();
      if (!current(request) || !authenticated) return;
      const changed = reference.user && reference.user !== authenticated.user;
      if (changed) {
        Object.assign(reference, createReferenceData());
        reference.user = authenticated.user;
        state.gate = "loading";
        state.version++;
      }
      const status = await services.call<InitializationStatus>(
        "configuration.status",
      );
      if (!current(request)) return;
      state.status = status;
      state.accessBlocked = status.blockers.some(
        (issue) =>
          issue.code === "stock_permission" ||
          issue.code.endsWith(":inaccessible"),
      );
      state.selectedCompany = status.selected_company || "";
      if (status.setup_required) {
        reference.user = authenticated.user;
        state.gate = wasReady && !changed ? "ready" : "setup";
        return;
      }
      const bootstrap = await services.call<BootstrapData>("browse.bootstrap");
      if (!current(request)) return;
      if (bootstrap.user !== authenticated.user) {
        Object.assign(reference, createReferenceData());
        reference.user = bootstrap.user;
        state.version++;
        throw new Error("账户已更改，请重新检查登录状态");
      }
      hydrateReferenceData(reference, bootstrap);
      state.gate = "ready";
    } catch (reason) {
      if (!current(request)) return;
      const kind = reason instanceof ApiError ? reason.kind : "";
      state.error =
        reason instanceof Error ? reason.message : "无法读取物资管理，请重试";
      const denied =
        reason instanceof ApiError &&
        reason.status === 403 &&
        !["AuthenticationError", "CSRFTokenError"].includes(kind);
      state.accessBlocked ||= denied;
      state.gate =
        wasReady && reference.user === openingAccount
          ? "ready"
          : denied
            ? "forbidden"
            : ["AuthenticationError", "CSRFTokenError"].includes(kind)
              ? "login"
              : "error";
    } finally {
      if (current(request)) state.loading = false;
    }
  }
  async function initialize() {
    if (
      !state.selectedCompany ||
      !state.status?.can_initialize ||
      state.setupBusy
    )
      return;
    state.setupBusy = true;
    state.error = "";
    try {
      await services.call("configuration.initialize", {
        company: state.selectedCompany,
        version: state.status.version,
      });
      await check();
    } catch (reason) {
      state.error =
        reason instanceof Error ? reason.message : "建立仓库失败，请重试";
    } finally {
      state.setupBusy = false;
    }
  }
  async function resume() {
    if (resuming.value) return;
    resuming.value = true;
    try {
      await check();
      if (
        state.gate === "ready" &&
        !state.error &&
        !state.status?.setup_required &&
        !sessionExpired.value
      )
        document.dispatchEvent(new Event("inventory-session-restored"));
    } finally {
      resuming.value = false;
    }
  }
  function update() {
    if (!updateBlocked.value) applyUpdate();
  }
  function configurationChanged() {
    void check();
  }
  // Other tabs announce changes over the channel; focus catches other devices' changes.
  function windowFocused() {
    if (Date.now() - lastCheck > 60_000) void check();
  }
  onMounted(() => {
    void check();
    void registerPwa();
    document.addEventListener(
      "inventory-configuration-changed",
      configurationChanged,
    );
    referenceChannel =
      typeof BroadcastChannel === "undefined"
        ? undefined
        : new BroadcastChannel("temple-inventory-configuration");
    referenceChannel?.addEventListener("message", configurationChanged);
    window.addEventListener("focus", windowFocused);
  });
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    document.removeEventListener(
      "inventory-configuration-changed",
      configurationChanged,
    );
    referenceChannel?.removeEventListener("message", configurationChanged);
    referenceChannel?.close();
    window.removeEventListener("focus", windowFocused);
  });
  return {
    state,
    resuming,
    check,
    initialize,
    resume,
    update,
    sessionExpired,
    updateBlocked,
  };
}
