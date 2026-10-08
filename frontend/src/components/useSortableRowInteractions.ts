import { computed } from "vue";
import type { DataTableColumn, SortState } from "./SortableDataTable.vue";

export interface SortableRowTableProps<TRow extends Record<string, any>> {
  rows: TRow[];
  columns: DataTableColumn[];
  rowKey: string;
  sort: SortState;
  selectionMode: boolean;
  selectedKeys: Array<string | number>;
}

export interface SortableRowTableEvents<TRow extends Record<string, any>> {
  sort: (state: SortState) => void;
  activate: (row: TRow) => void;
  toggle: (row: TRow) => void;
}

/**
 * Shared keyboard, selection, and activation semantics for both table
 * renderers. The renderers own markup; this composable owns the interaction
 * contract so a surface split cannot drift.
 */
export function useSortableRowInteractions<TRow extends Record<string, any>>(
  props: SortableRowTableProps<TRow>,
  emit: SortableRowTableEvents<TRow>,
) {
  const selected = computed(() => new Set(props.selectedKeys.map(String)));
  const valueFor = (row: TRow) => row[props.rowKey];
  const isSelected = (row: TRow) => selected.value.has(String(valueFor(row)));

  function sortColumn(column: DataTableColumn) {
    if (!column.sortable) return;
    const order =
      props.sort.sort_by === column.key
        ? props.sort.sort_order === "asc"
          ? "desc"
          : "asc"
        : column.initialOrder || "asc";
    emit.sort({ sort_by: column.key, sort_order: order });
  }

  function isControl(target: EventTarget | null) {
    return typeof Element !== "undefined" && target instanceof Element
      ? Boolean(target.closest("[data-row-control]"))
      : false;
  }

  function activate(row: TRow, event: Event) {
    if (isControl(event.target)) return;
    if (
      typeof Element !== "undefined" &&
      event.target instanceof Element &&
      event.target.closest("[data-row-action]")
    ) {
      if (props.selectionMode) {
        event.preventDefault();
        emit.toggle(row);
      }
      return;
    }
    if (props.selectionMode) emit.toggle(row);
    else emit.activate(row);
  }

  function activateKey(row: TRow, event: KeyboardEvent) {
    if (isControl(event.target) || (event.key !== "Enter" && event.key !== " "))
      return;
    event.preventDefault();
    activate(row, event);
  }

  function action(event: MouseEvent, row: TRow) {
    if (!props.selectionMode) return;
    if ((event.currentTarget as Element | null)?.closest("[data-row-action]")) {
      event.preventDefault();
      emit.toggle(row);
    }
  }

  return {
    selected,
    valueFor,
    isSelected,
    sortColumn,
    activate,
    activateKey,
    action,
  };
}
