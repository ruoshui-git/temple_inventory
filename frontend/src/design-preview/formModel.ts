import { conversionError } from "./conversionModel";
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
        .find((loan) => loan.name === (line.loanName || draft.loanName))
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

export interface OperationIssue {
  message: string;
  lineId?: string;
  field: keyof DraftLine | keyof ReviewDraft;
}

function documentIssues(draft: ReviewDraft): OperationIssue[] {
  if (draft.files?.some((file) => file.state === "uploading"))
    return [{ message: "附件仍在上传，请完成后再确认。", field: "files" }];
  if (draft.files?.some((file) => file.state === "error"))
    return [
      { message: "附件上传失败，请重试或移除后再确认。", field: "files" },
    ];
  if (!draft.postingDate || Number.isNaN(Date.parse(draft.postingDate)))
    return [{ message: "请选择操作日期。", field: "postingDate" }];
  if (
    draft.timeMode === "manual" &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.postingTime || "")
  )
    return [{ message: "请填写有效操作时间。", field: "postingTime" }];
  if (!draft.lines.length)
    return [{ message: "请先添加至少一项物品。", field: "lines" }];
  if (draft.kind === "Loan" && !draft.borrower.trim())
    return [{ message: "请填写借用人或团体。", field: "borrower" }];
  if (draft.kind === "Return" && !draft.loanName)
    return [{ message: "请选择关联借用记录。", field: "loanName" }];
  if (
    draft.kind === "Return" &&
    draft.lines.some((line) => line.returnOutcome === "lost")
  )
    return [
      { message: "遗失请使用单独的记录遗失操作。", field: "returnOutcome" },
    ];
  if (
    draft.kind === "Reconcile" &&
    draft.countMode &&
    (!draft.countLocation ||
      draft.lines.some((line) => line.location !== draft.countLocation))
  )
    return [{ message: "每次盘点请选择同一个库位。", field: "countLocation" }];
  if (draft.kind === "Reconcile" && draft.baselineStale)
    return [
      {
        message: "账面数量已变化，请刷新基准并重新核对。",
        field: "baselineStale",
      },
    ];
  if (draft.kind === "Reconcile" && draft.baselineReviewed === false)
    return [{ message: "请确认已重新核对差异。", field: "baselineReviewed" }];
  if (
    draft.kind === "Reconcile" &&
    !draft.lines.some(
      (line) => line.countedQty !== undefined && String(line.countedQty) !== "",
    )
  )
    return [{ message: "请至少核对一行实点数量。", field: "lines" }];
  return [];
}

export function operationIssues(
  draft: ReviewDraft,
  session: ReviewSession = reviewSession,
): OperationIssue[] {
  const requested = new Map<string, number>();
  const settlementByItem = new Map<string, number>();
  const counted = new Set<string>();
  const placeExists = (name?: string) =>
    session.warehouses.some(
      (row) => row.name === name && !row.is_group && row.status === "active",
    );
  function checkLine(line: DraftLine): OperationIssue | undefined {
    if (
      draft.kind === "Reconcile" &&
      draft.countMode &&
      (line.countedQty === undefined || String(line.countedQty) === "")
    )
      return;
    const item = session.stock.find((item) => item.code === line.code);
    if (!item)
      return { message: "请选择有效物品。", lineId: line.id, field: "code" };
    const label = item.name;
    if (!placeExists(line.location))
      return {
        message: `${label}：请选择有效库位。`,
        lineId: line.id,
        field: [
          "Receive",
          "Reconcile",
          "Transfer",
          "Return",
          "Repair",
        ].includes(draft.kind)
          ? "location"
          : "sourceLocation",
      };
    if (draft.kind === "Reconcile") {
      const key = `${line.code}/${line.location}/${line.batch || ""}`;
      if (counted.has(key))
        return {
          message: `${label}：同一库位与批次只能盘点一次。`,
          lineId: line.id,
          field: "batch",
        };
      counted.add(key);
      if (
        line.countedQty === undefined ||
        line.countedQty === null ||
        String(line.countedQty) === "" ||
        !Number.isFinite(Number(line.countedQty)) ||
        Number(line.countedQty) < 0
      )
        return {
          message: `${label}：请填写非负实点数量。`,
          lineId: line.id,
          field: "countedQty",
        };
      if (Number(line.countedQty) !== Number(line.qty) && !line.reason?.trim())
        return {
          message: `${label}：请填写差异原因。`,
          lineId: line.id,
          field: "reason",
        };
    } else if (!Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0)
      return {
        message: `${label}：数量必须大于 0。`,
        lineId: line.id,
        field: "qty",
      };
    const quantity =
      draft.kind === "Reconcile" ? Number(line.countedQty) : Number(line.qty);
    if (
      session.units.find((unit) => unit.name === item.uom)?.whole &&
      !Number.isInteger(quantity)
    )
      return {
        message: `${label}：${item.uom}只允许整数数量。`,
        lineId: line.id,
        field: "qty",
      };
    if (
      item.tracksBatch &&
      !line.batch?.trim() &&
      draft.kind !== "Receive" &&
      !isSettlement(draft)
    )
      return {
        message: `${label}：请填写或选择批次编号。`,
        lineId: line.id,
        field: "batch",
      };
    if (
      draft.kind !== "Reconcile" &&
      (line.entryQty !== undefined || line.entryUom)
    ) {
      const error = conversionError(
        line.entryQty ?? line.qty,
        line.entryUom || line.uom,
        line.conversionFactor ?? (line.entryUom === line.uom ? 1 : NaN),
        line.uom,
        session,
      );
      if (error)
        return {
          message: `${label}：${error}`,
          lineId: line.id,
          field: "entryUom",
        };
      if (
        Math.abs(
          (line.entryQty ?? line.qty) * (line.conversionFactor ?? 1) - line.qty,
        ) > 1e-6
      )
        return {
          message: `${label}：输入与库存数量不一致，请重新应用换算。`,
          lineId: line.id,
          field: "entryUom",
        };
    }
    if (draft.kind === "Receive") {
      if (
        line.manufacturingDate &&
        (Number.isNaN(Date.parse(line.manufacturingDate)) ||
          (line.expiry && line.manufacturingDate > line.expiry))
      )
        return {
          message: `${label}：生产日期不能晚于到期日期。`,
          lineId: line.id,
          field: "manufacturingDate",
        };

      if (
        item.tracksExpiry &&
        (!line.expiry || Number.isNaN(Date.parse(line.expiry)))
      )
        return {
          message: `${label}：请填写到期日期。`,
          lineId: line.id,
          field: "expiry",
        };
      return;
    }
    if (isSettlement(draft)) {
      const loan = session.loans.find(
        (row) => row.name === (line.loanName || draft.loanName),
      );
      if (
        !loan ||
        loan.borrower !== draft.borrower ||
        loan.activity !== draft.activity
      )
        return {
          message: "请选择同一借用方和活动的借用记录。",
          lineId: line.id,
          field: "loanName",
        };
      const itemKey = `${loan.name}/${line.code}`;
      settlementByItem.set(
        itemKey,
        (settlementByItem.get(itemKey) || 0) + Number(line.qty),
      );
      const outstanding =
        session.loans
          .find((loan) => loan.name === (line.loanName || draft.loanName))
          ?.lines.filter((row) => row.code === line.code)
          .reduce(
            (sum, row) =>
              sum +
              Math.max(0, row.qty - row.returned - row.damaged - row.lost),
            0,
          ) || 0;
      if (settlementByItem.get(itemKey)! > outstanding)
        return {
          message: `${label}：处理数量合计超过未结清数量。`,
          lineId: line.id,
          field: "qty",
        };
      const key = `${line.loanName || draft.loanName}/${line.code}/${line.batch || ""}/${line.loanLineIndex ?? "all"}`;
      requested.set(key, (requested.get(key) || 0) + Number(line.qty));
      if (requested.get(key)! > lineCapacity(draft, line, session))
        return {
          message: `${label}：处理数量合计超过未结清数量。`,
          lineId: line.id,
          field: "qty",
        };
      return;
    }
    if (
      draft.kind !== "Reconcile" &&
      !placeExists(line.sourceLocation || line.location)
    )
      return {
        message: `${label}：请选择来源库位。`,
        lineId: line.id,
        field: "sourceLocation",
      };
    if (draft.kind === "Transfer" && line.sourceLocation === line.location)
      return {
        message: `${label}：来源与目标库位不能相同。`,
        lineId: line.id,
        field: "location",
      };
    const stock = lineStock(line, session);
    if (
      item.tracksBatch &&
      !stock?.batches?.some((batch) => batch.id === line.batch)
    )
      return {
        message: `${label}：请选择此库位的现有批次。`,
        lineId: line.id,
        field: "batch",
      };
    if (draft.kind !== "Reconcile") {
      const key = `${line.code}/${line.sourceLocation || line.location}/${line.batch || ""}`;
      requested.set(key, (requested.get(key) || 0) + Number(line.qty));
      if (requested.get(key)! > lineCapacity(draft, line, session))
        return {
          message: `${label}：数量合计超过${["Repair", "Disposal"].includes(draft.kind) ? "损坏" : "可用"}库存。`,
          lineId: line.id,
          field: "qty",
        };
    }
  }
  return [
    ...documentIssues(draft),
    ...draft.lines.flatMap((line) => {
      const issue = checkLine(line);
      return issue ? [issue] : [];
    }),
  ];
}

export function validateOperation(
  draft: ReviewDraft,
  session: ReviewSession = reviewSession,
): string {
  return operationIssues(draft, session)[0]?.message || "";
}
