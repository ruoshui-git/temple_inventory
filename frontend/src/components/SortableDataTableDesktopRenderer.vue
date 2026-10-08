<script setup lang="ts" generic="TRow extends Record<string, any>">
import type { DataTableColumn, SortState } from "./SortableDataTable.vue";
import {
	useSortableRowInteractions,
	type SortableRowTableProps,
} from "./useSortableRowInteractions";

const props = withDefaults(
	defineProps<
		SortableRowTableProps<TRow> & {
			loading?: boolean;
			loadingMore?: boolean;
			error?: string;
			emptyMessage?: string;
		}
	>(),
	{
		loading: false,
		loadingMore: false,
		error: "",
		emptyMessage: "暂无记录",
		selectionMode: false,
		selectedKeys: () => [],
	},
);
const emit = defineEmits<{
	sort: [state: SortState];
	activate: [row: TRow];
	toggle: [row: TRow];
}>();
const { valueFor, isSelected, sortColumn, activate, activateKey } = useSortableRowInteractions(
	props,
	{
		sort: (state) => emit("sort", state),
		activate: (row) => emit("activate", row),
		toggle: (row) => emit("toggle", row),
	},
);
</script>

<template>
	<div class="sortable-data-table-desktop">
		<table>
			<thead class="sortable-data-table-head">
				<tr>
					<th
						v-for="column in columns"
						:key="column.key"
						scope="col"
						:class="column.headerClass"
						:aria-sort="
							column.sortable
								? sort.sort_by === column.key
									? sort.sort_order === 'asc'
										? 'ascending'
										: 'descending'
									: 'none'
								: undefined
						"
					>
						<button
							v-if="column.sortable"
							type="button"
							:aria-label="`按${column.label}排序`"
							@click="sortColumn(column)"
						>
							{{ column.label }}
							<span v-if="sort.sort_by === column.key" aria-hidden="true">{{
								sort.sort_order === "asc" ? "↑" : "↓"
							}}</span
							><span v-else class="sr-only">可排序</span>
						</button>
						<span v-else>{{ column.label }}</span>
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-if="loading" class="table-state">
					<td :colspan="columns.length" role="status">正在更新记录…</td>
				</tr>
				<tr v-else-if="error" class="table-state table-error">
					<td :colspan="columns.length" role="alert">
						<slot name="error">{{ error }}</slot>
					</td>
				</tr>
				<tr v-else-if="!rows.length" class="table-state">
					<td :colspan="columns.length">{{ emptyMessage }}</td>
				</tr>
				<tr
					v-for="row in rows"
					v-else
					:key="String(valueFor(row))"
					:class="{ selected: isSelected(row), cancelled: row.docstatus === 2 }"
					:aria-selected="selectionMode ? isSelected(row) : undefined"
					tabindex="0"
					@click="activate(row, $event)"
					@keydown="activateKey(row, $event)"
				>
					<td v-for="column in columns" :key="column.key" :class="column.cellClass">
						<slot :name="`cell-${column.key}`" :row="row" :column="column">{{
							row[column.key]
						}}</slot>
					</td>
				</tr>
				<tr v-if="loadingMore" class="table-state">
					<td :colspan="columns.length" role="status">正在加载更多记录…</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<style scoped>
.sortable-data-table-desktop table {
	width: 100%;
	border-collapse: collapse;
}
.sortable-data-table-desktop th,
.sortable-data-table-desktop td {
	padding: 12px;
	text-align: left;
	vertical-align: middle;
	border-bottom: 1px solid #eee8db;
}
.sortable-data-table-head {
	position: sticky;
	top: 0;
	z-index: 2;
}
.sortable-data-table-desktop th {
	background: #fff;
}
.sortable-data-table-desktop :deep(.primary-cell) {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}
.sortable-data-table-desktop :deep(.primary-cell > [data-row-control]) {
	flex: none;
}
.sortable-data-table-desktop :deep(.primary-cell > [data-row-action]) {
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
	overflow-wrap: anywhere;
}
.sortable-data-table-desktop :deep(.primary-cell .primary-text),
.sortable-data-table-desktop :deep(.primary-cell .secondary-text) {
	display: block;
}
.sortable-data-table-desktop :deep(.primary-cell .secondary-text) {
	color: #6b6257;
	font-size: 0.875em;
}
.sortable-data-table-desktop th button {
	min-height: 36px;
	padding: 6px 8px;
	border: 0;
	background: transparent;
	font: inherit;
	font-size: inherit;
	font-weight: 700;
}
.sortable-data-table-desktop tbody tr {
	cursor: pointer;
	outline: none;
}
.sortable-data-table-desktop tbody tr:hover,
.sortable-data-table-desktop tbody tr:focus-visible,
.sortable-data-table-desktop tbody tr.selected {
	background: #eee8db;
}
.sortable-data-table-desktop tbody tr:focus-visible {
	box-shadow: inset 0 0 0 3px #d99a48;
}
</style>
