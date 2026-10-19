import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  type InventoryServices,
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { newReportQuery } from "../../lib/reportContract";
import type { NativeDocument } from "../documents/nativeEditor";
import { useAttachments } from "../attachments/useAttachments";
import { useMovementHistory } from "../movements/useMovementHistory";
import { useBrowseState } from "../../lib/browseMemory";

export interface LoanOutcomes {
  Returned: number;
  Damaged: number;
  Lost: number;
}
export interface LoanAllocation {
  batch_no: string;
  borrowed_qty: number;
  outstanding_qty: number;
  outcomes: LoanOutcomes;
}
export interface LoanLine extends Record<string, unknown> {
  name: string;
  item_code: string;
  item_name: string;
  stock_uom: string;
  uom: string;
  qty: number;
  conversion_factor: number;
  transfer_qty: number;
  s_warehouse: string;
  t_warehouse: string;
  outstanding_qty: number;
  outcomes: LoanOutcomes;
  allocations: LoanAllocation[];
}
export interface LoanDocument extends NativeDocument {
  items: LoanLine[];
  posting_date: string;
  posting_time: string;
  ti_borrower: string;
  ti_activity: string;
  activity_title: string;
  balance_at: string;
}
export type SettlementAction = "returned" | "damaged" | "lost";

export async function loadLoanDocument(
  services: InventoryServices,
  name: string,
  signal?: AbortSignal,
) {
  const value = await services.call<LoanDocument>(
    "native_api.loan_detail",
    { name },
    signal,
  );
  if (value.name !== name || value.kind !== "Loan")
    throw new Error("此记录不是指定的原借出记录");
  return value;
}

export function useLoanDetail(props: { name: string }) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const loan = ref<LoanDocument>(),
    loading = ref(false),
    error = ref("");
  let generation = 0,
    disposed = false,
    request: AbortController | undefined;
  const active = () => !disposed && reference.user === account;
  const files = useAttachments({
    account,
    currentAccount: () => reference.user,
    parent: () =>
      loan.value
        ? { doctype: "Stock Entry", name: loan.value.name }
        : undefined,
    writable: () => false,
  });
  function query() {
    const value = newReportQuery("loans");
    value.loan = props.name;
    value.statuses = [0, 1, 2];
    return value;
  }
  const exportQuery = computed(query);
  const historyQuery = computed(() => ({
    ...query(),
    scope: { ...query().scope, kinds: ["Return", "Damage", "Loss"] },
    statuses: [1],
    sortBy: "date" as const,
    sort: "desc" as const,
  }));
  const history = useMovementHistory(historyQuery, {
    enabled: () => loan.value?.name === props.name && active(),
  });
  useBrowseState(
    "loan-detail",
    () => props.name,
    () => ({}),
    () => undefined,
    () => !loading.value && !history.result.loading,
  );
  const hasOutstanding = computed(
    () =>
      loan.value?.docstatus === 1 &&
      loan.value.items.some((line) => line.outstanding_qty > 0),
  );
  const status = computed(() =>
    loan.value?.docstatus === 0
      ? "草稿"
      : loan.value?.docstatus === 2
        ? "已取消"
        : hasOutstanding.value
          ? "未结清"
          : "已结清",
  );
  function canSettle(action: SettlementAction) {
    return (
      active() &&
      !loading.value &&
      !error.value &&
      hasOutstanding.value &&
      reference.operations[action === "lost" ? "Loss" : "Return"] === true
    );
  }
  const metrics = computed(() =>
    [
      [
        "borrowed",
        loan.value?.docstatus === 0 ? "计划借出" : "借出",
        undefined,
      ],
      ["outstanding", "未结清", "warning"],
      ["Returned", "完好归还", "success"],
      ["Damaged", "损坏归还", "danger"],
      ["Lost", "遗失", "danger"],
    ].map(([key, label, tone]) => {
      const totals = new Map<string, number>();
      for (const line of loan.value?.items || []) {
        const quantity =
          key === "borrowed"
            ? line.transfer_qty
            : key === "outstanding"
              ? line.outstanding_qty
              : line.outcomes[key as keyof LoanOutcomes];
        totals.set(
          line.stock_uom,
          (totals.get(line.stock_uom) || 0) + Number(quantity || 0),
        );
      }
      return {
        key: key!,
        label: label!,
        tone,
        quantities: [...totals].map(([uom, qty]) => ({ uom, qty })),
      };
    }),
  );
  async function loadFiles(current = generation) {
    if (active() && current === generation) await files.fetch();
  }
  async function load() {
    const current = ++generation;
    request?.abort();
    request = new AbortController();
    if (loan.value?.name !== props.name) {
      loan.value = undefined;
      files.clear();
    }
    files.error.value = "";
    loading.value = true;
    error.value = "";
    try {
      const value = await loadLoanDocument(
        services,
        props.name,
        request.signal,
      );
      if (!active() || current !== generation) return;
      loan.value = value;
      void loadFiles(current);
    } catch (reason) {
      if (active() && current === generation)
        error.value =
          reason instanceof Error ? reason.message : "借出记录不存在或无权访问";
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  watch(
    () => props.name,
    () => void load(),
    { immediate: true },
  );
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    request?.abort();
  });
  return {
    loan,
    loading,
    error,
    files,
    load,
    loadFiles,
    exportQuery,
    historyQuery,
    history,
    hasOutstanding,
    status,
    canSettle,
    metrics,
  };
}
export type LoanDetail = ReturnType<typeof useLoanDetail>;
