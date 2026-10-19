/** Translate fixture quantities to actual physical, leased and damaged locations. */
import type { ReportRow } from "../../src/lib/reportContract";
import type { StockItem } from "./model";
import { reviewSession, type ReviewSession } from "./reviewModel";
interface StockRow extends ReportRow {
  warehouse: string;
  batch_no: string;
  available: number;
  loaned: number;
  damaged: number;
  expiry_date: string;
  manufacturing_date: string;
}
export function fixtureStockRows(item: StockItem): StockRow[] {
  const leased =
    reviewSession.warehouses.find((row) => !row.is_group && row.name === "借出")
      ?.name || "";
  const damaged =
    reviewSession.warehouses.find(
      (row) => !row.is_group && row.name.startsWith("损坏待处理"),
    )?.name || "";
  const rows = new Map<string, StockRow>();
  function add(
    warehouse: string,
    kind: "available" | "loaned" | "damaged",
    quantity: number,
    batch_no = "",
    expiry_date = "",
    manufacturing_date = "",
  ) {
    if (!warehouse || !quantity) return;
    const key = JSON.stringify([warehouse, batch_no]),
      row = rows.get(key) || {
        warehouse,
        batch_no,
        available: 0,
        loaned: 0,
        damaged: 0,
        expiry_date,
        manufacturing_date,
      };
    row[kind] = Number(row[kind] || 0) + quantity;
    rows.set(key, row);
  }
  for (const place of item.locations) {
    const known = { available: 0, loaned: 0, damaged: 0 };
    for (const batch of place.batches || []) {
      for (const kind of ["available", "loaned", "damaged"] as const) {
        const quantity = Number(
          (batch as unknown as Record<string, unknown>)[kind] || 0,
        );
        known[kind] += quantity;
        add(
          kind === "available"
            ? place.location
            : kind === "loaned"
              ? leased
              : damaged,
          kind,
          quantity,
          batch.id,
          batch.expiry || "",
          String(
            (batch as unknown as Record<string, unknown>).manufacturingDate ||
              "",
          ),
        );
      }
    }
    for (const kind of ["available", "loaned", "damaged"] as const)
      add(
        kind === "available"
          ? place.location
          : kind === "loaned"
            ? leased
            : damaged,
        kind,
        Math.max(0, Number(place[kind] || 0) - known[kind]),
      );
  }
  return [...rows.values()];
}
export function fixtureStockSession(): ReviewSession {
  return {
    ...reviewSession,
    stock: reviewSession.stock.map((item) => {
      const locations = new Map<string, StockItem["locations"][number]>();
      for (const row of fixtureStockRows(item)) {
        const place: StockItem["locations"][number] = locations.get(
          row.warehouse,
        ) || {
          location: row.warehouse,
          available: 0,
          loaned: 0,
          damaged: 0,
          batches: [],
        };
        place.available += Number(row.available || 0);
        place.loaned += Number(row.loaned || 0);
        place.damaged += Number(row.damaged || 0);
        if (row.batch_no)
          place.batches!.push({
            id: row.batch_no,
            available: Number(row.available || 0),
            damaged: Number(row.damaged || 0),
            loaned: Number(row.loaned || 0),
            expiry: row.expiry_date || "",
            manufacturingDate: row.manufacturing_date || "",
          } as NonNullable<typeof place.batches>[number]);
        locations.set(row.warehouse, place);
      }
      return { ...item, locations: [...locations.values()] };
    }),
  };
}
