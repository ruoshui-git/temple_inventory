import { computed, ref, type ComputedRef } from "vue";
import type { DataTableRecord } from "../lib/dataTable";

const tableCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export function compareTableValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  return tableCollator.compare(String(left ?? ""), String(right ?? ""));
}

export function nextTableSort(
  field: string,
  currentField: string,
  currentDirection: "asc" | "desc",
  initialDirection: "asc" | "desc" = "asc",
) {
  return {
    field,
    direction:
      currentField === field
        ? currentDirection === "asc"
          ? "desc"
          : "asc"
        : initialDirection,
  } as const;
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
        compareTableValues(leftValue, rightValue) * direction ||
        compareTableValues(left.id, right.id)
      );
    });
  });

  function setSort(field: string) {
    if (!allowedFields.includes(field)) return;
    const next = nextTableSort(field, sortBy.value, sortDirection.value);
    sortBy.value = next.field;
    sortDirection.value = next.direction;
  }

  return { rows: sortedRows, sortBy, sortDirection, setSort };
}
