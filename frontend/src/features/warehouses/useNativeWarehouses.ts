import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
  type LocationNode,
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
import { kindIcons } from "../../lib/kindIcons";
import { useBrowseState } from "../../lib/browseMemory";
import { showToast } from "../../services/toast";
import { useFormValidation } from "../../composables/useFormValidation";
import { useConfirm } from "../../services/confirm";
export type NativeWarehouse = LocationNode;

/** The location API takes the native Warehouse Type, not the presenter kind. */
const warehouseTypes = { area: "Area", room: "Room", shelf: "Shelf" } as const;
interface WarehouseTree {
  rows: NativeWarehouse[];
  physical_root: string;
  can_create: boolean;
  company: string;
  needs_first_room?: boolean;
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
    action = ref<"create" | "rename" | "move">("create"),
    form = reactive({
      kind: "room" as "area" | "room" | "shelf",
      label: "",
      short_label: "",
      parent: "",
    });
  const baseline = ref(""),
    recoveryError = ref("");
  const selected = computed(() =>
    tree.value?.rows.find(
      (row) => row.name === (props.name || selectedName.value),
    ),
  );
  let disposed = false,
    generation = 0,
    request: AbortController | undefined,
    revision = 0,
    editorId = crypto.randomUUID(),
    openedEditName = "",
    createdEditorOpened = false;
  const tabId = crypto.randomUUID();
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* Keep open input usable. */
  }
  const recovery = createRecoveryStore(reference.site, account, storage),
    active = () => !disposed && reference.user === account;
  const dirty = computed(
    () => dialogOpen.value && JSON.stringify(form) !== baseline.value,
  );
  const validation = useFormValidation();
  validation.register(
    "warehouse-label",
    () => form.label,
    [(v) => (action.value === "move" || v.trim() ? true : "请输入位置名称")],
    () => document.querySelector<HTMLElement>("[data-warehouse-name]")?.focus(),
  );
  validation.register(
    "warehouse-parent",
    () => form.parent,
    [(v) => (action.value === "rename" || v ? true : "请选择上级位置")],
    () =>
      document
        .querySelector<HTMLElement>("[data-warehouse-parent] input")
        ?.focus(),
  );
  const canUseSelection = computed(
    () => active() && !loading.value && !error.value && !!selected.value,
  );
  const physicalSelection = computed(
    () =>
      canUseSelection.value &&
      !!selected.value?.storable &&
      !selected.value.disabled &&
      reference.physicalLeaves.includes(selected.value.name),
  );
  const operationActions = computed(() =>
    physicalSelection.value
      ? [
          {
            kind: "Receive",
            label: "入库到此库位",
            icon: kindIcons.Receive.icon,
          },
          {
            kind: "Issue",
            label: `从此库位${kindIcons.Issue.label}`,
            icon: kindIcons.Issue.icon,
          },
          {
            kind: "Transfer",
            label: `从此库位${kindIcons.Transfer.label}`,
            icon: kindIcons.Transfer.icon,
          },
        ].filter((item) => reference.operations[item.kind] === true)
      : [],
  );
  const canCount = computed(
    () => physicalSelection.value && reference.operations.Reconcile === true,
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
  function inside(row: NativeWarehouse, root?: NativeWarehouse) {
    return !!root && row.lft > root.lft && row.rgt < root.rgt;
  }
  const parentOptions = computed(() => {
    const kind = form.kind;
    return (tree.value?.rows || [])
      .filter((row) => {
        const allowedKind =
          kind === "shelf"
            ? ["room", "shelf"].includes(row.kind)
            : row.name === tree.value?.physical_root || row.kind === "area";
        return (
          allowedKind &&
          row.is_group &&
          !row.disabled &&
          !row.direct &&
          (!editing.value ||
            (row.name !== editing.value.name && !inside(row, editing.value)))
        );
      })
      .map((row) => ({
        value: row.name,
        label: row.label,
        detail: row.path,
        keywords: row.search_text,
      }));
  });
  const visibleRows = computed(() => {
    const rows = tree.value?.rows || [],
      term = search.value.trim().toLocaleLowerCase();
    const matches = term
      ? rows.filter((row) =>
          `${row.search_text} ${row.full_label}`
            .toLocaleLowerCase()
            .includes(term),
        )
      : [];
    return rows
      .filter((row) => !row.direct)
      .filter((row) => {
        const ancestors = rows.filter(
          (parent) => inside(row, parent) && !parent.direct,
        );
        if (term)
          return matches.some(
            (match) => match.name === row.name || inside(match, row),
          );
        return ancestors.every((parent) => expanded.value.has(parent.name));
      })
      .map((row) => ({
        ...row,
        depth: rows.filter((parent) => inside(row, parent) && !parent.direct)
          .length,
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
        action: action.value,
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
  function openEditor(
    row?: NativeWarehouse,
    mode: "create" | "rename" | "move" = row ? "rename" : "create",
    kind?: "area" | "room" | "shelf",
  ) {
    if (
      !active() ||
      (row ? !row.can_edit || row.protected : !tree.value?.can_create)
    )
      return;
    editing.value = row;
    action.value = mode;
    formError.value = "";
    recoveryError.value = "";
    editorId = crypto.randomUUID();
    revision = 0;
    const chosenKind = kind || row?.kind || "room";
    form.kind = chosenKind as "area" | "room" | "shelf";
    const selectedParent = selected.value?.name;
    const defaultParent =
      selectedParent &&
      parentOptions.value.some((option) => option.value === selectedParent)
        ? selectedParent
        : tree.value?.physical_root || "";
    Object.assign(form, {
      kind: chosenKind as "area" | "room" | "shelf",
      label: row?.local_label || "",
      short_label: row?.short_label || "",
      parent: row?.parent || defaultParent,
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
      const [value, configuration] = await Promise.all([
        services.call<WarehouseTree>("warehouses.tree", {}, controller.signal),
        services
          .call<{ needs_first_room?: boolean }>(
            "configuration.status",
            {},
            controller.signal,
          )
          .catch(() => undefined),
      ]);
      if (!active() || current !== generation) return;
      tree.value = value;
      value.needs_first_room = configuration?.needs_first_room;
      if (!selectedName.value && !props.name)
        selectedName.value = value.physical_root;
      if ((props.name || selectedName.value) && !selected.value)
        throw new Error("此位置不存在或当前账户无权读取，请返回仓库列表");
      if (!expanded.value.size && !browseState.restored)
        expanded.value = new Set(
          value.rows
            .filter((row) => row.is_group && !row.direct)
            .map((row) => row.name),
        );
      recoveryError.value = recovery.list().error;
      if (
        props.editName &&
        openedEditName !== props.editName &&
        !dialogOpen.value &&
        !props.recoveryId
      ) {
        const target = value.rows.find((row) => row.name === props.editName);
        if (!target?.can_edit) throw new Error("此位置不可编辑");
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
          reason instanceof Error ? reason.message : "位置资料读取失败";
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  async function invoke(
    endpoint: string,
    args: Record<string, unknown>,
    success: string,
  ) {
    if (!active() || busy.value) return;
    busy.value = true;
    formError.value = "";
    try {
      await services.call(endpoint, args);
      await load();
      if (active()) {
        showToast(success);
        saved();
      }
    } catch (reason) {
      if (active()) {
        formError.value =
          reason instanceof Error ? reason.message : "位置操作失败";
        showToast(formError.value, "danger");
      }
    } finally {
      if (active()) busy.value = false;
    }
  }
  async function save() {
    if (!active() || busy.value || !dialogOpen.value) return;
    formError.value = "";
    if (!validation.validate().ok) return;
    const snapshot = { ...form },
      sentRevision = revision,
      mode = action.value,
      row = editing.value;
    busy.value = true;
    formError.value = "";
    try {
      if (mode === "create")
        await services.call("warehouses.create_location", {
          kind: warehouseTypes[snapshot.kind],
          label: snapshot.label,
          short_label: snapshot.short_label,
          parent: snapshot.parent,
        });
      else if (mode === "rename" && row)
        await services.call("warehouses.rename_location", {
          name: row.name,
          label: snapshot.label,
          short_label: snapshot.short_label,
          version: row.version,
        });
      else if (mode === "move" && row)
        await services.call("warehouses.move_location", {
          name: row.name,
          parent: snapshot.parent,
          version: row.version,
        });
      recovery.remove(editorId, sentRevision);
      await load();
      if (active()) {
        if (mode === "rename" && row && revision > sentRevision) {
          const refreshed = tree.value?.rows.find(
            (value) => value.name === row.name,
          );
          if (!refreshed) throw new Error("位置已更新，但无法重新读取位置资料");
          editing.value = refreshed;
          baseline.value = JSON.stringify({
            ...form,
            label: snapshot.label,
            short_label: snapshot.short_label,
          });
          retain();
          showToast("已保存；保留了保存期间的后续修改");
          return;
        }
        dialogOpen.value = false;
        showToast(
          mode === "create"
            ? "位置已创建"
            : mode === "move"
              ? "位置已移动"
              : "名称已更新",
        );
        saved();
      }
    } catch (reason) {
      if (active()) {
        formError.value =
          reason instanceof Error ? reason.message : "位置保存失败，输入仍保留";
        showToast(formError.value, "danger");
      }
    } finally {
      if (active()) busy.value = false;
    }
  }
  async function recover(entry: RecoverySnapshot) {
    if (!active() || entry.account !== account || entry.site !== reference.site)
      return;
    if (
      ["label", "kind", "parent", "short_label"].some(
        (key) => typeof entry.values[key] !== "string",
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
      recoveryError.value = "原位置已更改、删除或无权编辑，请复制输入后核对";
      return;
    }
    openEditor(
      row,
      String(entry.values.action || "rename") as "create" | "rename" | "move",
    );
    if (!dialogOpen.value) return;
    for (const key of Object.keys(form))
      if (key in entry.values)
        Object.assign(form, { [key]: entry.values[key] });
    retain();
    recovery.remove(entry.editorId, entry.revision);
    showToast("已恢复上次在此浏览器暂存的内容");
  }
  async function requestLeave(): Promise<boolean> {
    if (busy.value) {
      formError.value = "正在保存位置，请稍候";
      return Promise.resolve(false);
    }
    if (!dirty.value) return true;
    const accepted = await useConfirm().confirm({
      title: "离开位置编辑？",
      message: "当前输入将保留在此浏览器，之后可以恢复。",
      confirmLabel: "保留输入并离开",
      cancelLabel: "继续编辑",
    });
    if (accepted) {
      retain();
      dialogOpen.value = false;
    }
    return accepted;
  }
  async function close() {
    if (await requestLeave()) dialogOpen.value = false;
  }
  function select(name: string) {
    if (tree.value?.rows.some((row) => row.name === name && !row.direct))
      selectedName.value = name;
  }
  async function toggleDisabled(row: NativeWarehouse) {
    await invoke(
      "warehouses.set_disabled",
      { name: row.name, disabled: !row.disabled, version: row.version },
      row.disabled ? "位置已启用" : "位置已停用",
    );
  }
  async function subdivide(row: NativeWarehouse) {
    await invoke(
      "warehouses.subdivide_shelf",
      { name: row.name, version: row.version },
      "货位已细分",
    );
  }
  async function repair(row: NativeWarehouse) {
    await invoke(
      "warehouses.repair_direct_storage",
      { name: row.name, version: row.version },
      "直接存放位置已补建",
    );
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
    if (typeof window !== "undefined")
      window.removeEventListener("beforeunload", beforeUnload);
    if (typeof document !== "undefined")
      document.removeEventListener("inventory-session-restored", restored);
  });
  void load().then(async () => {
    if (!props.recoveryId) return;
    const entry = recovery.read(props.recoveryId);
    if (entry?.editorKind === "Warehouse") await recover(entry);
    else recoveryError.value = "未找到这份浏览器暂存内容，请从草稿列表重新打开";
  });
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
    action,
    form,
    validation,
    dirty,
    recoveryError,
    recover,
    requestLeave,
    close,
    openEditor,
    save,
    load,
    toggleDisabled,
    subdivide,
    repair,
  };
}
export type NativeWarehouses = ReturnType<typeof useNativeWarehouses>;
