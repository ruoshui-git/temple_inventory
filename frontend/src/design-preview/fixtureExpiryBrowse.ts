import type { PageOptions, ReportPage } from "../services/contracts";
import type { ReportQuery, ReportRow } from "../lib/reportContract";
import { previewDate } from "./model";
type FixtureReport = (
  query: ReportQuery,
  options?: PageOptions,
) => ReportPage | Promise<ReportPage>;
export function fixtureExpiryCall(
  endpoint: string,
  args: Record<string, unknown>,
  report: FixtureReport,
) {
  const query = args.query as ReportQuery,
    dimension = String(args.dimension || "category");
  const start = Number(args.start || 0),
    size = Number(args.page_length || 30);
  const page = (rows: ReportRow[]) => ({
    rows: rows.slice(start, start + size),
    matched_count: rows.length,
    next_start: start + size < rows.length ? start + size : null,
  });
  const rowsFor = async (value: ReportQuery) =>
    (
      await report(
        JSON.parse(
          JSON.stringify({ ...value, view: "batches", grouping: "none" }),
        ),
        { page_length: Number.MAX_SAFE_INTEGER },
      )
    ).rows.map<ReportRow>((row) => ({
      ...row,
      id: JSON.stringify([row.item_code, row.warehouse, row.batch_no]),
      image: "",
    }));
  const grouped = (rows: ReportRow[], field: string) => {
    const groups = new Map<string, ReportRow>(),
      items = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = JSON.stringify([row[field], row.stock_uom]);
      const group = groups.get(key) || {
        id: key,
        [field]: row[field]!,
        stock_uom: row.stock_uom!,
        allocation_count: 0,
        item_count: 0,
        available: 0,
        loaned: 0,
        damaged: 0,
        stock_qty: 0,
      };
      for (const metric of ["available", "loaned", "damaged", "stock_qty"])
        group[metric] = Number(group[metric]) + Number(row[metric] || 0);
      group.allocation_count = Number(group.allocation_count) + 1;
      const codes = items.get(key) || new Set<string>();
      codes.add(String(row.item_code));
      items.set(key, codes);
      group.item_count = codes.size;
      groups.set(key, group);
    }
    return [...groups.values()];
  };
  return (async () => {
    const rows = await rowsFor(query);
    rows.sort((a, b) => {
      const field = query.sortBy === "name" ? "item_name" : "expiry_date";
      return (
        String(a[field] || "").localeCompare(String(b[field] || "")) *
          (query.sort === "desc" ? -1 : 1) ||
        String(a.id).localeCompare(String(b.id))
      );
    });
    if (endpoint === "browse.expiry_analysis")
      return page(grouped(rows, dimension));
    const all = await rowsFor({ ...query, expiryWindow: "period" });
    const identities = (values: ReportRow[]) =>
      new Set(
        values.map((row) => JSON.stringify([row.item_code, row.batch_no])),
      ).size;
    const analysis = Object.fromEntries(
      ["category", "warehouse"].map((field) => {
        const values = grouped(rows, field);
        return [
          field,
          {
            rows: values.slice(0, 30),
            matched_count: values.length,
            next_start: values.length > 30 ? 30 : null,
          },
        ];
      }),
    );
    return {
      ...page(rows),
      query,
      item_count: new Set(rows.map((row) => row.item_code)).size,
      batch_count: identities(rows),
      snapshot: `${previewDate} 10:00:00`,
      totals: grouped(rows, "stock_uom"),
      analysis,
      facets: {
        all: identities(all),
        expired: identities(
          all.filter(
            (row) => row.expiry_date && String(row.expiry_date) < previewDate,
          ),
        ),
        unexpired: identities(
          all.filter(
            (row) => row.expiry_date && String(row.expiry_date) >= previewDate,
          ),
        ),
        undated: identities(all.filter((row) => !row.expiry_date)),
      },
    };
  })();
}
