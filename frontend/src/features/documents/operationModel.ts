import type { InjectionKey } from "vue";
import { inject, provide, reactive } from "vue";
import type { StockItem } from "../../lib/stockPresentation";
import {
  conversionError,
  type QuantityUnit,
} from "../../lib/quantityConversion";
export type OperationKind =
  | "Receive"
  | "Issue"
  | "Transfer"
  | "Loan"
  | "Return"
  | "Damage"
  | "Loss"
  | "Repair"
  | "Disposal";
export interface AllocationLine {
  [field: string]: unknown;
  id: string;
  localId: string;
  name?: string;
  code: string;
  displayName?: string;
  displayImage?: string;
  displayTracksBatch?: boolean;
  displayTracksExpiry?: boolean;
  qty: number;
  uom: string;
  location: string;
  sourceLocation?: string;
  loanName?: string;
  originalLoanLine?: string;
  loanedLocation?: string;
  batch?: string;
  expiry?: string;
  manufacturingDate?: string;
  entryUom?: string;
  entryQty?: number;
  conversionFactor?: number;
  returnOutcome?: "returned" | "damaged" | "lost";
  reason?: string;
  outstanding?: number;
  nativeBundle?: string;
  recordedBundle?: string;
  batchAllocations?: {
    name: string;
    batch: string;
    qty: number;
    expiry?: string;
    manufacturingDate?: string;
  }[];
  /** Exact native child row snapshot used to preserve fields this editor does not know. */
  nativeFields?: Record<string, unknown>;
}

export function operationLocationKind(
  kind: OperationKind,
): "source" | "target" {
  return ["Receive", "Return", "Repair"].includes(kind) ? "target" : "source";
}

export function operationSectionLocation(
  kind: OperationKind,
  line: AllocationLine,
) {
  return operationLocationKind(kind) === "target"
    ? line.location
    : line.sourceLocation || line.location;
}

export interface OperationLocationSection {
  location: string;
  lines: AllocationLine[];
}

/** Groups without changing native row order or identities. */
export function operationSections(
  draft: OperationDraft,
): OperationLocationSection[] {
  const byLocation = new Map<string, AllocationLine[]>();
  for (const line of draft.items) {
    const location = operationSectionLocation(draft.kind, line);
    const rows = byLocation.get(location) || [];
    rows.push(line);
    byLocation.set(location, rows);
  }
  return [...byLocation].map(([location, lines]) => ({ location, lines }));
}

export function moveOperationLine(
  draft: OperationDraft,
  line: AllocationLine,
  location: string,
) {
  if (operationLocationKind(draft.kind) === "target") line.location = location;
  else {
    line.sourceLocation = location;
    if (!["Transfer", "Repair"].includes(draft.kind)) line.location = location;
  }
}

export function moveOperationSection(
  draft: OperationDraft,
  section: OperationLocationSection,
  location: string,
) {
  for (const line of section.lines) moveOperationLine(draft, line, location);
}

/** Compatible ordinary allocations can merge; native bundles and outcome rows stay distinct. */
export function mergeCompatibleOperationLines(draft: OperationDraft) {
  const kept: AllocationLine[] = [];
  const compatible = new Map<string, AllocationLine>();
  const nativeKnownFields = new Set([
    "name",
    "item_code",
    "item_name",
    "qty",
    "uom",
    "stock_uom",
    "transfer_qty",
    "conversion_factor",
    "s_warehouse",
    "t_warehouse",
    "batch_no",
    "serial_and_batch_bundle",
    "recorded_bundle",
    "recorded_batch_allocations",
    "use_serial_batch_fields",
    "ti_original_loan",
    "ti_original_loan_line",
    "ti_settlement_outcome",
    "ti_allocation_note",
    "ti_display_item_name",
    "ti_display_image",
    "ti_display_tracks_batch",
    "ti_display_tracks_expiry",
  ]);
  for (const line of draft.items) {
    if (
      line.nativeBundle ||
      line.recordedBundle ||
      line.batchAllocations?.length ||
      line.loanName ||
      line.returnOutcome
    ) {
      kept.push(line);
      continue;
    }
    const key = JSON.stringify([
      line.code,
      line.sourceLocation || "",
      line.location,
      line.batch || "",
      line.reason || "",
      line.entryUom || line.uom,
      line.conversionFactor || 1,
      Object.fromEntries(
        Object.entries(line.nativeFields || {})
          .filter(([field]) => !nativeKnownFields.has(field))
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    ]);
    const prior = compatible.get(key);
    if (!prior) {
      compatible.set(key, line);
      kept.push(line);
    } else {
      prior.qty += line.qty;
      prior.entryQty = Number(prior.entryQty || 0) + Number(line.entryQty || 0);
    }
  }
  draft.items.splice(0, draft.items.length, ...kept);
}

export function copyOperationLine(line: AllocationLine): AllocationLine {
  return {
    ...line,
    id: crypto.randomUUID(),
    localId: crypto.randomUUID(),
    name: undefined,
    nativeFields: undefined,
    qty: 0,
    entryQty: 0,
    batch: "",
    expiry: "",
    manufacturingDate: "",
    nativeBundle: undefined,
    recordedBundle: undefined,
    batchAllocations: undefined,
  };
}
export interface OperationDraft {
  name: string;
  kind: OperationKind;
  status: "draft" | "completed" | "cancelled";
  postingDate: string;
  postingTime: string;
  timeMode: "current" | "manual";
  activity: string;
  borrower: string;
  note: string;
  source: string;
  purpose: string;
  recorder: string;
  handler: string;
  reviewer: string;
  loanName: string;
  loanDestination: string;
  items: AllocationLine[];
  amendedFrom?: string;
  [field: string]: unknown;
}
export interface OperationIssue {
  message: string;
  lineId?: string;
  field: string;
}
export function isSettlement(draft: OperationDraft) {
  return draft.items.some((line) => !!line.loanName) || draft.kind === "Return";
}
export function allocationDestination(
  draft: OperationDraft,
  line: AllocationLine,
  damagedLeaves: string[],
) {
  if (["Issue", "Loss", "Disposal"].includes(draft.kind)) return "";
  if (draft.kind === "Loan")
    return line.loanedLocation || draft.loanDestination;
  if (
    draft.kind === "Damage" ||
    (draft.kind === "Return" && line.returnOutcome === "damaged")
  )
    return damagedLeaves.includes(line.location)
      ? line.location
      : damagedLeaves[0] || "";
  return line.location;
}
export function lineStock(line: AllocationLine, stock: StockItem[]) {
  return stock
    .find((item) => item.code === line.code)
    ?.locations.find(
      (row) => row.location === (line.sourceLocation || line.location),
    );
}
export function lineCapacity(
  draft: OperationDraft,
  line: AllocationLine,
  stock: StockItem[],
) {
  if (line.loanName) return line.outstanding ?? 0;
  const place = lineStock(line, stock),
    item = stock.find((item) => item.code === line.code);
  const damaged = ["Repair", "Disposal"].includes(draft.kind);
  return item?.tracksBatch
    ? place?.batches?.find((batch) => batch.id === line.batch)?.[
        damaged ? "damaged" : "available"
      ] || 0
    : place?.[damaged ? "damaged" : "available"] || 0;
}
export function operationIssues(
  draft: OperationDraft,
  context: {
    stock: StockItem[];
    units: QuantityUnit[];
    physicalLeaves: string[];
    leasedLeaves: string[];
    damagedLeaves: string[];
  },
): OperationIssue[] {
  const issues: OperationIssue[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.postingDate))
    issues.push({ message: "请选择有效操作日期", field: "postingDate" });
  if (
    draft.timeMode === "manual" &&
    !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(draft.postingTime)
  )
    issues.push({ message: "请填写有效操作时间", field: "postingTime" });
  if (!draft.items.length)
    issues.push({ message: "请先添加至少一项物品", field: "items" });
  if (draft.kind === "Loan" && !draft.borrower.trim())
    issues.push({ message: "请填写借用方", field: "borrower" });
  if (
    draft.kind === "Loan" &&
    draft.items.some(
      (line) =>
        !context.leasedLeaves.includes(
          line.loanedLocation || draft.loanDestination,
        ),
    )
  )
    issues.push({ message: "请选择借出存放位置", field: "loanDestination" });
  const requested = new Map<string, number>();
  for (const line of draft.items) {
    const add = (field: string, message: string) =>
      issues.push({ lineId: line.id, field, message });
    const item = context.stock.find((item) => item.code === line.code);
    if (!item) {
      add("code", "物品不存在或无权访问，请重新选择");
      continue;
    }
    const invalid = conversionError(
      line.entryQty ?? NaN,
      line.entryUom || "",
      line.conversionFactor ?? NaN,
      line.uom,
      context.units,
    );
    if (invalid) add("qty", invalid);
    const source = line.sourceLocation || line.location;
    const sourceSet = line.loanName
      ? context.leasedLeaves
      : ["Repair", "Disposal"].includes(draft.kind)
        ? context.damagedLeaves
        : context.physicalLeaves;
    if (draft.kind !== "Receive" && !sourceSet.includes(source))
      add("sourceLocation", "请选择有效的来源末级库位");
    if (
      ["Receive", "Transfer", "Repair"].includes(draft.kind) ||
      (draft.kind === "Return" && line.returnOutcome === "returned")
    ) {
      if (!context.physicalLeaves.includes(line.location))
        add("location", "请选择有效的实体末级目标库位");
      if (draft.kind !== "Receive" && source === line.location)
        add("location", "来源和目标库位不能相同");
    }
    if (draft.kind === "Return" && (!line.loanName || !line.originalLoanLine))
      add("loanName", "请选择确切的原借出记录与明细");
    if (line.loanName && !line.originalLoanLine)
      add("loanName", "原借出明细不可用，请重新载入借用");
    if (
      item.tracksBatch &&
      draft.kind !== "Receive" &&
      !line.batch &&
      !line.nativeBundle
    )
      add("batch", "请选择批次");
    if (
      draft.kind === "Receive" &&
      item.tracksExpiry &&
      !line.expiry &&
      !line.nativeBundle
    )
      add("expiry", "请填写到期日期");
    if (line.manufacturingDate && line.manufacturingDate > draft.postingDate)
      add("manufacturingDate", "生产日期不能晚于操作日期");
    if (
      line.manufacturingDate &&
      line.expiry &&
      line.expiry < line.manufacturingDate
    )
      add("expiry", "到期日期不能早于生产日期");
    if (draft.kind !== "Receive") {
      const key = JSON.stringify(
        line.loanName
          ? [line.loanName, line.originalLoanLine, line.batch]
          : [line.code, source, line.batch],
      );
      const quantity = (requested.get(key) || 0) + line.qty;
      requested.set(key, quantity);
      if (quantity > lineCapacity(draft, line, context.stock) + 1e-8)
        add("qty", "合计数量超过此来源或原借出批次的可处理数量，请刷新后核对");
    }
  }
  return issues;
}
export interface OperationContext {
  stock: StockItem[];
  remember(item: StockItem): void;
  ensure(code: string): Promise<StockItem>;
  ensureMany(codes: string[]): Promise<Map<string, StockItem>>;
  timestamp(): string | undefined;
  issues(draft: OperationDraft): OperationIssue[];
  lineStock(line: AllocationLine): ReturnType<typeof lineStock>;
  lineCapacity(draft: OperationDraft, line: AllocationLine): number;
}
const key: InjectionKey<OperationContext> = Symbol("native-operation-context");
export const provideOperationContext = (context: OperationContext) =>
  provide(key, context);
export function useOperationContext() {
  const context = inject(key);
  if (!context) throw new Error("未加载操作物品资料");
  return context;
}
