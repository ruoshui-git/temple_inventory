import { newReportQuery } from "../../lib/reportContract";
import {
  useInventoryServices,
  useReferenceData,
  type ReferenceOption,
} from "../../services/contracts";

export function useFilterChoices() {
  const services = useInventoryServices();
  const reference = useReferenceData();
  function remember(target: ReferenceOption[], rows: ReferenceOption[]) {
    for (const row of rows) {
      const existing = target.find((entry) => entry.value === row.value);
      if (existing) Object.assign(existing, row);
      else target.push(row);
    }
  }
  return {
    async loadItems(search: string, start: number, signal: AbortSignal) {
      const result = await services.call<{
        results: { item_code: string; item_name: string }[];
        matched_count: number;
        next_start: number | null;
      }>("catalog.search_items", { search, start, page_length: 30 }, signal);
      const rows = result.results.map((row) => ({
        value: row.item_code,
        label: row.item_name,
        detail: row.item_code,
      }));
      remember(reference.items, rows);
      return { rows, total: result.matched_count, next: result.next_start };
    },
    async loadActivities(search: string, start: number, signal: AbortSignal) {
      const query = newReportQuery("activities");
      query.search = search;
      const result = await services.report(
        query,
        { start, page_length: 30 },
        signal,
      );
      const rows = result.rows.map((row) => ({
        value: String(row.activity || row.id),
        label: String(row.title || row.activity_title || row.activity),
        detail: String(row.activity || row.id),
      }));
      remember(reference.activities, rows);
      return { rows, total: result.matched_count, next: result.next_start };
    },
  };
}
