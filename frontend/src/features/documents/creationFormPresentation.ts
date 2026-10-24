import type { StockItem } from "../../lib/stockPresentation";

export type CreationLocationKind = "Receive" | "Transfer";
export type OutstandingLoanSummary = {
  name: string;
  date: string;
  borrower: string;
  activity: string;
  items: {
    code: string;
    name: string;
    image: string;
    uom: string;
    quantity: number;
  }[];
};
export type OutstandingBorrowerSummary = {
  borrower: string;
  loan_count: number;
  item_count: number;
  latest_date: string;
};
export type BorrowerLoanPageState = {
  rows: OutstandingLoanSummary[];
  next: number | null;
  loading: boolean;
};

export function borrowerLoanPageState(
  states: Record<string, BorrowerLoanPageState>,
  borrower: string,
) {
  let state = states[borrower];
  if (!state) {
    states[borrower] = { rows: [], next: 0, loading: false };
    state = states[borrower]!;
  }
  return state;
}

export function validRememberedLocation(
  kind: string,
  value: unknown,
  physicalLeaves: string[],
  sourceLocations: string[] = [],
) {
  return (kind === "Receive" || kind === "Transfer") &&
    typeof value === "string" &&
    physicalLeaves.includes(value) &&
    (kind !== "Transfer" || !sourceLocations.includes(value))
    ? value
    : "";
}

export function transferDestinationOptions(
  leaves: string[],
  sourceLocations: string[],
) {
  const sources = new Set(sourceLocations.filter(Boolean));
  return leaves.filter((name) => !sources.has(name));
}

export function groupOutstandingLoans<T extends { borrower: string }>(
  loans: T[],
) {
  const groups = new Map<string, T[]>();
  for (const loan of loans) {
    const rows = groups.get(loan.borrower) || [];
    rows.push(loan);
    groups.set(loan.borrower, rows);
  }
  return [...groups].map(([borrower, rows]) => ({ borrower, loans: rows }));
}

export function visibleOutstandingLoans(
  loans: OutstandingLoanSummary[],
  search: string,
) {
  const term = search.trim().toLocaleLowerCase();
  return loans.filter(
    (loan) =>
      !term ||
      `${loan.borrower} ${loan.name} ${loan.date} ${loan.activity} ${loan.items
        .map((item) => `${item.name} ${item.code}`)
        .join(" ")}`
        .toLocaleLowerCase()
        .includes(term),
  );
}

export function showOnlyStockFilter(purpose?: string) {
  return !["outbound", "damaged"].includes(purpose || "");
}

export function shouldShowLineTools(itemCount: number) {
  return itemCount > 0;
}

export function showCountRowsOrEmpty(hasError: boolean, rowCount: number) {
  return !hasError || rowCount > 0;
}

export function earliestBatchExpiry(item: StockItem) {
  return (
    (item.locations || [])
      .flatMap((location) => location.batches || [])
      .map((batch) => batch.expiry || "")
      .filter(Boolean)
      .sort()[0] || ""
  );
}
