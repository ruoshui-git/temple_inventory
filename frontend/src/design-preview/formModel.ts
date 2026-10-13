import {
  reviewSession,
  matchesLoanLine,
  type DraftLine,
  type ReviewDraft,
  type ReviewSession,
} from "./reviewModel";

export function isSettlement(draft: ReviewDraft) {
  return !!draft.loanName && ["Return", "Damage", "Loss"].includes(draft.kind);
}

export function lineStock(
  line: DraftLine,
  session: ReviewSession = reviewSession,
) {
  return session.stock
    .find((item) => item.code === line.code)
    ?.locations.find(
      (row) => row.location === (line.sourceLocation || line.location),
    );
}

export function lineCapacity(
  draft: ReviewDraft,
  line: DraftLine,
  session: ReviewSession = reviewSession,
) {
  if (isSettlement(draft)) {
    return (
      session.loans
        .find((loan) => loan.name === draft.loanName)
        ?.lines.filter((row, index) => matchesLoanLine(line, row, index))
        .reduce(
          (sum, row) =>
            sum + Math.max(0, row.qty - row.returned - row.damaged - row.lost),
          0,
        ) || 0
    );
  }
  const stock = lineStock(line, session);
  const item = session.stock.find((item) => item.code === line.code);
  if (["Repair", "Disposal"].includes(draft.kind))
    return item?.tracksBatch
      ? stock?.batches?.find((batch) => batch.id === line.batch)?.damaged || 0
      : stock?.damaged || 0;
  return item?.tracksBatch
    ? stock?.batches?.find((batch) => batch.id === line.batch)?.available || 0
    : stock?.available || 0;
}

export function validateOperation(
  draft: ReviewDraft,
  session: ReviewSession = reviewSession,
): string {
  if (!draft.postingDate || Number.isNaN(Date.parse(draft.postingDate)))
    return "请选择操作日期。";
  if (!draft.lines.length) return "请先添加至少一项物品。";
  if (draft.kind === "Loan" && !draft.borrower.trim())
    return "请填写借用人或团体。";
  if (draft.kind === "Return" && !draft.loanName) return "请选择关联借用记录。";
  const requested = new Map<string, number>();
  const settlementByItem = new Map<string, number>();
  const counted = new Set<string>();
  const placeExists = (name?: string) =>
    session.warehouses.some(
      (row) => row.name === name && !row.is_group && row.status === "active",
    );
  for (const line of draft.lines) {
    const item = session.stock.find((item) => item.code === line.code);
    if (!item) return "请选择有效物品。";
    const label = item.name;
    if (!placeExists(line.location)) return `${label}：请选择有效库位。`;
    if (draft.kind === "Reconcile") {
      const key = `${line.code}/${line.location}/${line.batch || ""}`;
      if (counted.has(key)) return `${label}：同一库位与批次只能盘点一次。`;
      counted.add(key);
      if (
        line.countedQty === undefined ||
        line.countedQty === null ||
        String(line.countedQty) === "" ||
        !Number.isFinite(Number(line.countedQty)) ||
        Number(line.countedQty) < 0
      )
        return `${label}：请填写非负实点数量。`;
      if (Number(line.countedQty) !== Number(line.qty) && !line.reason?.trim())
        return `${label}：请填写差异原因。`;
    } else if (!Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0)
      return `${label}：数量必须大于 0。`;
    const quantity =
      draft.kind === "Reconcile" ? Number(line.countedQty) : Number(line.qty);
    if (
      session.units.find((unit) => unit.name === item.uom)?.whole &&
      !Number.isInteger(quantity)
    )
      return `${label}：${item.uom}只允许整数数量。`;
    if (
      item.tracksBatch &&
      !line.batch?.trim() &&
      draft.kind !== "Receive" &&
      !isSettlement(draft)
    )
      return `${label}：请填写或选择批次编号。`;
    if (
      line.entryUom &&
      line.entryUom !== item.uom &&
      !item.alternateUnits?.some(
        (unit) => unit.uom === line.entryUom && unit.factor > 0,
      )
    )
      return `${label}：请选择支持的换算单位。`;
    if (draft.kind === "Receive") {
      if (
        line.manufacturingDate &&
        (Number.isNaN(Date.parse(line.manufacturingDate)) ||
          (line.expiry && line.manufacturingDate > line.expiry))
      )
        return `${label}：生产日期不能晚于到期日期。`;

      if (
        item.tracksExpiry &&
        (!line.expiry || Number.isNaN(Date.parse(line.expiry)))
      )
        return `${label}：请填写到期日期。`;
      continue;
    }
    if (isSettlement(draft)) {
      settlementByItem.set(
        line.code,
        (settlementByItem.get(line.code) || 0) + Number(line.qty),
      );
      const outstanding =
        session.loans
          .find((loan) => loan.name === draft.loanName)
          ?.lines.filter((row) => row.code === line.code)
          .reduce(
            (sum, row) =>
              sum +
              Math.max(0, row.qty - row.returned - row.damaged - row.lost),
            0,
          ) || 0;
      if (settlementByItem.get(line.code)! > outstanding)
        return `${label}：处理数量合计超过未结清数量。`;
      const key = `${line.code}/${line.batch || ""}/${line.loanLineIndex ?? "all"}`;
      requested.set(key, (requested.get(key) || 0) + Number(line.qty));
      if (requested.get(key)! > lineCapacity(draft, line, session))
        return `${label}：处理数量合计超过未结清数量。`;
      continue;
    }
    if (
      draft.kind !== "Reconcile" &&
      !placeExists(line.sourceLocation || line.location)
    )
      return `${label}：请选择来源库位。`;
    if (draft.kind === "Transfer" && line.sourceLocation === line.location)
      return `${label}：来源与目标库位不能相同。`;
    const stock = lineStock(line, session);
    if (
      item.tracksBatch &&
      !stock?.batches?.some((batch) => batch.id === line.batch)
    )
      return `${label}：请选择此库位的现有批次。`;
    if (draft.kind !== "Reconcile") {
      const key = `${line.code}/${line.sourceLocation || line.location}/${line.batch || ""}`;
      requested.set(key, (requested.get(key) || 0) + Number(line.qty));
      if (requested.get(key)! > lineCapacity(draft, line, session))
        return `${label}：数量合计超过${["Repair", "Disposal"].includes(draft.kind) ? "损坏" : "可用"}库存。`;
    }
  }
  return "";
}
