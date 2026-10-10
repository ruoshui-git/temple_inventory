import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRouter } from "vue-router";
import { api } from "../../lib/api";
import {
  presentWarehouses,
  type PresentedWarehouse,
  type WarehouseRecord,
} from "../../lib/warehousePresenter";
import { toast } from "../../lib/toast";
import type { PageAction } from "../../components/pageActions";

export function useWarehousesController() {
  type CreationKind = "warehouse" | "room" | "location";
  type ParentOption = PresentedWarehouse & {
    pickerLabel: string;
    pickerDepth: number;
  };
  const router = useRouter(),
    boot = ref<any>(),
    loading = ref(true),
    error = ref(""),
    search = ref(""),
    dialog = ref<CreationKind | null>(null),
    saving = ref(false),
    repairing = ref("");
  const quantityTotals = ref<
    Record<string, Array<{ uom: string; qty: number }>>
  >({});
  const summaryLoading = ref(false);
  const summaryMetrics = computed(() => [
    {
      key: "stock_qty",
      label: "现有库存",
      quantities: quantityTotals.value.stock_qty || [],
    },
  ]);
  const form = ref({ parent: "", label: "", parentSearch: "" }),
    expanded = ref(new Set<string>()),
    list = ref<HTMLElement>(),
    dialogElement = ref<HTMLElement>(),
    labelInput = ref<HTMLInputElement>(),
    rowRefs = new Map<string, HTMLElement>();
  let previousFocus: HTMLElement | null = null;
  let summaryTimer: ReturnType<typeof setTimeout> | undefined;
  const rawRows = computed<WarehouseRecord[]>(
    () => boot.value?.physical_tree || boot.value?.warehouse_tree || [],
  );
  const rows = computed(() => presentWarehouses(rawRows.value));
  const filtered = computed(() =>
    rows.value.filter(
      (row) =>
        !search.value.trim() ||
        `${row.name} ${row.localLabel} ${row.breadcrumb}`
          .toLowerCase()
          .includes(search.value.trim().toLowerCase()),
    ),
  );
  const roots = computed(() =>
    filtered.value.filter(
      (row) =>
        !row.parentName ||
        !filtered.value.some((parent) => parent.name === row.parentName),
    ),
  );
  const visibleRows = computed(() => {
    const output: PresentedWarehouse[] = [];
    const visit = (parent: PresentedWarehouse | null, depth = 0) => {
      (parent
        ? filtered.value.filter((row) => row.parentName === parent.name)
        : roots.value
      ).forEach((row) => {
        output.push({
          ...row,
          displayDepth: Math.max(row.displayDepth, depth),
        });
        if (expanded.value.has(row.name)) visit(row, depth + 1);
      });
    };
    visit(null);
    return output;
  });
  const context = computed(
    () =>
      visibleRows.value.find(
        (row) =>
          row.name === String(router.currentRoute.value.query.parent || ""),
      ) || roots.value[0],
  );
  const actions = computed<PageAction[]>(() => {
    if (!boot.value)
      return [
        { kind: "warehouse", label: "新建仓库", disabled: true },
        { kind: "room", label: "添加房间", disabled: true },
        { kind: "location", label: "添加货位", disabled: true },
      ];
    return boot.value.is_manager
      ? [
          { kind: "warehouse", label: "新建仓库" },
          { kind: "room", label: "添加房间" },
          { kind: "location", label: "添加货位" },
        ]
      : [];
  });
  const physicalRoot = computed(() =>
    String(boot.value?.settings?.physical_root_warehouse || ""),
  );
  const parentOptions = computed<ParentOption[]>(() => {
    if (!dialog.value) return [];
    const options = rows.value
      .filter(
        (row) =>
          row.isGroup &&
          (dialog.value === "warehouse" ||
            (dialog.value === "room" && row.semanticType !== "room") ||
            (dialog.value === "location" && row.semanticType === "room")),
      )
      .map((row) => ({
        ...row,
        pickerLabel: row.breadcrumb,
        pickerDepth: row.displayDepth,
      }));
    if (dialog.value === "warehouse" && physicalRoot.value)
      options.unshift({
        name: physicalRoot.value,
        storedLabel: "实体库房",
        localLabel: "实体库房（顶层）",
        breadcrumb: "实体库房（顶层，与第1寺院同级）",
        semanticType: "group",
        fallbackRole: null,
        displayDepth: 0,
        filterValue: physicalRoot.value,
        operationValue: null,
        logicalRoom: null,
        defaultLeaf: null,
        canFilter: true,
        canOperate: false,
        parentName: null,
        isGroup: true,
        raw: { name: physicalRoot.value, is_group: 1 },
        pickerLabel: "实体库房（顶层，与第1寺院同级）",
        pickerDepth: 0,
      });
    return options;
  });
  const matchingParents = computed(() => {
    const term = form.value.parentSearch.trim().toLowerCase();
    return parentOptions.value.filter(
      (row) =>
        !term ||
        `${row.localLabel} ${row.pickerLabel} ${row.name}`
          .toLowerCase()
          .includes(term),
    );
  });
  const selectedParent = computed(() =>
    parentOptions.value.find((row) => row.name === form.value.parent),
  );
  const dialogTitle = computed(() =>
    dialog.value === "warehouse"
      ? "新建仓库"
      : dialog.value === "room"
        ? "添加房间"
        : "添加货位",
  );
  const nameLabel = computed(() =>
    dialog.value === "warehouse"
      ? "仓库名称"
      : dialog.value === "room"
        ? "房间名称"
        : "货位名称",
  );
  function remember(el: Element | null | unknown, name: string) {
    if (el && el instanceof HTMLElement) rowRefs.set(name, el);
  }
  function toggle(row: PresentedWarehouse) {
    const next = new Set(expanded.value);
    next.has(row.name) ? next.delete(row.name) : next.add(row.name);
    expanded.value = next;
  }
  function open(row: PresentedWarehouse) {
    void router.push(`/warehouses/${encodeURIComponent(row.name)}`);
  }
  function defaultParent(kind: CreationKind) {
    if (kind === "warehouse")
      return context.value?.isGroup ? context.value.name : physicalRoot.value;
    if (kind === "location") return context.value?.logicalRoom || "";
    return context.value?.isGroup && context.value.semanticType !== "room"
      ? context.value.name
      : "";
  }
  async function start(kind: string) {
    previousFocus = document.activeElement as HTMLElement;
    dialog.value = kind as CreationKind;
    form.value = {
      parent: defaultParent(kind as CreationKind),
      label: "",
      parentSearch: "",
    };
    await nextTick();
    labelInput.value?.focus();
  }
  function chooseParent(name: string) {
    form.value.parent = name;
    form.value.parentSearch = "";
  }
  function closeDialog() {
    dialog.value = null;
    void nextTick(() => previousFocus?.focus());
  }
  function onDialogKeydown(event: KeyboardEvent) {
    if (!dialog.value) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogElement.value?.querySelectorAll<HTMLElement>(
        "button, input, [href], select, textarea",
      ) || [],
    ).filter((element) => !element.hasAttribute("disabled"));
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? index <= 0
        ? focusable.length - 1
        : index - 1
      : index === focusable.length - 1
        ? 0
        : index + 1;
    event.preventDefault();
    focusable[next].focus();
  }
  async function load() {
    loading.value = true;
    error.value = "";
    try {
      boot.value = await api("warehouse_management_bootstrap");
      rows.value.forEach((row) => expanded.value.add(row.name));
      await loadSummary();
    } catch (cause: any) {
      error.value = cause.message;
    } finally {
      loading.value = false;
    }
  }
  async function loadSummary() {
    if (!boot.value) return;
    summaryLoading.value = true;
    try {
      const data = await api("warehouse_page_summary", {
        warehouses: filtered.value.map((row) => row.name),
      });
      quantityTotals.value = data.quantity_totals || {};
    } catch (cause: any) {
      error.value = cause.message;
      quantityTotals.value = {};
    } finally {
      summaryLoading.value = false;
    }
  }
  watch(search, () => {
    if (summaryTimer) clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => void loadSummary(), 220);
  });
  async function repairMetadata(warehouse: string) {
    if (repairing.value) return;
    repairing.value = warehouse;
    error.value = "";
    try {
      await api("repair_warehouse_metadata", { warehouse });
      toast("仓库显示信息已修复");
      await load();
    } catch (cause: any) {
      error.value = cause.message;
      toast(cause.message, "error");
    } finally {
      repairing.value = "";
    }
  }
  async function save() {
    if (
      saving.value ||
      !form.value.label.trim() ||
      !form.value.parent ||
      !dialog.value
    )
      return;
    saving.value = true;
    const kind = dialog.value;
    try {
      const result = await api(
        kind === "warehouse"
          ? "create_warehouse"
          : kind === "room"
            ? "create_room"
            : "create_location",
        { parent: form.value.parent, label: form.value.label.trim() },
      );
      const parent = form.value.parent;
      closeDialog();
      toast(
        kind === "warehouse"
          ? "仓库已创建"
          : kind === "room"
            ? "房间已添加"
            : "货位已添加",
      );
      await load();
      expanded.value.add(parent);
      await nextTick();
      const created =
        result?.node?.name ||
        result?.logical_room ||
        result?.logical_node ||
        result?.room ||
        result?.name;
      if (created) rowRefs.get(created)?.focus();
    } catch (cause: any) {
      error.value = cause.message;
      toast(cause.message, "error");
    } finally {
      saving.value = false;
    }
  }
  onMounted(() => {
    void load();
    window.addEventListener("beforeunload", () =>
      sessionStorage.setItem(
        "ti-warehouse-scroll",
        String(list.value?.scrollTop || 0),
      ),
    );
    window.addEventListener("keydown", onDialogKeydown);
  });
  onBeforeUnmount(() => {
    if (summaryTimer) clearTimeout(summaryTimer);
    window.removeEventListener("keydown", onDialogKeydown);
  });

  return {
    router,
    boot,
    loading,
    error,
    search,
    dialog,
    saving,
    repairing,
    quantityTotals,
    summaryLoading,
    summaryMetrics,
    form,
    expanded,
    list,
    dialogElement,
    labelInput,
    rowRefs,
    previousFocus,
    summaryTimer,
    rawRows,
    rows,
    filtered,
    roots,
    visibleRows,
    context,
    actions,
    physicalRoot,
    parentOptions,
    matchingParents,
    selectedParent,
    dialogTitle,
    nameLabel,
    remember,
    toggle,
    open,
    defaultParent,
    start,
    chooseParent,
    closeDialog,
    onDialogKeydown,
    load,
    loadSummary,
    repairMetadata,
    save,
  };
}

export type WarehousesController = ReturnType<typeof useWarehousesController>;
