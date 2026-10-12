import { previewDate } from "./model";
import type { ReviewSession } from "./reviewModel";
import {
  emptyScope,
  matchesWarehouse,
  matchesItem,
  filterLoans,
  filterMovements,
  remaining,
  quantities,
  movementLabels,
} from "./browseModel";
export const expiryBuckets = [
  { key: "expired_1_30", label: "已过期 1–30 天" },
  { key: "expired_31_90", label: "已过期 31–90 天" },
  { key: "expired_over_90", label: "已过期 >90 天" },
  { key: "upcoming_0_30", label: "0–30 天内到期" },
  { key: "upcoming_31_90", label: "31–90 天内到期" },
  { key: "upcoming_over_90", label: ">90 天后到期" },
];
export function expiryBucket(expiry?: string, today = previewDate) {
  if (!expiry) return "";
  const days = Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86400000,
  );
  return days < -90
    ? "expired_over_90"
    : days < -30
      ? "expired_31_90"
      : days < 0
        ? "expired_1_30"
        : days <= 30
          ? "upcoming_0_30"
          : days <= 90
            ? "upcoming_31_90"
            : "upcoming_over_90";
}
export function dashboardScope(session: ReviewSession) {
  const scope = emptyScope();
  scope.categories = [...session.filters.dashboard.categories];
  scope.warehouses = [...session.filters.dashboard.warehouses];
  return scope;
}
export function dashboardData(session: ReviewSession) {
  const scope = dashboardScope(session);
  const stock = session.stock
    .filter((item) => matchesItem(item.code, scope, session))
    .map((item) => ({
      ...item,
      locations: item.locations.filter((location) =>
        matchesWarehouse(location.location, scope.warehouses, session),
      ),
    }))
    .filter((item) =>
      item.locations.some(
        (row) => row.available + row.loaned + row.damaged > 0,
      ),
    );
  const metric = (key: "available" | "loaned" | "damaged" | "total") =>
    quantities(
      stock.flatMap((item) =>
        item.locations.map((row) => ({
          uom: item.uom,
          qty:
            key === "total"
              ? row.available + row.loaned + row.damaged
              : row[key],
        })),
      ),
    );
  const batches = stock.flatMap((item) =>
    item.tracksExpiry
      ? item.locations.flatMap((location) =>
          (location.batches || [])
            .filter((batch) => batch.expiry && batch.available > 0)
            .map((batch) => ({
              ...batch,
              item,
              location: location.location,
              bucket: expiryBucket(batch.expiry),
            })),
        )
      : [],
  );
  const buckets = expiryBuckets.map((bucket) => ({
    ...bucket,
    count: new Set(
      batches
        .filter((row) => row.bucket === bucket.key)
        .map((row) => `${row.item.code}:${row.id}`),
    ).size,
  }));
  const movements = filterMovements(
    session.movements.filter((row) => row.docstatus === 1),
    { ...scope, period: session.filters.dashboard.period },
    "",
    session,
  );
  const loans = filterLoans(
    session.loans.filter(
      (loan) =>
        loan.status !== "draft" &&
        loan.lines.some((line) => remaining(line) > 0),
    ),
    scope,
    "",
    session,
  )
    .map((loan) => ({
      ...loan,
      lines: loan.lines.filter((line) => remaining(line) > 0),
    }))
    .filter((loan) => loan.lines.length);
  const loanQuantities = quantities(
    loans.flatMap((loan) =>
      loan.lines.map((line) => ({
        qty: remaining(line),
        uom: session.stock.find((item) => item.code === line.code)?.uom || "",
      })),
    ),
  );
  const damaged = stock.filter((item) =>
    item.locations.some((row) => row.damaged > 0),
  ).length;
  const summaries = Object.entries(movementLabels).map(([kind, label]) => {
    const rows = movements.filter((row) => row.kind === kind);
    return {
      kind,
      label,
      quantity: quantities(rows),
      count: new Set(rows.map((row) => row.name)).size,
    };
  });
  return {
    scope,
    stock,
    metric,
    batches,
    buckets,
    movements,
    summaries,
    loans,
    loanQuantities,
    damaged,
  };
}
