/** Map visible screen columns to allowed export fields in their displayed order. */
export function exportFields(
  map: Record<string, string[]>,
  order: string[],
  visible: string[],
): string[] {
  const shown = new Set(visible);
  const seen = new Set<string>();
  const fields: string[] = [];
  for (const screenId of order) {
    if (!shown.has(screenId)) continue;
    for (const field of map[screenId] || []) {
      if (!seen.has(field)) {
        seen.add(field);
        fields.push(field);
      }
    }
  }
  return fields;
}
