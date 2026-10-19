/** Native-shaped browse responses for the shared movement/loan gallery surface. */
import type { ReportQuery, ReportRow } from "../../src/lib/reportContract";
import type { ReportPage } from "../../src/services/contracts";
import { emptyScope } from "../../src/lib/browseQuery";
import { fixtureCatalogItem } from "./fixtureNativeDocuments";
import type {
  OperationGroup,
  OperationBrowsePage,
  BrowseRowsPage,
} from "../../src/features/movements/useOperationBrowse";
type Project = (
  query: ReportQuery,
  options: { table: string; start?: number; page_length: number },
) => ReportPage;
const outcomes = ["outstanding", "returned", "damaged", "lost"];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function sourceRows(query: ReportQuery, project: Project): ReportRow[] {
  const page = project(
    {
      ...copy(query),
      view: query.dataset === "loans" ? "outcomes" : "lines",
      grouping: "none",
    },
    {
      table: query.dataset === "loans" ? "balances" : "lines",
      page_length: Number.MAX_SAFE_INTEGER,
    },
  );
  return page.rows.map((value) => {
    const code = String(value.item_code || ""),
      metadata = fixtureCatalogItem(code),
      docstatus = Number(value.docstatus ?? 1),
      borrowed = Number(value.borrowed || 0),
      outstanding = docstatus === 1 ? Number(value.outstanding || 0) : 0;
    const row: ReportRow = {
      ...value,
      kind: query.dataset === "loans" ? "Loan" : value.kind || "",
      item_code: code,
      item_name: metadata.item_name,
      category: metadata.item_group,
      stock_uom: metadata.stock_uom,
      docstatus,
      stock_qty:
        query.dataset === "loans" ? outstanding : Number(value.stock_qty || 0),
      outstanding,
      borrowed,
      source_warehouse:
        query.dataset === "loans"
          ? value.source_warehouse || value.warehouse || ""
          : value.source_warehouse || "",
      destination_warehouse:
        query.dataset === "loans"
          ? "借出"
          : value.destination_warehouse || value.warehouse || "",
      date: value.date || "",
      time: value.time || "10:00:00",
      document_id: `${value.doctype}:${value.document}`,
    };
    if (query.dataset === "loans") {
      row.original_loan = value.document || value.original_loan || "";
      const index = String(value.original_loan_line || "").match(
        /\/(\d+)$/,
      )?.[1];
      if (index !== undefined)
        row.original_loan_line = `${row.original_loan}-ROW-${Number(index) + 1}`;
      row.line_name = row.original_loan_line || "";
    }
    return row;
  });
}
function contributions(
  query: ReportQuery,
  records: boolean,
  project: Project,
): ReportRow[] {
  const rows = sourceRows(query, project);
  if (records || query.dataset === "movements") return rows;
  return rows.flatMap((row) =>
    outcomes
      .filter(
        (outcome) =>
          (query.loanOutcome === "all" || query.loanOutcome === outcome) &&
          Number(row[outcome]) > 0,
      )
      .map((outcome) => ({
        ...row,
        id: JSON.stringify([row.id, outcome]),
        outcome_key: outcome,
        stock_qty: Number(row[outcome]),
      })),
  );
}
function groupRows(
  rows: ReportRow[],
  fields: string[],
  sums = ["stock_qty"],
): ReportRow[] {
  const groups = new Map<
    string,
    { row: ReportRow; items: Set<string>; documents: Set<string> }
  >();
  for (const row of rows) {
    const key = JSON.stringify(fields.map((field) => row[field] ?? null));
    let group = groups.get(key);
    if (!group) {
      group = {
        row: {
          id: key,
          ...Object.fromEntries(
            fields.map((field) => [field, row[field] ?? null]),
          ),
          allocation_count: 0,
        },
        items: new Set(),
        documents: new Set(),
      };
      groups.set(key, group);
    }
    group.items.add(String(row.item_code));
    group.documents.add(String(row.document_id));
    group.row.allocation_count = Number(group.row.allocation_count) + 1;
    for (const sum of sums)
      group.row[sum] = Number(group.row[sum] || 0) + Number(row[sum] || 0);
  }
  return [...groups.values()].map((group) => ({
    ...group.row,
    item_count: group.items.size,
    document_count: group.documents.size,
  }));
}
const dimensions: Record<string, string> = {
  category: "category",
  location: "source_warehouse",
  activity: "activity_title",
  borrower: "borrower",
  month: "month",
};
function analysisRows(rows: ReportRow[], dimension: string) {
  const field = dimensions[dimension];
  if (!field) throw new Error("请选择有效的分析分组");
  return groupRows(
    rows.map((row) => ({ ...row, month: String(row.date).slice(0, 7) })),
    [field, "kind", "outcome_key", "stock_uom", "docstatus"],
  );
}
function pageRows(
  rows: ReportRow[],
  start: number,
  size: number,
): BrowseRowsPage {
  return {
    rows: rows.slice(start, start + size),
    matched_count: rows.length,
    next_start: start + size < rows.length ? start + size : null,
  };
}
function whole(
  query: ReportQuery,
  row: ReportRow,
  project: Project,
): NonNullable<OperationGroup["whole"]> {
  const wide: ReportQuery = {
    ...copy(query),
    scope: emptyScope(),
    search: "",
    record: String(row.document),
    loan: query.dataset === "loans" ? String(row.document) : "",
    statuses: [0, 1, 2],
    loanOutcome: "all",
    loanStatus: "all",
    itemCodes: [],
    itemLocationKeys: [],
    restrictItems: false,
    allocationKeys: [],
    restrictAllocations: false,
  };
  const lines = sourceRows(wide, project),
    units = groupRows(
      lines,
      ["stock_uom"],
      [query.dataset === "loans" ? "borrowed" : "stock_qty", "outstanding"],
    ),
    branches = new Map<string, { source: string; destination: string }>();
  for (const line of lines) {
    const branch = {
      source: String(line.source_warehouse || ""),
      destination: String(line.destination_warehouse || ""),
    };
    branches.set(JSON.stringify(branch), branch);
  }
  return {
    quantities: units.map((unit) => ({
      uom: String(unit.stock_uom),
      qty: Number(unit[query.dataset === "loans" ? "borrowed" : "stock_qty"]),
    })),
    outstanding: units.map((unit) => ({
      uom: String(unit.stock_uom),
      qty: Number(unit.outstanding),
    })),
    item_count: new Set(lines.map((line) => line.item_code)).size,
    line_count: lines.length,
    branches: [...branches.values()],
    original_loans:
      query.dataset === "loans"
        ? []
        : [
            ...new Set(
              lines.flatMap((line) =>
                line.original_loan ? [String(line.original_loan)] : [],
              ),
            ),
          ],
    loan_status:
      Number(row.docstatus) === 0
        ? "Draft"
        : Number(row.docstatus) === 2
          ? "Cancelled"
          : units.some((unit) => Number(unit.outstanding) > 0)
            ? "Open"
            : "Settled",
  };
}
export function fixtureOperationCall(
  endpoint: string,
  args: Record<string, unknown>,
  project: Project,
):
  | OperationBrowsePage
  | BrowseRowsPage
  | (BrowseRowsPage & { columns: string[] }) {
  const query = copy(args.query as ReportQuery),
    records = Boolean(args.records),
    start = Number(args.start || 0),
    size = Number(args.page_length || 20),
    rows = contributions(query, records, project);
  if (endpoint === "browse.movement_history") {
    const selected = rows.filter(
      (row) =>
        (!args.item_code || row.item_code === args.item_code) &&
        (!args.batch_no || row.batch_no === args.batch_no),
    );
    const mapped = selected.map((row) => ({
      id: `${row.doctype}:${row.document}:${row.item_code}:${row.stock_uom}`,
      doctype: row.doctype,
      document: row.document,
      item_code: row.item_code,
      item_name: row.item_name,
      date_time: `${row.date} ${row.time || ""}`.trim(),
      kind: row.kind,
      source_warehouse: row.source_warehouse || "",
      destination_warehouse: row.destination_warehouse || "",
      stock_uom: row.stock_uom,
      docstatus: row.docstatus,
      quantity: Number(row.stock_qty || 0),
      available_effect: Number(row.available_effect || 0),
      loan_balance_effect: Number(row.loan_balance_effect || 0),
      borrower: row.borrower || "",
    }));
    return {
      rows: mapped.slice(start, start + size),
      matched_count: mapped.length,
      next_start: start + size < mapped.length ? start + size : null,
    } as unknown as BrowseRowsPage;
  }
  if (endpoint === "browse.loan_item_history") {
    const selected = rows.filter(
      (row) => row.item_code === args.item_code && row.kind === "Loan",
    );
    const mapped = selected.map((row) => ({
      id: `${row.document}:${row.item_code}:${row.stock_uom}`,
      doctype: row.doctype,
      document: row.document,
      item_code: row.item_code,
      item_name: row.item_name,
      date_time: `${row.date} ${row.time || ""}`.trim(),
      borrower: row.borrower || "",
      source_warehouse: row.source_warehouse || "",
      destination_warehouse: row.destination_warehouse || "",
      stock_uom: row.stock_uom,
      docstatus: row.docstatus,
      kind: "Loan",
      borrowed: Number(row.borrowed || row.stock_qty || 0),
      outstanding: Number(row.outstanding || 0),
    }));
    return {
      rows: mapped.slice(start, start + size),
      matched_count: mapped.length,
      next_start: start + size < mapped.length ? start + size : null,
    } as unknown as BrowseRowsPage;
  }
  if (endpoint === "browse.operation_contributions") {
    const selected = rows.filter((row) =>
      records
        ? row.doctype === args.doctype && row.document === args.name
        : row.item_code === args.item_code &&
          (query.dataset === "movements" || row.outcome_key === args.outcome),
    );
    return {
      ...pageRows(selected, start, size),
      columns: [...new Set(selected.flatMap((row) => Object.keys(row)))],
    };
  }
  if (endpoint === "browse.operation_analysis")
    return pageRows(analysisRows(rows, String(args.dimension)), start, size);
  const fields = records
    ? [
        "doctype",
        "document",
        "document_id",
        "date",
        "time",
        "docstatus",
        "kind",
        "activity",
        "activity_title",
        "borrower",
      ]
    : [
        "item_code",
        "item_name",
        "category",
        "stock_uom",
        ...(query.dataset === "loans" ? ["outcome_key"] : []),
      ];
  const grouped = groupRows(rows, fields, records ? [] : ["stock_qty"]).map(
    (group): OperationGroup => {
      const matches = rows.filter((row) =>
        records
          ? row.doctype === group.doctype && row.document === group.document
          : row.item_code === group.item_code &&
            (query.dataset === "movements" ||
              row.outcome_key === group.outcome_key),
      );
      const dates = matches.map((row) => String(row.date)).sort();
      if (records)
        return {
          ...group,
          id: JSON.stringify(["record", group.doctype, group.document]),
          whole: whole(query, group, project),
          matching_totals: groupRows(
            matches,
            ["stock_uom"],
            query.dataset === "loans"
              ? [
                  "stock_qty",
                  "borrowed",
                  "returned",
                  "damaged",
                  "lost",
                  "outstanding",
                ]
              : ["stock_qty"],
          ),
        } as unknown as OperationGroup;
      return {
        ...group,
        id: JSON.stringify([
          "item",
          group.item_code,
          group.outcome_key || null,
        ]),
        item: fixtureCatalogItem(String(group.item_code)),
        date: dates.at(-1),
        totals: groupRows(matches, ["kind", "stock_uom", "docstatus"]),
      } as unknown as OperationGroup;
    },
  );
  const sorted = grouped.sort((a, b) => {
    const left =
      query.sortBy === "quantity"
        ? Number((a as unknown as ReportRow).stock_qty)
        : query.sortBy === "name"
          ? a.item_name || a.borrower || a.document || ""
          : a.date || "";
    const right =
      query.sortBy === "quantity"
        ? Number((b as unknown as ReportRow).stock_qty)
        : query.sortBy === "name"
          ? b.item_name || b.borrower || b.document || ""
          : b.date || "";
    const order =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), "zh-CN");
    return (query.sort === "desc" ? -order : order) || a.id.localeCompare(b.id);
  });
  return {
    rows: sorted.slice(start, start + size),
    query,
    matched_count: sorted.length,
    next_start: start + size < sorted.length ? start + size : null,
    summary: {
      item_count: new Set(rows.map((row) => row.item_code)).size,
      document_count: new Set(rows.map((row) => row.document_id)).size,
      category_count: new Set(rows.map((row) => row.category)).size,
      allocation_count: rows.length,
    },
    totals: groupRows(
      rows,
      ["kind", "outcome_key", "stock_uom", "docstatus"],
      records && query.dataset === "loans"
        ? ["stock_qty", "borrowed", "outstanding"]
        : ["stock_qty"],
    ),
    snapshot: "图库固定样本",
    analysis: Object.fromEntries(
      Object.keys(dimensions).map((key) => [
        key,
        pageRows(analysisRows(rows, key), 0, 30),
      ]),
    ),
  };
}
