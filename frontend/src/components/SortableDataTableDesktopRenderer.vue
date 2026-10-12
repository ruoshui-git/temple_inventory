<script setup lang="ts" generic="TRow extends Record<string, any>">
import type { DataTableColumn, SortState } from "./SortableDataTable.vue";
import {
	useSortableRowInteractions,
	type SortableRowTableProps,
} from "./useSortableRowInteractions";
import UiLoadingBoundary from "./UiLoadingBoundary.vue";

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
	<div class="sortable-data-table-desktop" :aria-busy="loading || loadingMore">
		<UiLoadingBoundary
			:busy="loading"
			:mode="rows.length ? 'refresh' : 'initial'"
			:block-interactions="false"
		>
			<table>
				<thead class="sortable-data-table-head">
					<tr>
						<th
							v-for="column in columns"
							:key="column.key"
							class="sortable-data-table-sticky-head"
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
				<tbody :inert="loading && rows.length ? true : undefined">
					<tr
						v-if="loading && !rows.length"
						class="table-state table-loading"
						aria-hidden="true"
					>
						<td :colspan="columns.length">
							<span aria-hidden="true">正在加载记录</span>
							<div class="table-skeleton" aria-hidden="true">
								<i v-for="index in 3" :key="index"></i>
							</div>
						</td>
					</tr>
					<tr v-else-if="error" class="table-state table-error">
						<td :colspan="columns.length" role="alert">
							<slot name="error">{{ error }}</slot>
						</td>
					</tr>
					<tr v-else-if="!loading && !loadingMore && !rows.length" class="table-state">
						<td :colspan="columns.length">{{ emptyMessage }}</td>
					</tr>
					<tr
						v-for="row in rows"
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
						<td :colspan="columns.length" role="status">
							<span
								class="loading-spinner loading-spinner-small"
								aria-hidden="true"
							></span
							>正在加载更多记录…
						</td>
					</tr>
				</tbody>
			</table>
		</UiLoadingBoundary>
	</div>
</template>

<style scoped>
.sortable-data-table-desktop table {
	width: 100%;
	border-collapse: collapse;
}
.sortable-data-table-desktop {
	position: relative;
}
.table-loading td {
	min-height: 96px;
}
.table-loading-content {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: var(--ti-space-2);
	min-height: 72px;
	font-weight: 700;
}
.table-skeleton {
	display: grid;
	gap: var(--ti-space-2);
	padding: 0 var(--ti-space-4) var(--ti-space-3);
}
.table-skeleton i {
	display: block;
	height: 10px;
	border-radius: var(--ti-radius-control);
	background: linear-gradient(
		90deg,
		var(--ti-accent-soft) 20%,
		var(--ti-surface-raised) 50%,
		var(--ti-accent-soft) 80%
	);
	background-size: 200% 100%;
	animation: table-skeleton 1.2s ease-in-out infinite;
}
.table-skeleton i:nth-child(2) {
	width: 82%;
}
.table-skeleton i:nth-child(3) {
	width: 64%;
}
.loading-spinner-small {
	display: inline-block;
	width: 16px;
	height: 16px;
	margin-right: var(--ti-space-1);
	vertical-align: -3px;
	border-width: 2px;
}
@keyframes table-skeleton {
	to {
		background-position: -200% 0;
	}
}
@media (prefers-reduced-motion: reduce) {
	.sortable-data-table-desktop * {
		animation: none !important;
		transition: none !important;
	}
}
.sortable-data-table-desktop th,
.sortable-data-table-desktop td {
	padding: calc(var(--ti-density-row-gap) * 0.75);
	text-align: left;
	vertical-align: middle;
	border-bottom: 1px solid var(--ti-accent-soft);
}
.sortable-data-table-desktop th,
.sortable-data-table-sticky-head {
	position: sticky;
	top: 0;
	z-index: 2;
	background: var(--ti-surface);
	box-shadow: var(--ti-shadow-card);
}
.sortable-data-table-desktop :deep(.primary-cell) {
	display: flex;
	align-items: center;
	gap: var(--ti-space-2);
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
	color: var(--ti-muted);
	font-size: 0.875em;
}
.sortable-data-table-desktop th button {
	min-height: var(--ti-control-height);
	padding: var(--ti-space-1) var(--ti-space-2);
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
	background: var(--ti-accent-soft);
}
.sortable-data-table-desktop tbody tr:focus-visible {
	box-shadow: var(--ti-focus-ring);
}
</style>
