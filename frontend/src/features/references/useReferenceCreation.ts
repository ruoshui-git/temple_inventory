import { useUpdateBlocker } from "../../lib/updateSafety";
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
export function useReferenceCreation(
  kind: "unit" | "category",
  selected: (name: string) => void,
) {
  const services = useInventoryServices(),
    reference = useReferenceData();
  const creating = ref(false),
    name = ref(""),
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
    whole.value = snapshot.values.whole === true;
    group.value = snapshot.values.group === true;
    parent.value = String(snapshot.values.parent || initialParent);
    creating.value = true;
    candidates.value = [];
    suppressed = false;
    retain();
  }
  watch([name, whole, group, parent], retain, { flush: "sync" });
  function finish() {
    if (busy.value) return;
    suppressed = true;
    recovery.remove(editorId, revision);
    creating.value = false;
    name.value = "";
    whole.value = false;
    group.value = false;
    parent.value = initialParent;
    error.value = "";
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
        const result = await services.call<{
          name: string;
          must_be_whole_number: boolean;
        }>("catalog.create_uom", {
          label: name.value.trim(),
          must_be_whole_number: whole.value,
        });
        if (disposed || reference.user !== account) return;
        const previous = reference.units.find(
          (row) => row.name === result.name,
        );
        if (previous) previous.whole = result.must_be_whole_number;
        else
          reference.units.push({
            name: result.name,
            whole: result.must_be_whole_number,
          });
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
      finish();
    } catch (reason) {
      if (!disposed) {
        error.value =
          reason instanceof Error ? reason.message : "保存失败，输入已保留";
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
