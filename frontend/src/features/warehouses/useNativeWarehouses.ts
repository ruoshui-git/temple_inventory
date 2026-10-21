import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { newReportQuery } from "../../lib/reportContract";
import {
  createRecoveryStore,
  recoveryValues,
  type RecoverySnapshot,
} from "../../lib/browserRecovery";
import { useUpdateBlocker } from "../../lib/updateSafety";
import { useReportController } from "../export/useReportController";
import { useMovementHistory } from "../movements/useMovementHistory";
import { useBrowseState } from "../../lib/browseMemory";
export interface NativeWarehouse {
  name: string;
  label: string;
  parent: string;
  type: string;
  room_default: boolean;
  is_group: boolean;
  disabled: boolean;
  version: string;
  protected: boolean;
  can_edit: boolean;
  lft: number;
  rgt: number;
}
interface WarehouseTree {
  rows: NativeWarehouse[];
  physical_root: string;
  can_create: boolean;
  company: string;
}
export function useNativeWarehouses(
  props: {
    name?: string;
    initialWarehouse?: string;
    initialSearch?: string;
    editName?: string;
    recoveryId?: string;
    active?: boolean;
    initialCreate?: boolean;
  },
  changed: (name: string, search: string) => void,
  saved: () => void = () => undefined,
) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const tree = ref<WarehouseTree>(),
    loading = ref(false),
    error = ref(""),
    selectedName = ref(props.initialWarehouse || ""),
    search = ref(props.initialSearch || "");
  const expanded = ref(new Set<string>()),
    dialogOpen = ref(false),
    busy = ref(false),
    formError = ref("");
  const editing = ref<NativeWarehouse>(),
    baseline = ref(""),
    recoveryError = ref(""),
    candidates = ref<RecoverySnapshot[]>([]),
    leaveOpen = ref(false);
  const form = reactive({
    label: "",
    parent: "",
    warehouse_type: "Room",
    is_group: false,
    disabled: false,
    room_default: false,
  });
  const selected = computed(() =>
    tree.value?.rows.find(
      (row) => row.name === (props.name || selectedName.value),
    ),
  );
  let disposed = false,
    generation = 0,
    request: AbortController | undefined;
  let revision = 0,
    editorId = crypto.randomUUID();
  let openedEditName = "",
    createdEditorOpened = false;
  const tabId = crypto.randomUUID();
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* Keep open input usable. */
  }
  const recovery = createRecoveryStore(reference.site, account, storage);
  const active = () => !disposed && reference.user === account;
  const dirty = computed(
    () => dialogOpen.value && JSON.stringify(form) !== baseline.value,
  );
  const canUseSelection = computed(
    () => active() && !loading.value && !error.value && !!selected.value,
  );
  const physicalSelection = computed(
    () =>
      canUseSelection.value &&
      !selected.value?.is_group &&
      !selected.value?.disabled &&
      reference.physicalLeaves.includes(selected.value!.name),
  );
  const operationActions = computed(() =>
    physicalSelection.value
      ? [
          { kind: "Receive", label: "入库到此库位" },
          { kind: "Issue", label: "从此库位出库" },
          { kind: "Transfer", label: "从此库位调拨" },
        ].filter((action) => reference.operations[action.kind] === true)
      : [],
  );
  const canCount = computed(
    () =>
      physicalSelection.value &&
      reference.capabilities["Stock Reconciliation"]?.create === true,
  );
  const stockQuery = computed(() => {
    const query = newReportQuery("inventory");
    query.view = "locations";
    query.sortBy = "item_name";
    query.scope.warehouses = selected.value ? [selected.value.name] : [];
    return query;
  });
  const historyQuery = computed(() => {
    const query = newReportQuery("movements");
    query.view = "records";
    query.sortBy = "date";
    query.sort = "desc";
    query.statuses = [1];
    query.scope.warehouses = selected.value ? [selected.value.name] : [];
    return query;
  });
  const enabled = computed(
    () => canUseSelection.value && props.active !== false,
  );
  const stock = useReportController(stockQuery, {
    personalViews: false,
    enabled,
  });
  const history = useMovementHistory(historyQuery, {
    warehouse: () => props.name || "",
    enabled: () => enabled.value && !!props.name,
  });
  const browseState = useBrowseState(
    "warehouses",
    () => props.name || "tree",
    () => ({
      expanded: [...expanded.value],
      selectedName: selectedName.value,
      search: search.value,
    }),
    (value) => {
      expanded.value = new Set((value.expanded || []) as string[]);
      selectedName.value = String(value.selectedName || "");
      search.value = String(value.search || "");
    },
    () =>
      !loading.value &&
      !stock.result.loading &&
      !history.result.loading &&
      !!stock.mainTable.value?.initialized,
  );
  const parentOptions = computed(() =>
    (tree.value?.rows || [])
      .filter(
        (row) =>
          row.is_group &&
          !row.disabled &&
          (row.name === tree.value?.physical_root ||
            inside(
              row,
              tree.value?.rows.find(
                (value) => value.name === tree.value?.physical_root,
              ),
            )) &&
          (!editing.value ||
            (row.name !== editing.value.name && !inside(row, editing.value))),
      )
      .map((row) => ({ value: row.name, label: row.label, detail: row.name })),
  );
  function inside(row: NativeWarehouse, root?: NativeWarehouse) {
    return !!root && row.lft > root.lft && row.rgt < root.rgt;
  }
  const visibleRows = computed(() => {
    const rows = tree.value?.rows || [],
      term = search.value.trim().toLowerCase();
    return rows
      .filter((row) => {
        const ancestors = rows.filter((parent) => inside(row, parent));
        if (term)
          return `${row.label} ${row.name} ${row.type} ${ancestors.map((parent) => parent.label).join(" ")}`
            .toLowerCase()
            .includes(term);
        return ancestors.every((parent) => expanded.value.has(parent.name));
      })
      .map((row) => ({
        ...row,
        depth: rows.filter((parent) => inside(row, parent)).length,
      }));
  });
  function retain() {
    if (!active() || !dirty.value) return true;
    const result = recovery.save({
      schema: 1,
      site: reference.site,
      account,
      tabId,
      editorId,
      editorKind: "Warehouse",
      baseVersion: editing.value?.version,
      revision,
      updatedAt: new Date().toISOString(),
      values: recoveryValues({
        ...form,
        editingWarehouse: editing.value?.name || "",
      }),
      pendingUploadReselection: false,
    });
    recoveryError.value = result.error;
    return result.durable;
  }
  watch(
    form,
    () => {
      if (dirty.value) {
        revision++;
        retain();
      }
    },
    { deep: true },
  );
  function openEditor(row?: NativeWarehouse) {
    if (!active() || (row ? !row.can_edit : !tree.value?.can_create)) return;
    dialogOpen.value = false;
    editing.value = row;
    formError.value = "";
    recoveryError.value = "";
    editorId = crypto.randomUUID();
    revision = 0;
    Object.assign(form, {
      label: row?.label || "",
      parent:
        row?.parent ||
        (selected.value?.is_group &&
        parentOptions.value.some(
          (parent) => parent.value === selected.value?.name,
        )
          ? selected.value.name
          : tree.value?.physical_root || ""),
      warehouse_type: row?.type || "Room",
      is_group: row?.is_group || false,
      disabled: row?.disabled || false,
      room_default: row?.room_default || false,
    });
    baseline.value = JSON.stringify(form);
    dialogOpen.value = true;
  }
  async function load() {
    request?.abort();
    const current = ++generation,
      controller = new AbortController();
    request = controller;
    loading.value = true;
    error.value = "";
    try {
      const value = await services.call<WarehouseTree>(
        "warehouses.tree",
        {},
        controller.signal,
      );
      if (!active() || current !== generation) return;
      tree.value = value;
      if (!selectedName.value && !props.name)
        selectedName.value = value.physical_root;
      if ((props.name || selectedName.value) && !selected.value)
        throw new Error("此仓库不存在或当前账户无权读取，请返回仓库列表");
      if (!expanded.value.size && !browseState.restored)
        expanded.value = new Set(
          value.rows.filter((row) => row.is_group).map((row) => row.name),
        );
      const local = recovery.list();
      recoveryError.value = local.error;
      candidates.value = local.entries.filter(
        (row) =>
          row.editorKind === "Warehouse" &&
          (!props.recoveryId || row.editorId === props.recoveryId),
      );
      if (
        props.editName &&
        openedEditName !== props.editName &&
        !dialogOpen.value &&
        !props.recoveryId
      ) {
        const target = value.rows.find((row) => row.name === props.editName);
        if (!target?.can_edit) throw new Error("此仓库不可编辑");
        openEditor(target);
        openedEditName = props.editName;
      }
      if (props.initialCreate && !createdEditorOpened && !props.recoveryId) {
        createdEditorOpened = true;
        openEditor();
      }
    } catch (reason) {
      if (active() && current === generation)
        error.value =
          reason instanceof Error ? reason.message : "仓库资料读取失败";
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  async function save() {
    if (!active() || busy.value || !dialogOpen.value) return;
    if (
      !form.label.trim() ||
      !form.parent ||
      !["Room", "Location"].includes(form.warehouse_type)
    ) {
      formError.value = "请填写名称，并选择上级与 Room / Location 类型";
      return;
    }
    const sent = { ...form },
      sentRevision = revision;
    busy.value = true;
    formError.value = "";
    try {
      const row = await services.call<NativeWarehouse>(
        "warehouses.save_warehouse",
        {
          ...sent,
          ...(editing.value
            ? { name: editing.value.name, version: editing.value.version }
            : {}),
        },
      );
      if (!active()) return;
      editing.value = row;
      baseline.value = JSON.stringify(sent);
      recovery.remove(editorId, sentRevision);
      if (!dirty.value) dialogOpen.value = false;
      else retain();
      await load();
      if (active()) saved();
    } catch (reason) {
      if (active())
        formError.value =
          reason instanceof Error ? reason.message : "仓库保存失败，输入仍保留";
    } finally {
      if (active()) busy.value = false;
    }
  }
  async function recover(entry: RecoverySnapshot) {
    if (!active() || entry.account !== account || entry.site !== reference.site)
      return;
    if (
      ["label", "parent", "warehouse_type"].some(
        (key) => typeof entry.values[key] !== "string",
      ) ||
      ["is_group", "disabled", "room_default"].some(
        (key) => typeof entry.values[key] !== "boolean",
      )
    ) {
      recoveryError.value = "此输入的格式无效，请复制文字后重新填写";
      return;
    }
    await load();
    if (!active() || error.value) return;
    const name = String(entry.values.editingWarehouse || ""),
      row = tree.value?.rows.find((value) => value.name === name);
    if (name && (!row?.can_edit || row.version !== entry.baseVersion)) {
      recoveryError.value = "原仓库已更改、删除或无权编辑，请复制输入后核对";
      return;
    }
    openEditor(row);
    if (!dialogOpen.value) return;
    for (const key of Object.keys(form))
      if (key in entry.values)
        Object.assign(form, { [key]: entry.values[key] });
    candidates.value = [];
    retain();
  }
  let leaveResolve: ((value: boolean) => void) | undefined;
  function requestLeave(): Promise<boolean> {
    if (busy.value) {
      formError.value = "正在保存仓库，请稍候";
      return Promise.resolve(false);
    }
    if (!dirty.value) return Promise.resolve(true);
    leaveOpen.value = true;
    return new Promise((resolve) => (leaveResolve = resolve));
  }
  function finishLeave(choice: "stay" | "retain" | "discard") {
    if (choice === "retain" && !retain()) return;
    if (choice === "discard") recovery.remove(editorId, revision);
    leaveOpen.value = false;
    if (choice !== "stay") dialogOpen.value = false;
    leaveResolve?.(choice !== "stay");
    leaveResolve = undefined;
  }
  async function close() {
    if (await requestLeave()) dialogOpen.value = false;
  }
  function select(name: string) {
    if (tree.value?.rows.some((row) => row.name === name))
      selectedName.value = name;
  }
  watch([selectedName, search], () => {
    if (active()) changed(selectedName.value, search.value);
  });
  watch(
    () => [props.name, props.initialWarehouse, props.initialSearch],
    () => {
      selectedName.value =
        props.name || props.initialWarehouse || tree.value?.physical_root || "";
      search.value = props.initialSearch || "";
    },
  );
  watch(
    () => reference.user,
    () => {
      if (!active()) {
        generation++;
        request?.abort();
        tree.value = undefined;
        candidates.value = [];
        dialogOpen.value = false;
      }
    },
  );
  function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty.value) {
      retain();
      event.preventDefault();
    }
  }
  function restored() {
    void load();
  }
  if (typeof window !== "undefined")
    window.addEventListener("beforeunload", beforeUnload);
  if (typeof document !== "undefined")
    document.addEventListener("inventory-session-restored", restored);
  useUpdateBlocker(() => dirty.value || busy.value);
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    request?.abort();
    leaveResolve?.(false);
    if (typeof window !== "undefined")
      window.removeEventListener("beforeunload", beforeUnload);
    if (typeof document !== "undefined")
      document.removeEventListener("inventory-session-restored", restored);
  });
  void load();
  return {
    reference,
    tree,
    loading,
    error,
    search,
    selected,
    selectedName,
    visibleRows,
    expanded,
    select,
    stock,
    stockQuery,
    history,
    historyQuery,
    canUseSelection,
    operationActions,
    canCount,
    parentOptions,
    dialogOpen,
    busy,
    formError,
    editing,
    form,
    dirty,
    recoveryError,
    candidates,
    recover,
    leaveOpen,
    requestLeave,
    finishLeave,
    close,
    openEditor,
    save,
    load,
  };
}
export type NativeWarehouses = ReturnType<typeof useNativeWarehouses>;
