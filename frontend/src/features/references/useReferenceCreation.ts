import { useUpdateBlocker } from "../../lib/updateSafety";
import { unitLabel } from "../../lib/units";
import { onCategoryRenamed } from "../../lib/categoryRename";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  createRecoveryStore,
  recoveryValues,
  type RecoverySnapshot,
} from "../../lib/browserRecovery";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { showToast } from "../../services/toast";
import { useConfirm } from "../../services/confirm";
import { saveUnit } from "../../services/units";
export function useReferenceCreation(
  kind: "unit" | "category",
  selected: (name: string) => void,
) {
  const services = useInventoryServices(),
    reference = useReferenceData();
  const { confirm } = useConfirm();
  const creating = ref(false),
    name = ref(""),
    displayLabel = ref(""),
    existingUnit = ref(""),
    whole = ref(false),
    group = ref(false),
    parent = ref(""),
    busy = ref(false),
    error = ref("");
  const permitted = computed(() => true);
  const stopCategoryRename = onCategoryRenamed(({ oldName, category }) => {
    if (kind === "category" && parent.value === oldName)
      parent.value = category.name;
    if (kind !== "category") return;
    candidates.value = candidates.value.map((candidate) => {
      if (candidate.values.parent !== oldName) return candidate;
      const updated = {
        ...candidate,
        revision: candidate.revision + 1,
        updatedAt: new Date().toISOString(),
        values: { ...candidate.values, parent: category.name },
      };
      recovery.save(updated);
      return updated;
    });
  });
  let disposed = false,
    suppressed = false,
    revision = 0;
  const account = reference.user,
    editorId = crypto.randomUUID(),
    tabId = crypto.randomUUID();
  const editorKind = kind === "unit" ? "UOM" : "Item Group";
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* Keep fields usable. */
  }
  const recovery = createRecoveryStore(reference.site, account, storage);
  const candidates = ref<RecoverySnapshot[]>(
    recovery.list().entries.filter((row) => row.editorKind === editorKind),
  );
  const recoveryError = ref("");
  const initialParent = parent.value;
  const dirty = computed(
    () =>
      !!name.value ||
      !!displayLabel.value ||
      whole.value ||
      group.value ||
      parent.value !== initialParent,
  );
  function retain() {
    if (suppressed || disposed || reference.user !== account || !dirty.value)
      return;
    revision++;
    const result = recovery.save({
      schema: 1,
      site: reference.site,
      account,
      tabId,
      editorId,
      editorKind,
      revision,
      updatedAt: new Date().toISOString(),
      pendingUploadReselection: false,
      values: recoveryValues({
        name: name.value,
        displayLabel: displayLabel.value,
        whole: whole.value,
        group: group.value,
        parent: parent.value,
      }),
    });
    recoveryError.value = result.error;
  }
  function recover(snapshot: RecoverySnapshot) {
    if (
      snapshot.account !== account ||
      snapshot.site !== reference.site ||
      reference.user !== account ||
      snapshot.editorKind !== editorKind
    )
      return;
    suppressed = true;
    name.value = String(snapshot.values.name || "");
    displayLabel.value = String(snapshot.values.displayLabel || "");
    whole.value = snapshot.values.whole === true;
    group.value = snapshot.values.group === true;
    parent.value = String(snapshot.values.parent || initialParent);
    creating.value = true;
    candidates.value = [];
    suppressed = false;
    retain();
  }
  watch([name, displayLabel, whole, group, parent], retain, { flush: "sync" });
  async function finish(confirmDirty = true) {
    if (busy.value) return;
    if (
      confirmDirty &&
      dirty.value &&
      !(await confirm({
        title: `放弃新建${kind === "unit" ? "单位" : "分类"}？`,
        message: "尚未保存的输入将丢失。",
      }))
    )
      return;
    suppressed = true;
    recovery.remove(editorId, revision);
    creating.value = false;
    name.value = "";
    displayLabel.value = "";
    whole.value = false;
    group.value = false;
    parent.value = initialParent;
    error.value = "";
    existingUnit.value = "";
    suppressed = false;
  }
  async function create() {
    if (
      busy.value ||
      !permitted.value ||
      disposed ||
      reference.user !== account
    )
      return;
    if (!name.value.trim()) {
      error.value = kind === "unit" ? "请填写单位名称" : "请填写分类名称";
      return;
    }
    if (
      kind === "category" &&
      parent.value &&
      !reference.categories.some(
        (row) => row.name === parent.value && row.is_group,
      )
    ) {
      error.value = "请选择上级分组";
      return;
    }
    busy.value = true;
    error.value = "";
    try {
      if (kind === "unit") {
        const normalizedName = name.value.trim().toLocaleLowerCase();
        const normalizedLabel = displayLabel.value.trim().toLocaleLowerCase();
        const clash = reference.units.find((unit) => {
          const nameKey = unit.name.trim().toLocaleLowerCase();
          const labelKey = (unit.label || unit.name).trim().toLocaleLowerCase();
          return [normalizedName, normalizedLabel].some(
            (key) => key && (key === nameKey || key === labelKey),
          );
        });
        if (clash) {
          const clashText = normalizedLabel || normalizedName;
          // A disabled unit can't be chosen for new input; it must be re-enabled first.
          existingUnit.value = clash.enabled === false ? "" : clash.name;
          error.value =
            clash.enabled === false
              ? `「${clashText}」属于已停用的单位 ${unitLabel(clash.name)}，请先在单位管理中启用`
              : `「${clashText}」已被单位 ${unitLabel(clash.name)} 使用`;
          busy.value = false;
          return;
        }
        const result = await saveUnit(services, {
          uom_name: name.value.trim(),
          label: displayLabel.value.trim(),
          must_be_whole_number: whole.value,
        });
        if (disposed || reference.user !== account) return;
        const previous = reference.units.find(
          (row) => row.name === result.name,
        );
        if (previous) {
          previous.label = result.label || result.name;
          previous.whole = result.must_be_whole_number;
        } else {
          reference.units.push({
            name: result.name,
            label: result.label || result.name,
            whole: result.must_be_whole_number,
            enabled: true,
          });
        }
        selected(result.name);
        showToast("库存单位已创建");
      } else {
        const result = await services.call<{
          name: string;
          label: string;
          parent: string;
          is_group: boolean;
        }>("catalog.create_category", {
          label: name.value.trim(),
          parent: parent.value || null,
          is_group: group.value,
        });
        if (disposed || reference.user !== account) return;
        const previous = reference.categories.find(
          (row) => row.name === result.name,
        );
        if (previous) Object.assign(previous, result);
        else reference.categories.push(result);
        selected(result.name);
        showToast("分类已创建");
      }
      busy.value = false;
      await finish(false);
    } catch (reason) {
      if (!disposed) {
        error.value =
          reason instanceof Error ? reason.message : "保存失败，输入已保留";
        const kindValue =
          reason && typeof reason === "object" && "kind" in reason
            ? String((reason as { kind: string }).kind)
            : "";
        const clashMatch = /^UOM_CLASH:(.+)$/.exec(kindValue);
        existingUnit.value = clashMatch?.[1] || "";
        showToast(
          `${kind === "unit" ? "库存单位" : "分类"}创建失败：${error.value}`,
          "danger",
        );
      }
    } finally {
      if (!disposed) busy.value = false;
    }
  }
  onBeforeUnmount(() => {
    stopCategoryRename();
    if (dirty.value) retain();
    disposed = true;
  });
  useUpdateBlocker(() => dirty.value || busy.value);

  return {
    reference,
    creating,
    name,
    displayLabel,
    existingUnit,
    whole,
    group,
    parent,
    busy,
    error,
    permitted,
    finish,
    create,
    dirty,
    recovery,
    candidates,
    recoveryError,
    recover,
  };
}
