import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { MovementPeriodKey } from "../../components/MovementPeriodSelector.vue";
import {
  api,
  downloadReport,
  labels,
  type ExportFormat,
  type ReportType,
} from "../../lib/api";
import { warehousePresentation } from "../../lib/warehousePresenter";

export function useReportsController() {
  const route = useRoute();
  const router = useRouter();
  const boot = ref<any>();
  const reportType = ref<ReportType>("movement");
  const busy = ref<ExportFormat | "">("");
  const error = ref("");
  const movementKinds = [
    "Receive",
    "Issue",
    "Transfer",
    "Loan",
    "Return",
    "Damage",
    "Loss",
    "Repair",
    "Disposal",
  ];
  const reportCards: Array<{
    type: ReportType;
    title: string;
    description: string;
    columns: string;
  }> = [
    {
      type: "movement",
      title: "货物流动",
      description: "按时间、动作、类别和位置汇总已完成的库存流动。",
      columns:
        "动作汇总、物品汇总、日期、记录、物品、数量、来源及去向位置和记录人员",
    },
    {
      type: "movement_records",
      title: "货物流动记录",
      description: "导出入库、转移、借用和库存调整等操作记录。",
      columns: "日期、记录编号、类型、状态、物品行数、数量、流向、活动和备注",
    },
    {
      type: "current_stock",
      title: "当前库存",
      description: "导出筛选范围内的物品总量、批次和到期日期。",
      columns:
        "物品编码、名称、类别、可用总量、单位、批次、批次数量、到期日期和位置",
    },
    {
      type: "warehouse_stock",
      title: "仓库库存",
      description: "查看一个仓库节点及其下属实际库存位置。",
      columns: "位置、物品编码、名称、类别、批次、到期日期、数量和单位",
    },
    {
      type: "expiry",
      title: "效期风险",
      description: "按临期或逾期范围导出仍有库存的批次。",
      columns: "批次、物品、类别、到期日期、剩余或逾期天数、位置、数量和单位",
    },
  ];
  const movement = ref({
    search: "",
    period_key: "this_month" as MovementPeriodKey,
    date_from: "",
    date_to: "",
    item_groups: [] as string[],
    warehouses: [] as string[],
    movement_kinds: ["Receive", "Issue", "Transfer"] as string[],
  });
  const stock = ref({
    search: "",
    item_groups: [] as string[],
    warehouses: [] as string[],
  });
  const warehouse = ref({
    search: "",
    item_groups: [] as string[],
    warehouses: [] as string[],
  });
  const expiry = ref({
    search: "",
    item_groups: [] as string[],
    warehouses: [] as string[],
    expiry_window: "",
    expiry_days: "30",
    expiry_from: "",
    expiry_to: "",
  });
  const expiryMode = ref("all");
  const currentCard = computed(() =>
    reportCards.find((card) => card.type === reportType.value)!,
  );
  const warehouseRows = computed(() => boot.value?.physical_tree || []);
  const warehouseOptions = computed(() =>
    warehouseRows.value.map((row: any) => ({
      value: row.name,
      label: warehousePresentation(row.name, warehouseRows.value).breadcrumb,
    })),
  );

  function choose(type: ReportType) {
    reportType.value = type;
    void router.replace({ query: { type } });
  }
  function toggleMovement(kind: string) {
    movement.value.movement_kinds = movement.value.movement_kinds.includes(kind)
      ? movement.value.movement_kinds.filter((value) => value !== kind)
      : [...movement.value.movement_kinds, kind];
  }
  function setWarehouse(value: string) {
    warehouse.value.warehouses = value ? [value] : [];
  }
  function normalizedExpiryDays() {
    if (!/^[1-9]\d*$/.test(expiry.value.expiry_days))
      expiry.value.expiry_days = "30";
  }
  function reportFilters() {
    if (
      reportType.value === "movement" ||
      reportType.value === "movement_records"
    )
      return { ...movement.value };
    if (reportType.value === "current_stock") return { ...stock.value };
    if (reportType.value === "warehouse_stock") return { ...warehouse.value };
    return {
      search: expiry.value.search,
      item_groups: expiry.value.item_groups,
      warehouses: expiry.value.warehouses,
      expiry_window:
        expiryMode.value === "exact"
          ? ""
          : expiryMode.value === "all"
            ? ""
            : expiryMode.value,
      expiry_days: expiry.value.expiry_days,
      expiry_from: expiryMode.value === "exact" ? expiry.value.expiry_from : "",
      expiry_to: expiryMode.value === "exact" ? expiry.value.expiry_to : "",
    };
  }
  async function download(format: ExportFormat) {
    if (busy.value) return;
    if (
      reportType.value === "warehouse_stock" &&
      warehouse.value.warehouses.length !== 1
    ) {
      error.value = "请选择一个仓库或位置";
      return;
    }
    if (
      reportType.value === "expiry" &&
      expiryMode.value === "exact" &&
      (!expiry.value.expiry_from || !expiry.value.expiry_to)
    ) {
      error.value = "请选择完整的开始和结束日期";
      return;
    }
    busy.value = format;
    error.value = "";
    try {
      await downloadReport(reportType.value, format, reportFilters());
    } catch (cause: any) {
      error.value = cause?.message || "导出失败，请重试";
    } finally {
      busy.value = "";
    }
  }

  watch(
    () => route.query.type,
    (value) => {
      if (reportCards.some((card) => card.type === value))
        reportType.value = value as ReportType;
    },
  );
  onMounted(async () => {
    if (reportCards.some((card) => card.type === route.query.type))
      reportType.value = route.query.type as ReportType;
    try {
      boot.value = await api("bootstrap");
    } catch (cause: any) {
      error.value = cause.message;
    }
  });

  return {
    route,
    router,
    boot,
    reportType,
    busy,
    error,
    movementKinds,
    reportCards,
    labels,
    movement,
    stock,
    warehouse,
    expiry,
    expiryMode,
    currentCard,
    warehouseRows,
    warehouseOptions,
    choose,
    toggleMovement,
    setWarehouse,
    normalizedExpiryDays,
    reportFilters,
    download,
  };
}

export type ReportsController = ReturnType<typeof useReportsController>;
