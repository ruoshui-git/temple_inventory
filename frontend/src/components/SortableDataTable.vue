<script setup lang="ts" generic="TRow extends Record<string, any>">
import { computed } from 'vue'

export type SortOrder = 'asc' | 'desc'
export interface DataTableColumn {
  key: string
  label: string
  sortable?: boolean
  initialOrder?: SortOrder
  headerClass?: string
  cellClass?: string
}
export interface SortState { sort_by: string; sort_order: SortOrder }

const props = withDefaults(defineProps<{
  rows: TRow[]
  columns: DataTableColumn[]
  rowKey: string
  sort: SortState
  selectionMode?: boolean
  selectedKeys?: Array<string | number>
}>(), { selectionMode: false, selectedKeys: () => [] })
const emit = defineEmits<{ sort: [state: SortState]; activate: [row: TRow]; toggle: [row: TRow] }>()
const selected = computed(() => new Set(props.selectedKeys.map(String)))
const valueFor = (row: TRow) => row[props.rowKey]
const isSelected = (row: TRow) => selected.value.has(String(valueFor(row)))
function sortColumn(column: DataTableColumn) {
  if (!column.sortable) return
  const order = props.sort.sort_by === column.key ? (props.sort.sort_order === 'asc' ? 'desc' : 'asc') : (column.initialOrder || 'asc')
  emit('sort', { sort_by: column.key, sort_order: order })
}
function isControl(target: EventTarget | null) { return target instanceof Element && Boolean(target.closest('[data-row-control]')) }
function activate(row: TRow, event: Event) {
  if (isControl(event.target)) return
  if (event.target instanceof Element && event.target.closest('[data-row-action]')) {
    if (props.selectionMode) { event.preventDefault(); emit('toggle', row) }
    return
  }
  if (props.selectionMode) emit('toggle', row)
  else emit('activate', row)
}
function activateKey(row: TRow, event: KeyboardEvent) {
  if (isControl(event.target) || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault(); activate(row, event)
}
function action(event: MouseEvent, row: TRow) {
  if (!props.selectionMode) return
  if ((event.currentTarget as Element).closest('[data-row-action]')) { event.preventDefault(); emit('toggle', row) }
}
</script>

<template>
  <div class="sortable-data-table">
    <div class="sortable-data-table-desktop">
      <table>
        <thead><tr><th v-for="column in columns" :key="column.key" scope="col" :class="column.headerClass" :aria-sort="column.sortable ? (sort.sort_by === column.key ? (sort.sort_order === 'asc' ? 'ascending' : 'descending') : 'none') : undefined">
          <button v-if="column.sortable" type="button" :aria-label="`按${column.label}排序`" @click="sortColumn(column)">{{ column.label }} <span v-if="sort.sort_by === column.key" aria-hidden="true">{{ sort.sort_order === 'asc' ? '↑' : '↓' }}</span><span v-else class="sr-only">可排序</span></button>
          <span v-else>{{ column.label }}</span>
        </th></tr></thead>
        <tbody><tr v-for="row in rows" :key="String(valueFor(row))" :class="{ selected: isSelected(row) }" :aria-selected="selectionMode ? isSelected(row) : undefined" tabindex="0" @click="activate(row, $event)" @keydown="activateKey(row, $event)">
          <td v-for="column in columns" :key="column.key" :class="column.cellClass"><slot :name="`cell-${column.key}`" :row="row" :column="column">{{ row[column.key] }}</slot></td>
        </tr></tbody>
      </table>
    </div>
    <div class="sortable-data-table-mobile"><div v-for="row in rows" :key="String(valueFor(row))" class="sortable-mobile-row" :class="{ selected: isSelected(row) }" @click="activate(row, $event)" @keydown="activateKey(row, $event)"><slot name="mobile-row" :row="row" :selected="isSelected(row)" :activate="(event: Event) => activate(row, event)" :activate-key="(event: KeyboardEvent) => activateKey(row, event)" :action="(event: MouseEvent) => action(event, row)"><article tabindex="0"><span v-for="column in columns" :key="column.key"><b>{{ column.label }}</b> {{ row[column.key] }}</span></article></slot></div></div>
  </div>
</template>

<style scoped>
.sortable-data-table-mobile { display: none }
.sortable-data-table table { width: 100%; border-collapse: collapse }
.sortable-data-table th, .sortable-data-table td { padding: 12px; text-align: left; border-bottom: 1px solid #eee8db }
.sortable-data-table th button { min-height: 36px; padding: 6px 8px; border: 0; background: transparent; font-weight: 700 }
.sortable-data-table tbody tr { cursor: pointer; outline: none }
.sortable-data-table tbody tr:hover, .sortable-data-table tbody tr:focus-visible, .sortable-data-table tbody tr.selected, .sortable-data-table-mobile article:hover, .sortable-data-table-mobile article:focus-visible, .sortable-mobile-row.selected > * { background: #eee8db }
.sortable-data-table tbody tr:focus-visible, .sortable-data-table-mobile article:focus-visible { box-shadow: inset 0 0 0 3px #d99a48 }
.sortable-mobile-row { outline: none }
@media (max-width: 1023px) { .sortable-data-table-desktop { display: none } .sortable-data-table-mobile { display: grid; gap: 10px } .sortable-data-table-mobile article { display: grid; gap: 6px; padding: 14px; border-radius: 10px; cursor: pointer; outline: none } }
</style>
