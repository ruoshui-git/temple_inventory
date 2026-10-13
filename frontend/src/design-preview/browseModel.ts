import { previewDate } from "./model";
import type { ReviewSession, ReviewMovement, ReviewLoan } from "./reviewModel";

export const periodLabels = {
  all: "全部时间",
  today: "今日",
  this_week: "本周",
  this_month: "本月",
  this_year: "本年",
  last_7_days: "近7天",
  last_30_days: "近30天",
  last_90_days: "近90天",
  last_365_days: "近365天",
  custom: "自定义",
};
export type PeriodKey = keyof typeof periodLabels;
export interface PreviewPeriod {
  key: PeriodKey;
  from: string;
  to: string;
}
export interface BrowseScope {
  period: PreviewPeriod;
  warehouses: string[];
  categories: string[];
  item: string;
  activity: string;
  sources: string[];
  destinations: string[];
  kinds: string[];
}
export const emptyScope = (): BrowseScope => ({
  period: { key: "all", from: "", to: "" },
  warehouses: [],
  categories: [],
  item: "",
  activity: "",
  sources: [],
  destinations: [],
  kinds: [],
});
export const movementLabels: Record<string, string> = {
  Receive: "入库",
  Issue: "出库",
  Transfer: "转移",
  Loan: "借出",
  Return: "归还",
  Damage: "损坏",
  Loss: "遗失",
  Repair: "修复归库",
  Disposal: "报废",
  Opening: "期初库存",
  Reconcile: "库存调整",
};
export const outcomes = {
  outstanding: "未归还",
  returned: "已归还",
  damaged: "损坏",
  lost: "遗失",
};
export type Outcome = keyof typeof outcomes;
export function resolvePeriod(period: PreviewPeriod, today = previewDate) {
  if (period.key === "all") return { from: "", to: "" };
  if (period.key === "custom") return { from: period.from, to: period.to };
  const date = new Date(`${today}T00:00:00Z`);
  const start = new Date(date);
  const rolling = /^last_(\d+)_days$/.exec(period.key);
  if (rolling) start.setUTCDate(start.getUTCDate() - Number(rolling[1]) + 1);
  if (period.key === "this_week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period.key === "this_month") start.setUTCDate(1);
  if (period.key === "this_year") start.setUTCMonth(0, 1);
  return { from: start.toISOString().slice(0, 10), to: today };
}
export function inPeriod(date: string, period: PreviewPeriod) {
  const { from, to } = resolvePeriod(period);
  return (!from || date >= from) && (!to || date <= to);
}
export function matchesExpiry(
  expiry: string | undefined,
  status: string,
  today = previewDate,
) {
  if (status === "all") return true;
  if (status === "undated") return !expiry;
  if (!expiry) return false;
  if (status === "expired") return expiry < today;
  if (status === "unexpired") return expiry >= today;
  if (status === "soon") {
    const days = (Date.parse(expiry) - Date.parse(today)) / 86400000;
    return days >= 0 && days <= 30;
  }
  return true;
}
export function movementSummary(
  rows: ReviewMovement[],
  session: ReviewSession,
) {
  return {
    records: new Set(rows.map((row) => row.name)).size,
    items: new Set(rows.map((row) => row.code).filter(Boolean)).size,
    categories: new Set(
      rows
        .map(
          (row) =>
            session.stock.find((item) => item.code === row.code)?.category,
        )
        .filter(Boolean),
    ).size,
    totals: [...new Set(rows.map((row) => row.kind))].map((kind) => ({
      kind,
      text: quantityText(rows.filter((row) => row.kind === kind)),
    })),
  };
}
export function matchesWarehouse(
  location: string,
  selected: string[],
  session: ReviewSession,
) {
  if (!selected.length) return true;
  let current: string | undefined = location;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (selected.includes(current)) return true;
    seen.add(current);
    current = session.warehouses.find((row) => row.name === current)?.parent;
  }
  return false;
}
export function matchesCategory(
  category: string,
  selected: string[],
  session: ReviewSession,
) {
  if (!selected.length) return true;
  const visited = new Set<string>();
  let current = category;
  while (current && !visited.has(current)) {
    if (selected.includes(current)) return true;
    visited.add(current);
    current =
      session.categories.find((row) => row.name === current)?.parent || "";
  }
  return false;
}
export function matchesItem(
  code: string,
  scope: BrowseScope,
  session: ReviewSession,
) {
  const item = session.stock.find((row) => row.code === code);
  return (
    (!scope.item || scope.item === code) &&
    (!scope.categories.length ||
      matchesCategory(item?.category || "", scope.categories, session))
  );
}
export function filterMovements(
  rows: ReviewMovement[],
  scope: BrowseScope,
  search: string,
  session: ReviewSession,
) {
  const query = search.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      inPeriod(row.date, scope.period) &&
      matchesItem(row.code, scope, session) &&
      (!scope.activity || row.activity === scope.activity) &&
      (!scope.kinds.length || scope.kinds.includes(row.kind)) &&
      (matchesWarehouse(row.from, scope.warehouses, session) ||
        matchesWarehouse(row.to, scope.warehouses, session)) &&
      matchesWarehouse(row.from, scope.sources, session) &&
      matchesWarehouse(row.to, scope.destinations, session) &&
      `${row.name} ${row.code} ${row.itemName} ${movementLabels[row.kind]} ${row.activity || ""} ${row.borrower || ""} ${row.from} ${row.to}`
        .toLocaleLowerCase()
        .includes(query),
  );
}
export function quantities(rows: { qty: number; uom: string }[]) {
  const totals = new Map<string, number>();
  rows.forEach((row) =>
    totals.set(row.uom, (totals.get(row.uom) || 0) + row.qty),
  );
  return [...totals].map(([uom, qty]) => ({ uom, qty }));
}
export function quantityText(rows: { qty: number; uom: string }[]) {
  return (
    quantities(rows)
      .map((row) => `${row.qty} ${row.uom}`)
      .join(" · ") || "0"
  );
}
export function groupMovements(rows: ReviewMovement[]) {
  const groups = new Map<string, ReviewMovement[]>();
  rows.forEach((row) =>
    groups.set(row.code, [...(groups.get(row.code) || []), row]),
  );
  return [...groups].map(([code, lines]) => ({
    code,
    name: lines[0].itemName,
    lines,
    count: new Set(lines.map((row) => row.name)).size,
    latest: lines
      .map((row) => row.date)
      .sort()
      .at(-1)!,
    totals: [...new Set(lines.map((row) => row.kind))].map((kind) => ({
      kind,
      text: quantityText(lines.filter((row) => row.kind === kind)),
    })),
  }));
}
export function remaining(line: ReviewLoan["lines"][number]) {
  return Math.max(0, line.qty - line.returned - line.damaged - line.lost);
}
export function loanStatus(loan: ReviewLoan) {
  if (loan.status === "draft") return "草稿";
  if (!loan.lines.some((line) => remaining(line) > 0)) return "已结清";
  return loan.lines.some((line) => line.returned + line.damaged + line.lost > 0)
    ? "部分结清"
    : "未归还";
}
export function filterLoans(
  loans: ReviewLoan[],
  scope: BrowseScope,
  search: string,
  session: ReviewSession,
) {
  const query = search.trim().toLocaleLowerCase();
  return loans
    .filter(
      (loan) =>
        inPeriod(loan.loanDate, scope.period) &&
        (!scope.activity || loan.activity === scope.activity),
    )
    .map((loan) => ({
      ...loan,
      lines: loan.lines.filter(
        (line) =>
          matchesItem(line.code, scope, session) &&
          matchesWarehouse(line.location || "", scope.warehouses, session) &&
          `${loan.name} ${loan.borrower} ${loan.activity} ${line.code} ${session.stock.find((item) => item.code === line.code)?.name || ""}`
            .toLocaleLowerCase()
            .includes(query),
      ),
    }))
    .filter((loan) => loan.lines.length);
}
export function groupLoans(
  loans: ReviewLoan[],
  outcome: string,
  session: ReviewSession,
) {
  type Entry = {
    loan: ReviewLoan;
    line: ReviewLoan["lines"][number];
    qty: number;
  };
  const groups = new Map<
    string,
    {
      code: string;
      name: string;
      outcome: Outcome;
      uom: string;
      qty: number;
      entries: Entry[];
    }
  >();
  loans
    .filter((loan) => loan.status !== "draft")
    .forEach((loan) =>
      loan.lines.forEach((line) => {
        (Object.keys(outcomes) as Outcome[])
          .filter((key) => outcome === "all" || outcome === key)
          .forEach((key) => {
            const qty = key === "outstanding" ? remaining(line) : line[key];
            if (qty <= 0) return;
            const id = `${line.code}:${key}`;
            const item = session.stock.find((item) => item.code === line.code);
            const group = groups.get(id) || {
              code: line.code,
              name: item?.name || line.code,
              outcome: key,
              uom: item?.uom || "",
              qty: 0,
              entries: [],
            };
            group.qty += qty;
            group.entries.push({ loan, line, qty });
            groups.set(id, group);
          });
      }),
    );
  return [...groups.values()].map((group) => ({
    ...group,
    count: new Set(group.entries.map((entry) => entry.loan.name)).size,
  }));
}
