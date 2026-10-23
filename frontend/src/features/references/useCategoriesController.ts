import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useUpdateBlocker } from "../../lib/updateSafety";
import {
  createRecoveryStore,
  recoveryValues,
  type RecoverySnapshot,
} from "../../lib/browserRecovery";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { onCategoryRenamed } from "../../lib/categoryRename";
import { showToast } from "../../services/toast";
import type { CategoryDraft } from "./CategoryFormFields.vue";

export interface Category extends Record<string, unknown> {
  name: string;
  label: string;
  parent: string;
  is_group: boolean;
  version: string;
  lft: number;
  rgt: number;
}

const emptyDraft = (): CategoryDraft => ({
  label: "",
  parent: "",
  is_group: false,
});

export function useCategoriesController() {
  const services = useInventoryServices();
  const reference = useReferenceData();
  const search = ref("");
  const expanded = ref(new Set<string>());
  const dialog = ref(false);
  const saving = ref(false);
  const deleting = ref(false);
  const loading = ref(false);
  const initializedState = ref(false);
  const error = ref("");
  const refreshError = ref("");
  const success = ref("");
  const removeTarget = ref<Category>();
  const editing = ref<Category>();
  const form = ref<CategoryDraft>(emptyDraft());
  const baseline = ref<CategoryDraft>(emptyDraft());
  const discardOpen = ref(false);
  const leaveRequested = ref(false);
  const recoveryError = ref("");
  const recoveryConflict = ref("");
  let account = reference.user;
  let site = reference.site;
  let initialized = false;
  let generation = 0;
  let disposed = false;
  let request: AbortController | undefined;
  let tabId: string = crypto.randomUUID();
  let editorId: string = crypto.randomUUID();
  let revision = 0;
  let recovery: ReturnType<typeof createRecoveryStore>;
  let leaveResolve: ((value: boolean) => void) | undefined;
  let allowLeave = false;
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* The editor remains usable without recovery storage. */
  }
  function createRecovery() {
    recovery = createRecoveryStore(reference.site, account, storage);
    const listed = recovery.list();
    recoveryError.value = listed.error;
  }
  createRecovery();
  const active = (current = generation) =>
    !disposed && current === generation && account === reference.user;
  const categories = computed(() => reference.categories as Category[]);
  const canCreate = computed(
    () => reference.capabilities["Item Group"]?.create === true,
  );
  const canWrite = computed(
    () => reference.capabilities["Item Group"]?.write === true,
  );
  const canDelete = computed(
    () => reference.capabilities["Item Group"]?.delete === true,
  );
  const dirty = computed(
    () =>
      dialog.value &&
      JSON.stringify(form.value) !== JSON.stringify(baseline.value),
  );
  const byName = computed(
    () => new Map(categories.value.map((row) => [row.name, row])),
  );
  const stopCategoryRename = onCategoryRenamed(({ oldName, category }) => {
    if (form.value.parent === oldName) form.value.parent = category.name;
    if (editing.value?.name === oldName)
      editing.value = { ...editing.value, ...category } as Category;
    if (expanded.value.has(oldName)) {
      const next = new Set(expanded.value);
      next.delete(oldName);
      next.add(category.name);
      expanded.value = next;
    }
  });
  const children = (name: string) =>
    categories.value.filter((row) => row.parent === name);
  const matching = computed(() => {
    const term = search.value.toLocaleLowerCase().trim();
    if (!term) return new Set(categories.value.map((row) => row.name));
    const matched = new Set<string>();
    for (const row of categories.value) {
      if (!`${row.label} ${row.name}`.toLocaleLowerCase().includes(term))
        continue;
      let current: Category | undefined = row;
      while (current) {
        matched.add(current.name);
        current = current.parent ? byName.value.get(current.parent) : undefined;
      }
    }
    return matched;
  });
  function depth(row: Category) {
    let count = 0;
    let current = row.parent ? byName.value.get(row.parent) : undefined;
    while (current && count < categories.value.length) {
      count++;
      current = current.parent ? byName.value.get(current.parent) : undefined;
    }
    return count;
  }
  function visible(row: Category) {
    if (!matching.value.has(row.name)) return false;
    if (search.value.trim()) return true;
    let parent = row.parent ? byName.value.get(row.parent) : undefined;
    while (parent) {
      if (!expanded.value.has(parent.name)) return false;
      parent = parent.parent ? byName.value.get(parent.parent) : undefined;
    }
    return true;
  }
  function descendants(name: string): string[] {
    const result: string[] = [];
    const visit = (parent: string) => {
      for (const child of children(parent)) {
        result.push(child.name);
        visit(child.name);
      }
    };
    visit(name);
    return result;
  }
  function parentExclusions(row?: Category) {
    return row ? [row.name, ...descendants(row.name)] : [];
  }
  function retain() {
    if (!dirty.value || !active()) return;
    revision++;
    const result = recovery.save({
      schema: 1,
      site: reference.site,
      account,
      tabId,
      editorId,
      editorKind: "Item Group",
      revision,
      updatedAt: new Date().toISOString(),
      pendingUploadReselection: false,
      values: recoveryValues({
        form: form.value,
        editing: editing.value
          ? { name: editing.value.name, version: editing.value.version }
          : null,
      }),
    });
    recoveryError.value = result.error;
  }
  watch(form, retain, { deep: true, flush: "sync" });
  async function refresh() {
    const current = generation;
    if (!account || disposed) return;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    loading.value = true;
    refreshError.value = "";
    try {
      const result = await services.call<Category[]>(
        "catalog.category_tree",
        {},
        controller.signal,
      );
      if (!active(current) || controller.signal.aborted) return;
      reference.categories.splice(0, reference.categories.length, ...result);
      initializedState.value = true;
    } catch (reason) {
      if (!controller.signal.aborted && active(current))
        refreshError.value =
          reason instanceof Error ? reason.message : "分类列表读取失败";
    } finally {
      if (active(current) && request === controller) loading.value = false;
    }
  }
  function openCreate(parent = "") {
    if (!canCreate.value) return;
    editing.value = undefined;
    form.value = { ...emptyDraft(), parent };
    baseline.value = { ...form.value };
    error.value = "";
    recoveryConflict.value = "";
    success.value = "";
    dialog.value = true;
  }
  function openEdit(row: Category) {
    if (!canWrite.value) return;
    editing.value = row;
    form.value = {
      label: row.label,
      parent: row.parent,
      is_group: row.is_group,
    };
    baseline.value = { ...form.value };
    error.value = "";
    recoveryConflict.value = "";
    success.value = "";
    dialog.value = true;
  }
  function clearEditor() {
    recovery.remove(editorId, revision);
    dialog.value = false;
    editing.value = undefined;
    form.value = emptyDraft();
    baseline.value = emptyDraft();
    error.value = "";
    discardOpen.value = false;
  }
  function closeEditor() {
    if (saving.value) return;
    if (dirty.value) discardOpen.value = true;
    else clearEditor();
  }
  async function recover(snapshot: RecoverySnapshot) {
    if (
      !active() ||
      snapshot.account !== account ||
      snapshot.site !== reference.site
    )
      return;
    const value = snapshot.values.form as Partial<CategoryDraft> | undefined;
    if (!value) return;
    if (dirty.value) {
      recoveryConflict.value = "请先完成当前分类输入，再恢复另一条未完成输入。";
      return;
    }
    await refresh();
    if (
      !active() ||
      snapshot.account !== account ||
      snapshot.site !== reference.site
    )
      return;
    if (refreshError.value) {
      recoveryConflict.value =
        "无法重新读取分类，原输入仍保留。请恢复连接后重试。";
      return;
    }
    const savedEdit = snapshot.values.editing;
    let target: Category | undefined;
    if (savedEdit !== null) {
      if (
        !savedEdit ||
        typeof savedEdit !== "object" ||
        Array.isArray(savedEdit) ||
        typeof savedEdit.name !== "string" ||
        typeof savedEdit.version !== "string"
      ) {
        recoveryConflict.value =
          "此未完成编辑缺少可靠的类别版本信息。原输入仍保留，请复制后重新核对。";
        return;
      }
      target = byName.value.get(savedEdit.name);
      if (!canWrite.value || !target) {
        recoveryConflict.value =
          "原类别已删除或当前账户无权编辑。原输入仍保留，请复制后重新核对。";
        return;
      }
      if (target.version !== savedEdit.version) {
        recoveryConflict.value =
          "原类别已更改。原输入仍保留，请复制后重新核对。";
        return;
      }
    } else if (!canCreate.value) {
      recoveryConflict.value =
        "当前账户无权新建类别。原输入仍保留，请复制后重新核对。";
      return;
    }
    recoveryConflict.value = "";
    editing.value = target;
    tabId = snapshot.tabId;
    editorId = snapshot.editorId;
    revision = snapshot.revision;
    form.value = {
      label: String(value.label || ""),
      parent: String(value.parent || ""),
      is_group: value.is_group === true,
    };
    baseline.value = target
      ? {
          label: target.label,
          parent: target.parent,
          is_group: target.is_group,
        }
      : emptyDraft();
    dialog.value = true;
    retain();
  }
  async function save() {
    if (
      saving.value ||
      !active() ||
      !(editing.value ? canWrite.value : canCreate.value)
    )
      return;
    const label = form.value.label.trim();
    if (!label) {
      error.value = "请填写分类名称";
      return;
    }
    if (
      form.value.parent &&
      !categories.value.some(
        (row) => row.name === form.value.parent && row.is_group,
      )
    ) {
      error.value = "请选择可用的上级分组";
      return;
    }
    saving.value = true;
    error.value = "";
    success.value = "";
    const current = generation;
    const edited = editing.value;
    try {
      const result = edited
        ? await services.call<Category>("catalog.save_category", {
            name: edited.name,
            version: edited.version,
            data: { ...form.value, label },
          })
        : await services.call<Category>("catalog.create_category", {
            label,
            parent: form.value.parent || null,
            is_group: form.value.is_group,
          });
      if (!active(current)) return;
      if (edited && edited.name !== result.name)
        window.dispatchEvent(
          new CustomEvent("inventory-category-renamed", {
            detail: { oldName: edited.name, category: result },
          }),
        );
      if (!edited) expanded.value.add(result.name);
      success.value = edited ? "类别已保存" : "类别已创建";
      showToast(success.value);
      clearEditor();
      await refresh();
    } catch (reason) {
      if (active(current)) {
        error.value =
          reason instanceof Error
            ? reason.message
            : "类别保存失败，请保留输入后重试";
        showToast(`分类保存失败：${error.value}`, "danger");
      }
    } finally {
      if (active(current)) saving.value = false;
    }
  }
  function askDelete(row: Category) {
    if (!canDelete.value) return;
    removeTarget.value = row;
    error.value = "";
  }
  async function remove() {
    const target = removeTarget.value;
    if (!target || deleting.value || !canDelete.value || !active()) return;
    deleting.value = true;
    error.value = "";
    const current = generation;
    try {
      await services.call("catalog.delete_category", {
        name: target.name,
        version: target.version,
      });
      if (!active(current)) return;
      removeTarget.value = undefined;
      success.value = "类别已删除";
      await refresh();
      showToast("分类已删除");
    } catch (reason) {
      if (active(current)) {
        error.value = reason instanceof Error ? reason.message : "类别无法删除";
        showToast(`分类删除失败：${error.value}`, "danger");
      }
    } finally {
      if (active(current)) deleting.value = false;
    }
  }
  function toggle(row: Category) {
    const next = new Set(expanded.value);
    if (next.has(row.name)) next.delete(row.name);
    else next.add(row.name);
    expanded.value = next;
  }
  function requestLeave(): Promise<boolean> {
    if (allowLeave || !dirty.value) return Promise.resolve(true);
    leaveRequested.value = true;
    return new Promise((resolve) => (leaveResolve = resolve));
  }
  function finishLeave(choice: "stay" | "retain" | "discard") {
    if (choice === "retain") retain();
    if (choice === "discard") clearEditor();
    allowLeave = choice !== "stay";
    leaveRequested.value = false;
    leaveResolve?.(allowLeave);
    leaveResolve = undefined;
  }
  function finishDiscard(discard: boolean) {
    if (discard) clearEditor();
    else discardOpen.value = false;
  }
  watch(
    () => [reference.user, reference.site],
    ([user, nextSite]) => {
      if (initialized && user === account && nextSite === site) return;
      initialized = true;
      if (dirty.value) retain();
      account = String(user || "");
      site = String(nextSite || "");
      generation++;
      request?.abort();
      loading.value = false;
      removeTarget.value = undefined;
      dialog.value = false;
      discardOpen.value = false;
      leaveRequested.value = false;
      recoveryConflict.value = "";
      form.value = emptyDraft();
      baseline.value = emptyDraft();
      editorId = crypto.randomUUID();
      tabId = crypto.randomUUID();
      revision = 0;
      createRecovery();
      if (account) void refresh();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (dirty.value) retain();
    disposed = true;
    stopCategoryRename();
    generation++;
    request?.abort();
  });
  useUpdateBlocker(() => dirty.value || saving.value || deleting.value);
  return {
    reference,
    categories,
    children,
    matching,
    byName,
    search,
    expanded,
    dialog,
    saving,
    deleting,
    loading,
    initialized: initializedState,
    refreshError,
    error,
    success,
    removeTarget,
    editing,
    form,
    canCreate,
    canWrite,
    canDelete,
    dirty,
    discardOpen,
    leaveRequested,
    recoveryError,
    recoveryConflict,
    requestLeave,
    finishLeave,
    finishDiscard,
    parentExclusions,
    depth,
    visible,
    toggle,
    openCreate,
    openEdit,
    closeEditor,
    recover,
    save,
    askDelete,
    remove,
    refresh,
  };
}
