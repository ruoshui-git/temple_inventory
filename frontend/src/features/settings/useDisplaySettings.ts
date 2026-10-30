import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import {
  capturePreferenceRevision,
  configurePreferenceSave,
  density,
  theme,
  textScale,
  defaultPeriods,
  preferenceError,
  preferenceSaveState,
  preferenceSaveQueue,
  preferenceUser,
  refreshServerPreferences,
} from "../../lib/uiPreferences";
import type { DisplayPreferences } from "../../lib/displayPreferences";
import { useUpdateBlocker } from "../../lib/updateSafety";
export function useDisplaySettings() {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const loading = ref(false),
    initialized = ref(false),
    error = ref("");
  let generation = 0,
    disposed = false;
  const active = () => !disposed && reference.user === account;
  configurePreferenceSave((values) =>
    services.call("preferences.save_display_preferences", { ...values }),
  );
  async function refresh() {
    const current = ++generation,
      revision = capturePreferenceRevision();
    loading.value = true;
    error.value = "";
    try {
      const value = await services.call<{
        user: string;
        ui_preferences: DisplayPreferences;
      }>("session.info");
      if (!active() || current !== generation) return;
      if (value.user !== account)
        throw new Error("账户已更改，请重新打开显示设置");
      refreshServerPreferences(value.user, value.ui_preferences, revision);
      initialized.value = true;
    } catch (reason) {
      if (active() && current === generation)
        error.value =
          reason instanceof Error ? reason.message : "读取显示设置失败";
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  function change(value: Partial<DisplayPreferences>) {
    if (active() && preferenceUser.value === account)
      preferenceSaveQueue.enqueue(value);
  }
  function retry() {
    if (active()) preferenceSaveQueue.retry();
  }
  useUpdateBlocker(() => preferenceSaveState.value !== "saved");
  onMounted(() => void refresh());
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
  });
  return {
    theme,
    density,
    textScale,
    defaultPeriods,
    account,
    loading,
    initialized,
    error,
    saveError: preferenceError,
    saveState: preferenceSaveState,
    change,
    retry,
    refresh,
  };
}
export type DisplaySettings = ReturnType<typeof useDisplaySettings>;
