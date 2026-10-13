import { reactive } from "vue";
import {
  reviewSession,
  captureSavedDraft,
  type ReviewDraft,
  type ReviewSession,
} from "./reviewModel";
export interface PreviewAttachment {
  id: string;
  name: string;
  type: string;
  url?: string;
  state: "uploading" | "ready" | "error";
}
export const activities = reactive([
  {
    name: "秋季法会",
    type: "活动",
    start: "2026-10-12",
    end: "2026-10-14",
    description: "",
  },
  { name: "日常供餐", type: "日常", start: "", end: "", description: "" },
]);
export function addLoanToDraft(
  draft: ReviewDraft,
  name: string,
  session: ReviewSession = reviewSession,
) {
  const loan = session.loans.find((row) => row.name === name);
  if (!loan) return "借用记录不可用";
  if (
    !loan.lines.some(
      (line) => line.qty > line.returned + line.damaged + line.lost,
    )
  )
    return "此借用没有未结清数量";
  if (
    draft.lines.length &&
    (draft.borrower !== loan.borrower || draft.activity !== loan.activity)
  )
    return "请选择同一借用方和活动；其他借用请另建一笔操作。";
  if (draft.lines.some((line) => (line.loanName || draft.loanName) === name))
    return "此借用已加入";
  draft.loanName ||= name;
  draft.borrower = loan.borrower;
  draft.activity = loan.activity;
  loan.lines.forEach((line, index) => {
    const remaining = line.qty - line.returned - line.damaged - line.lost;
    if (remaining > 0)
      draft.lines.push({
        id: `${name}/${index}`,
        loanName: name,
        loanLineIndex: index,
        code: line.code,
        qty: remaining,
        uom:
          session.stock.find((item) => item.code === line.code)?.uom || "Nos",
        location: line.location || "",
        batch: line.batch,
        returnOutcome: "returned",
      });
  });
  return "";
}
export function countLocationLines(
  location: string,
  session: ReviewSession = reviewSession,
) {
  return session.stock.flatMap((item) =>
    item.locations
      .filter((place) => place.location === location)
      .flatMap((place) =>
        (item.tracksBatch
          ? place.batches || []
          : [{ id: "", available: place.available }]
        ).map((batch) => ({
          id: `${item.code}/${location}/${batch.id}`,
          code: item.code,
          location,
          batch: batch.id,
          uom: item.uom,
          qty: batch.available,
          countedQty: undefined as number | undefined,
          countState: undefined as "counted" | "not_found" | undefined,
          reason: "",
        })),
      ),
  );
}
export function refreshCountBaseline(
  draft: ReviewDraft,
  session: ReviewSession = reviewSession,
) {
  const current = countLocationLines(draft.countLocation || "", session);
  for (const line of draft.lines) {
    const row = current.find(
      (row) => row.code === line.code && row.batch === line.batch,
    );
    line.qty = row?.qty || 0;
  }
  if (draft.countMode === "full") {
    draft.lines.push(
      ...current.filter(
        (row) => !draft.lines.some((line) => line.id === row.id),
      ),
    );
  }
  draft.baselineStale = false;
  draft.baselineReviewed = false;
}
export interface EditSnapshot {
  version: number;
  status: ReviewDraft["status"];
  deleted: boolean;
  document: ReviewDraft;
}
export function externalSnapshot(
  draft: ReviewDraft,
  action: "edit" | "submit" | "cancel" | "delete",
): EditSnapshot {
  const document: ReviewDraft = JSON.parse(JSON.stringify(draft));
  const version = (draft.version || 1) + 1;
  const status =
    action === "submit"
      ? "completed"
      : action === "cancel"
        ? "cancelled"
        : draft.status;
  if (action === "edit") document.note = "ERPNext 更新的备注";
  return { version, status, deleted: action === "delete", document };
}
export function recordIdentity(draft: ReviewDraft) {
  return `${draft.documentType || (draft.kind === "Reconcile" ? "Stock Reconciliation" : "Stock Entry")}/${draft.name}`;
}
export function warehouseEditError(
  name: string,
  parent: string,
  session: ReviewSession = reviewSession,
) {
  if (isSystemWarehouse(name, session)) return "系统节点不能修改";
  const seen = new Set([name]);
  let current = parent;
  while (current) {
    if (seen.has(current)) return "不能移到自身或下级节点";
    seen.add(current);
    current =
      session.warehouses.find((row) => row.name === current)?.parent || "";
  }
  if (
    parent &&
    !session.warehouses.some(
      (row) =>
        row.name === parent &&
        row.is_group &&
        !isSystemWarehouse(row.name, session),
    )
  )
    return "请选择实体仓库下的上级节点";
  return "";
}
export function isSystemWarehouse(
  name: string,
  session: ReviewSession = reviewSession,
) {
  const visited = new Set<string>();
  let current = name;
  while (current && !visited.has(current)) {
    if (["借出", "损坏待处理"].includes(current)) return true;
    visited.add(current);
    current =
      session.warehouses.find((row) => row.name === current)?.parent || "";
  }
  return false;
}
export function physicalLeafWarehouses(session: ReviewSession = reviewSession) {
  return session.warehouses.filter(
    (row) =>
      !row.is_group &&
      row.status === "active" &&
      !isSystemWarehouse(row.name, session),
  );
}

/** Fixture document lifecycle. Only loan projections change; stock remains a snapshot. */
export function cancelPreviewDocument(
  draft: ReviewDraft,
  session: ReviewSession = reviewSession,
) {
  if (draft.status !== "completed") return "只有已提交记录可以取消。";
  if (
    draft.kind === "Loan" &&
    session.movements.some(
      (row) =>
        row.loanName === draft.name &&
        row.name !== draft.name &&
        row.docstatus === 1,
    )
  )
    return "已有归还或遗失记录，请先处理关联记录。";
  if (["Return", "Damage", "Loss"].includes(draft.kind) && draft.loanName) {
    for (const line of draft.lines) {
      const loan = session.loans.find(
        (row) => row.name === (line.loanName || draft.loanName),
      );
      const borrowed =
        loan?.lines[
          line.loanLineIndex ??
            loan.lines.findIndex(
              (row) =>
                row.code === line.code &&
                (row.batch || "") === (line.batch || ""),
            )
        ];
      if (borrowed) {
        const outcome =
          draft.kind === "Loss"
            ? "lost"
            : draft.kind === "Damage"
              ? "damaged"
              : line.returnOutcome || "returned";
        borrowed[outcome] = Math.max(0, borrowed[outcome] - line.qty);
      }
    }
  }
  if (draft.kind === "Loan")
    session.loans.splice(
      0,
      session.loans.length,
      ...session.loans.filter((row) => row.name !== draft.name),
    );
  for (const loan of session.loans)
    loan.status = loan.lines.some(
      (row) => row.qty > row.returned + row.damaged + row.lost,
    )
      ? "outstanding"
      : loan.lines.some((row) => row.lost)
        ? "lost"
        : loan.lines.some((row) => row.damaged)
          ? "damaged"
          : "returned";
  draft.status = "cancelled";
  draft.version = (draft.version || 1) + 1;
  for (const row of session.movements.filter((row) => row.name === draft.name))
    row.docstatus = 2;
  captureSavedDraft(draft);
  return "";
}

/** A future API adapter can use this to ignore responses from superseded searches. */
export function latestOptionSearch<T>(fetch: (query: string) => Promise<T[]>) {
  let generation = 0;
  return async (query: string) => {
    const mine = ++generation;
    const rows = await fetch(query);
    return mine === generation ? rows : undefined;
  };
}
