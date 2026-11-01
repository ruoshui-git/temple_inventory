import { computed, ref } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { useConfirm } from "../../services/confirm";
import { showToast } from "../../services/toast";
import {
  deleteActivityType,
  listActivityTypes,
  refreshActivityTypeReference,
  reorderActivityTypes,
  saveActivityType,
  type ActivityTypeRow,
} from "../../services/activityTypes";

export function useActivityTypesController() {
  const services = useInventoryServices();
  const reference = useReferenceData();
  const { confirm } = useConfirm();
  const rows = ref<ActivityTypeRow[]>([]);
  const search = ref("");
  const statusFilter = ref<"all" | "enabled" | "disabled">("all");
  const loading = ref(false);
  const saving = ref(false);
  const initialized = ref(false);
  const refreshError = ref("");
  const dialog = ref(false);
  const editing = ref<ActivityTypeRow>();
  const label = ref("");
  const enabled = ref(true);
  const error = ref("");
  const visible = computed(() => {
    const term = search.value.trim().toLocaleLowerCase();
    return rows.value.filter(
      (row) =>
        (!term ||
          `${row.label} ${row.name}`.toLocaleLowerCase().includes(term)) &&
        (statusFilter.value === "all" ||
          row.enabled === (statusFilter.value === "enabled")),
    );
  });
  async function refresh() {
    loading.value = true;
    refreshError.value = "";
    try {
      rows.value = (await listActivityTypes(services)).sort(
        (a, b) =>
          a.display_order - b.display_order ||
          a.label.localeCompare(b.label, "zh-CN"),
      );
      initialized.value = true;
    } catch (reason) {
      refreshError.value =
        reason instanceof Error ? reason.message : "活动类型列表读取失败";
    } finally {
      loading.value = false;
    }
  }
  function openCreate() {
    editing.value = undefined;
    label.value = "";
    enabled.value = true;
    error.value = "";
    dialog.value = true;
  }
  function openEdit(row: ActivityTypeRow) {
    editing.value = row;
    label.value = row.label;
    enabled.value = row.enabled;
    error.value = "";
    dialog.value = true;
  }
  async function refreshAfterWrite() {
    await refreshActivityTypeReference(services, reference);
    await refresh();
  }
  async function save() {
    if (saving.value) return;
    saving.value = true;
    error.value = "";
    try {
      await saveActivityType(services, {
        name: editing.value?.name,
        label: label.value.trim(),
        enabled: enabled.value,
      });
      await refreshAfterWrite();
      dialog.value = false;
      showToast(`活动类型「${label.value.trim()}」已保存`);
    } catch (reason) {
      error.value =
        reason instanceof Error ? reason.message : "活动类型保存失败";
    } finally {
      saving.value = false;
    }
  }
  async function remove(row: ActivityTypeRow) {
    if (
      !row.deletable ||
      !(await confirm({
        title: `删除活动类型「${row.label}」？`,
        message: "删除后无法恢复。",
      }))
    )
      return;
    try {
      await deleteActivityType(services, row.name);
      await refreshAfterWrite();
      showToast(`活动类型「${row.label}」已删除`);
    } catch (reason) {
      showToast(
        `活动类型删除失败：${reason instanceof Error ? reason.message : "请重试"}`,
        "danger",
      );
    }
  }
  async function move(row: ActivityTypeRow, delta: -1 | 1) {
    if (search.value.trim() || statusFilter.value !== "all") return;
    const index = rows.value.findIndex((item) => item.name === row.name);
    const destination = index + delta;
    if (index < 0 || destination < 0 || destination >= rows.value.length)
      return;
    const names = rows.value.map((item) => item.name);
    [names[index], names[destination]] = [names[destination]!, names[index]!];
    try {
      rows.value = await reorderActivityTypes(services, names);
      await refreshAfterWrite();
    } catch (reason) {
      showToast(
        `活动类型排序失败：${reason instanceof Error ? reason.message : "请重试"}`,
        "danger",
      );
    }
  }
  void refresh();
  return {
    rows,
    visible,
    search,
    statusFilter,
    loading,
    saving,
    initialized,
    refreshError,
    dialog,
    editing,
    label,
    enabled,
    error,
    refresh,
    openCreate,
    openEdit,
    save,
    remove,
    move,
  };
}
