import type { DataColumn } from "./dataTable";

/** Map visible screen columns to allowed export fields in their displayed order. */
export function exportFields(
  columns: DataColumn[],
  order: string[],
  visible: string[],
): string[] {
  const fieldsById = new Map(
    columns.map((column) => [String(column.id), column.export || []]),
  );
  const shown = new Set(visible);
  const seen = new Set<string>();
  const fields: string[] = [];
  for (const screenId of order) {
    if (!shown.has(screenId)) continue;
    for (const field of fieldsById.get(screenId) || []) {
      if (!seen.has(field)) {
        seen.add(field);
        fields.push(field);
      }
    }
  }
  return fields;
}
