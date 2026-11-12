import type { UnitRow } from "../services/units";

export function filterUnitRows(
  rows: UnitRow[],
  search: string,
  categoryFilter: string,
  wholeFilter: "all" | "whole" | "fractional",
  statusFilter: "all" | "enabled" | "disabled",
) {
  const term = search.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (!term ||
        `${row.name} ${row.label} ${row.category}`
          .toLocaleLowerCase()
          .includes(term)) &&
      (!categoryFilter ||
        (categoryFilter === "__uncategorized"
          ? !row.category
          : row.category === categoryFilter)) &&
      (wholeFilter === "all" ||
        row.must_be_whole_number === (wholeFilter === "whole")) &&
      (statusFilter === "all" || row.enabled === (statusFilter === "enabled")),
  );
}

export function unitGroupExpanded(
  category: string,
  defaultExpanded: ReadonlySet<string>,
  searching: boolean,
  expanded: ReadonlySet<string>,
  collapsed: ReadonlySet<string>,
) {
  if (collapsed.has(category)) return false;
  return searching || expanded.has(category) || defaultExpanded.has(category);
}
