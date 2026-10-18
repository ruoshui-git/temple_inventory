import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { useUpdateBlocker } from "../../lib/updateSafety";
export interface ConfigurationStatus {
  version: string;
  ready: boolean;
  setup_required: boolean;
  is_manager: boolean;
  can_initialize: boolean;
  companies: string[];
  selected_company: string;
  blockers: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  pointers: { field: string; label: string; current: string; issue: string }[];
  candidates: {
    value: string;
    label: string;
    group: boolean;
    parent: string;
    type: string;
    version: string;
  }[];
}
export interface RepairPreview {
  field: string;
  label: string;
  current: string;
  replacement: string;
  version: string;
  visible_nodes: number;
  visible_leaves: number;
  impact: string;
  fingerprint: string;
  affected_references: { field: string; warehouse: string }[];
}
export function useConfiguration(changed: () => void) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const status = ref<ConfigurationStatus>(),
    loading = ref(false),
    busy = ref(false),
    error = ref("");
  const company = ref(""),
    field = ref("physical_root_warehouse"),
    warehouse = ref("");
  const preview = ref<RepairPreview>(),
    confirmed = ref(false),
    initializeOpen = ref(false),
    message = ref("");
  let disposed = false,
    generation = 0;
  const active = () => !disposed && account === reference.user;
  const groups = new Set([
    "root_warehouse",
    "physical_root_warehouse",
    "leased_warehouse",
  ]);
  const options = computed(() =>
    (status.value?.candidates || [])
      .filter((row) => row.group === groups.has(field.value))
      .map((row) => ({
        value: row.value,
        label: row.label,
        detail: `ERPNext 名称：${row.value}`,
      })),
  );
  async function load() {
    const current = ++generation;
    loading.value = true;
    error.value = "";
    try {
      const value = await services.call<ConfigurationStatus>(
        "configuration.status",
      );
      if (!active() || current !== generation) return;
      status.value = value;
      company.value ||= value.selected_company;
    } catch (reason) {
      if (active() && current === generation)
        error.value = reason instanceof Error ? reason.message : "配置读取失败";
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  function clearPreview() {
    preview.value = undefined;
    confirmed.value = false;
  }
  async function review() {
    if (busy.value || !warehouse.value || !status.value || !active()) return;
    busy.value = true;
    error.value = "";
    clearPreview();
    try {
      const value = await services.call<RepairPreview>(
        "configuration.repair_preview",
        { field: field.value, warehouse: warehouse.value },
      );
      if (active()) preview.value = value;
    } catch (reason) {
      if (active())
        error.value =
          reason instanceof Error ? reason.message : "修复影响读取失败";
    } finally {
      if (active()) busy.value = false;
    }
  }
  async function apply(initialize = false) {
    if (
      busy.value ||
      !active() ||
      !status.value ||
      (initialize
        ? !company.value || !status.value.can_initialize
        : !preview.value || !confirmed.value)
    )
      return;
    busy.value = true;
    error.value = "";
    message.value = "";
    try {
      const value = await services.call<ConfigurationStatus>(
        initialize
          ? "configuration.initialize"
          : "configuration.repair_pointer",
        initialize
          ? { company: company.value, version: status.value.version }
          : {
              field: preview.value!.field,
              warehouse: preview.value!.replacement,
              version: preview.value!.version,
              fingerprint: preview.value!.fingerprint,
              confirmed: true,
            },
      );
      if (!active()) return;
      status.value = value;
      initializeOpen.value = false;
      clearPreview();
      message.value = initialize
        ? "必需仓库已建立；尚未导入库存数量。"
        : "配置引用已更新，请核对当前配置状态。";
      changed();
    } catch (reason) {
      if (active())
        error.value =
          reason instanceof Error
            ? reason.message
            : "配置保存失败，当前选择仍保留";
    } finally {
      if (active()) busy.value = false;
    }
  }
  watch(
    () => reference.user,
    () => {
      if (!active()) {
        generation++;
        status.value = undefined;
        clearPreview();
        initializeOpen.value = false;
      }
    },
  );
  useUpdateBlocker(() => busy.value || initializeOpen.value || !!preview.value);
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
  });
  void load();
  return {
    reference,
    status,
    loading,
    busy,
    error,
    company,
    field,
    warehouse,
    preview,
    confirmed,
    initializeOpen,
    message,
    options,
    clearPreview,
    load,
    review,
    apply,
  };
}
