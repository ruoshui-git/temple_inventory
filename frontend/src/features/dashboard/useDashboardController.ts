import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  emptyScope,
  type DatePeriod,
  type BrowseScope,
} from "../../lib/browseQuery";
import {
  newReportQuery,
  type ReportDataset,
  type ReportQuery,
  type ReportRow,
} from "../../lib/reportContract";
import { movementLabels } from "../../lib/filterPresentation";
import { onCategoryRenamed } from "../../lib/categoryRename";
import { useBrowseState } from "../../lib/browseMemory";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";

export const dashboardSections = {
  inventory: "库存概览",
  distribution: "库存分布",
  expiry: "效期概览",
  movement: "货物流动",
  loans: "借出中",
  reminders: "提醒事项",
} as const;
export type DashboardSectionKey = keyof typeof dashboardSections;
export const expiryBuckets = [
  { id: "expired_1_30", label: "已过期 1–30 天" },
  { id: "expired_31_90", label: "已过期 31–90 天" },
  { id: "expired_91_plus", label: "已过期 >90 天" },
  { id: "upcoming_0_30", label: "0–30 天内到期" },
  { id: "upcoming_31_90", label: "31–90 天内到期" },
  { id: "upcoming_91_plus", label: ">90 天后到期" },
];
export interface DashboardRow {
  item_names?: string;
  id?: string;
  doctype?: string;
  document?: string;
  date?: string;
  kind?: string;
  borrower?: string;
  activity_title?: string;
  item_name?: string;
  batch_no?: string;
  expiry_date?: string;
  warehouse?: string;
  warehouse_label?: string;
  available?: number;
  available_effect?: number;
  stock_uom?: string;
  quantities?: { qty: number; uom: string; effect?: number }[];
  label?: string;
  item_count?: number;
}
export interface DashboardResult {
  rows: DashboardRow[];
  expiry_rows: Record<string, DashboardRow[]>;
  kind_counts: Record<string, number>;
  totals: ReportRow[];
  buckets: { id: string; count: number }[];
  snapshot: string;
  query: ReportQuery;
  matched_count: number;
  item_count: number;
  expired_count: number;
  damaged_item_count: number;
}
export interface DashboardSectionState {
  status: "ready" | "loading" | "error" | "retrying";
  hasResult: boolean;
  error: string;
  result: DashboardResult;
}
export function quantityText(rows: { qty: number; uom: string }[]) {
  const units = new Map<string, number>();
  for (const row of rows)
    units.set(row.uom, (units.get(row.uom) || 0) + row.qty);
  return [...units].map(([uom, qty]) => `${qty} ${uom}`).join(" · ") || "0";
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function useDashboardController(navigate: (query: ReportQuery) => void) {
  const services = useInventoryServices(),
    reference = useReferenceData();
  const filters = reactive({
    warehouses: [] as string[],
    categories: [] as string[],
    uncategorized: false,
    distribution: "location",
    expiry: "expired",
    period: { key: "this_month", from: "", to: "" } as DatePeriod,
  });
  const stopCategoryRename = onCategoryRenamed(({ oldName, category }) => {
    if (!filters.categories.includes(oldName)) return;
    filters.categories = [
      ...new Set(
        filters.categories.map((name) =>
          name === oldName ? category.name : name,
        ),
      ),
    ];
  });
  const reportDataset = ref<ReportDataset>("inventory"),
    announcement = ref("");
  const keys = Object.keys(dashboardSections) as DashboardSectionKey[];
  const empty = (): DashboardResult => ({
    rows: [],
    expiry_rows: { expired: [], upcoming: [] },
    kind_counts: {},
    totals: [],
    buckets: [],
    snapshot: "",
    query: newReportQuery(),
    matched_count: 0,
    item_count: 0,
    expired_count: 0,
    damaged_item_count: 0,
  });
  const sections = reactive(
    Object.fromEntries(
      keys.map((key) => [
        key,
        { status: "loading", hasResult: false, error: "", result: empty() },
      ]),
    ) as Record<DashboardSectionKey, DashboardSectionState>,
  );
  const requests = new Map<
    DashboardSectionKey,
    { controller: AbortController; generation: number }
  >();
  useBrowseState(
    "dashboard",
    () => "dashboard",
    () => ({ filters, dataset: reportDataset.value }),
    (value) => {
      if (value.filters) Object.assign(filters, value.filters);
      reportDataset.value = String(
        value.dataset || "inventory",
      ) as ReportDataset;
    },
    () => keys.every((key) => sections[key].status !== "loading"),
  );
  const account = reference.user;
  let disposed = false;
  let sequence = 0;
  const scope = computed<BrowseScope>(() => ({
    ...emptyScope(),
    warehouses: [...filters.warehouses],
    categories: [...filters.categories],
    uncategorized: filters.uncategorized,
  }));
  const quickReportQuery = computed(() => {
    return queryForDataset(reportDataset.value);
  });
  function queryForDataset(dataset: ReportDataset): ReportQuery {
    const value = newReportQuery(dataset);
    value.scope = clone(scope.value);
    if (value.dataset === "movements")
      value.scope.period = clone(filters.period);
    return value;
  }
  async function updateSection(key: DashboardSectionKey, retry = false) {
    requests.get(key)?.controller.abort();
    const request = {
      controller: new AbortController(),
      generation: ++sequence,
    };
    requests.set(key, request);
    const section = sections[key];
    section.status = retry ? "retrying" : "loading";
    section.error = "";
    try {
      const result = await services.call<Partial<DashboardResult>>(
        "browse.dashboard_card",
        {
          card: key,
          scope: clone(scope.value),
          movement_period: clone(filters.period),
          distribution: filters.distribution,
          ...(retry ? { refresh: true } : {}),
        },
        request.controller.signal,
      );
      if (
        disposed ||
        reference.user !== account ||
        requests.get(key) !== request
      )
        return;
      section.result = { ...empty(), ...result };
      section.hasResult = true;
      section.status = "ready";
      announcement.value = `${dashboardSections[key]}已更新`;
    } catch (error) {
      if (
        disposed ||
        reference.user !== account ||
        requests.get(key) !== request
      )
        return;
      section.error = error instanceof Error ? error.message : "暂时无法读取";
      section.status = "error";
    }
  }
  function refresh() {
    return Promise.all(keys.map((key) => updateSection(key)));
  }
  watch(
    () => JSON.stringify(scope.value),
    () => {
      void refresh();
    },
    { immediate: true },
  );
  watch(
    () => JSON.stringify(filters.period),
    () => {
      void updateSection("movement");
    },
  );
  watch(
    () => filters.distribution,
    () => {
      void updateSection("distribution");
    },
  );
  onBeforeUnmount(() => {
    stopCategoryRename();
    disposed = true;
    requests.forEach((request) => request.controller.abort());
    requests.clear();
  });
  const blocked = (key: DashboardSectionKey) =>
    sections[key].status !== "ready";
  function drill(key: DashboardSectionKey, patch: Partial<ReportQuery> = {}) {
    if (blocked(key)) return;
    const value = clone(sections[key].result.query);
    Object.assign(value, patch);
    if (key === "distribution") {
      value.dataset = "inventory";
      value.view = "summary";
    }
    navigate(value);
  }
  function distributionDrill(row: DashboardRow) {
    if (blocked("distribution")) return;
    const value = newReportQuery("inventory");
    value.scope = clone(sections.distribution.result.query.scope);
    if (filters.distribution === "category")
      value.scope.categories = [row.id || ""];
    else value.scope.warehouses = [row.id || ""];
    navigate(value);
  }
  function expiryDrill(id: string) {
    if (blocked("expiry")) return;
    const offset = (days: number) => {
      const date = new Date(`${reference.siteDate}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const bounds: Record<string, [string, string]> = {
      expired_1_30: [offset(-30), offset(-1)],
      expired_31_90: [offset(-90), offset(-31)],
      expired_91_plus: ["1000-01-01", offset(-91)],
      upcoming_0_30: [offset(0), offset(30)],
      upcoming_31_90: [offset(31), offset(90)],
      upcoming_91_plus: [offset(91), "9999-12-31"],
    };
    const dates = bounds[id];
    if (!dates) return;
    const value = clone(sections.expiry.result.query);
    value.scope.period = { key: "custom", from: dates[0], to: dates[1] };
    value.expiryWindow = "period";
    navigate(value);
  }
  const metrics = computed(() =>
    [
      { key: "available", label: "可用库存", tone: "available" },
      { key: "stock_qty", label: "库存总量", tone: "total" },
      { key: "loaned", label: "借出", tone: "loaned" },
      { key: "damaged", label: "损坏", tone: "damaged" },
    ].map((metric) => ({
      ...metric,
      quantities: sections.inventory.result.totals
        .filter((row) => Number(row[metric.key]))
        .map((row) => ({
          uom: String(row.stock_uom || ""),
          qty: Number(row[metric.key]),
        })),
    })),
  );
  const buckets = computed(() =>
    expiryBuckets.map((bucket) => ({
      ...bucket,
      count:
        sections.expiry.result.buckets.find((row) => row.id === bucket.id)
          ?.count || 0,
    })),
  );
  const movementSummary = computed(() =>
    Object.entries(movementLabels).map(([kind, label]) => {
      const totals = sections.movement.result.totals.filter(
        (row) => row.kind === kind,
      );
      // One native record can have several UOM groups; counts cannot be summed across units.
      return {
        kind,
        label,
        count: sections.movement.result.kind_counts[kind] || 0,
        quantities: totals.map((row) => ({
          qty: Number(row.stock_qty || 0),
          uom: String(row.stock_uom || ""),
          effect: Number(row.available_effect || 0),
        })),
        tone:
          totals.length &&
          totals.every((row) => Number(row.available_effect || 0) > 0)
            ? "success"
            : totals.length &&
                totals.every((row) => Number(row.available_effect || 0) < 0)
              ? "danger"
              : "neutral",
      };
    }),
  );
  return {
    reference,
    filters,
    sections,
    keys,
    announcement,
    reportDataset,
    quickReportQuery,
    queryForDataset,
    metrics,
    buckets,
    expiryPreview: computed(
      () => sections.expiry.result.expiry_rows[filters.expiry] || [],
    ),
    movementSummary,
    refresh,
    updateSection,
    blocked,
    drill,
    distributionDrill,
    expiryDrill,
    distribution: computed(() => sections.distribution.result.rows),
    maximum: computed(() =>
      Math.max(
        1,
        ...sections.distribution.result.rows.map((row) => row.item_count || 0),
      ),
    ),
    loading: computed(() =>
      keys.some((key) =>
        ["loading", "retrying"].includes(sections[key].status),
      ),
    ),
    loanQuantity: computed(() =>
      quantityText(
        sections.loans.result.totals.map((row) => ({
          qty: Number(row.outstanding || 0),
          uom: String(row.stock_uom || ""),
        })),
      ),
    ),
  };
}
