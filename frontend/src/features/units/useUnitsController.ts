import { computed, ref } from "vue";
import { useFormValidation } from "../../composables/useFormValidation";
import {
  useReferenceData,
  useInventoryServices,
} from "../../services/contracts";
import { useConfirm } from "../../services/confirm";
import { showToast } from "../../services/toast";
import {
  deleteUnit,
  listUnits,
  refreshUnitReference,
  saveUnit,
  type UnitRow,
} from "../../services/units";

export function useUnitsController() {
  const services = useInventoryServices();
  const reference = useReferenceData();
  const { confirm } = useConfirm();
  const rows = ref<UnitRow[]>([]);
  const search = ref("");
  const loading = ref(false);
  const saving = ref(false);
  const initialized = ref(false);
  const dialog = ref(false);
  const editing = ref<UnitRow>();
  const error = ref("");
  const labelError = ref("");
  const refreshError = ref("");
  const name = ref("");
  const label = ref("");
  const whole = ref(false);
  const enabled = ref(true);
  const validation = useFormValidation();
  validation.register("unit-name", () => name.value, [
    (value) => (value.trim() ? true : "请输入单位名称"),
  ]);

  const visible = computed(() => {
    const term = search.value.trim().toLocaleLowerCase();
    return rows.value.filter(
      (row) =>
        !term || `${row.name} ${row.label}`.toLocaleLowerCase().includes(term),
    );
  });
  async function refresh() {
    loading.value = true;
    refreshError.value = "";
    try {
      rows.value = await listUnits(services);
      initialized.value = true;
    } catch (reason) {
      refreshError.value =
        reason instanceof Error ? reason.message : "单位列表读取失败";
    } finally {
      loading.value = false;
    }
  }
  function openCreate() {
    editing.value = undefined;
    name.value = "";
    label.value = "";
    whole.value = false;
    enabled.value = true;
    error.value = "";
    labelError.value = "";
    validation.clear("unit-name");
    dialog.value = true;
  }
  function openEdit(row: UnitRow) {
    editing.value = row;
    name.value = row.name;
    label.value = row.label === row.name ? "" : row.label;
    whole.value = row.must_be_whole_number;
    enabled.value = row.enabled;
    error.value = "";
    labelError.value = "";
    validation.clear("unit-name");
    dialog.value = true;
  }
  async function save() {
    if (saving.value || (!editing.value && !validation.validate().ok)) return;
    saving.value = true;
    error.value = "";
    try {
      const saved = await saveUnit(services, {
        name: editing.value?.name,
        uom_name: editing.value ? undefined : name.value.trim(),
        label: label.value.trim(),
        must_be_whole_number: whole.value,
        enabled: enabled.value,
      });
      await refreshUnitReference(services, reference);
      await refresh();
      dialog.value = false;
      showToast(`单位「${saved.label}」已保存`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "单位保存失败";
      const kind =
        reason && typeof reason === "object" && "kind" in reason
          ? String((reason as { kind: string }).kind)
          : "";
      if (kind.startsWith("UOM_CLASH:")) labelError.value = message;
      else error.value = message;
    } finally {
      saving.value = false;
    }
  }
  async function toggleEnabled(row: UnitRow) {
    try {
      await saveUnit(services, {
        name: row.name,
        label: row.label === row.name ? "" : row.label,
        must_be_whole_number: row.must_be_whole_number,
        enabled: !row.enabled,
      });
      await refreshUnitReference(services, reference);
      await refresh();
      showToast(`单位「${row.label}」已${row.enabled ? "停用" : "启用"}`);
    } catch (reason) {
      showToast(
        `单位状态更新失败：${reason instanceof Error ? reason.message : "请重试"}`,
        "danger",
      );
    }
  }
  async function remove(row: UnitRow) {
    if (
      !row.deletable ||
      !(await confirm({
        title: `删除单位「${row.label}」？`,
        message: "删除后无法恢复。",
      }))
    )
      return;
    try {
      await deleteUnit(services, row.name);
      await refreshUnitReference(services, reference);
      await refresh();
      showToast(`单位「${row.label}」已删除`);
    } catch (reason) {
      showToast(
        `单位删除失败：${reason instanceof Error ? reason.message : "请重试"}`,
        "danger",
      );
    }
  }
  void refresh();
  return {
    rows,
    visible,
    search,
    loading,
    initialized,
    dialog,
    editing,
    error,
    labelError,
    refreshError,
    name,
    label,
    whole,
    enabled,
    saving,
    validation,
    refresh,
    openCreate,
    openEdit,
    save,
    toggleEnabled,
    remove,
  };
}
