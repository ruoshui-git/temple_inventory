import { computed, ref, type ComputedRef } from "vue";
import type { DataTableRecord } from "../lib/dataTable";

function compareValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/** Sort a complete in-memory table, preserving a stable identity order for ties. */
export function useArrayTableSort(
  rows: ComputedRef<DataTableRecord[]>,
  initialField: string,
  allowedFields: readonly string[],
) {
  const sortBy = ref(initialField);
  const sortDirection = ref<"asc" | "desc">("asc");
  const sortedRows = computed(() => {
    const direction = sortDirection.value === "asc" ? 1 : -1;
    return [...rows.value].sort((left, right) => {
      const leftValue = left.value[sortBy.value];
      const rightValue = right.value[sortBy.value];
      return (
        compareValues(leftValue, rightValue) * direction ||
        String(left.id).localeCompare(String(right.id), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    });
  });

  function setSort(field: string) {
    if (!allowedFields.includes(field)) return;
    if (sortBy.value === field) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
      return;
    }
    sortBy.value = field;
    sortDirection.value = "asc";
  }

  return { rows: sortedRows, sortBy, sortDirection, setSort };
}
