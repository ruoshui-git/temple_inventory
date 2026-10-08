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
const { valueFor, isSelected, activate, activateKey, action } = useSortableRowInteractions(props, {
	sort: (state) => emit("sort", state),
	activate: (row) => emit("activate", row),
	toggle: (row) => emit("toggle", row),
});
</script>

<template>
	<div
		class="sortable-data-table-mobile"
		:class="{ 'is-refreshing': loading && rows.length }"
		:aria-busy="loading || loadingMore"
	>
		<div v-if="loading && rows.length" class="mobile-refresh-overlay" role="status">
			<span class="loading-spinner" aria-hidden="true"></span>正在更新记录…
		</div>
		<div
			v-if="loading && !rows.length"
			class="mobile-loading mobile-initial-loading"
			role="status"
		>
			<span class="loading-spinner" aria-hidden="true"></span><b>正在加载记录…</b
			><i v-for="index in 3" :key="index"></i>
		</div>
		<div v-else-if="error" class="mobile-loading table-error" role="alert">
			<slot name="error">{{ error }}</slot>
		</div>
		<div v-else-if="!loading && !loadingMore && !rows.length && !error" class="mobile-loading">
			{{ emptyMessage }}
		</div>
		<template v-if="rows.length"
			><div
				v-for="row in rows"
				:key="String(valueFor(row))"
				class="sortable-mobile-row"
				:class="{ selected: isSelected(row), cancelled: row.docstatus === 2 }"
				@click="activate(row, $event)"
				@keydown="activateKey(row, $event)"
			>
				<slot
					name="mobile-row"
					:row="row"
					:selected="isSelected(row)"
					:activate="(event: Event) => activate(row, event)"
					:activate-key="(event: KeyboardEvent) => activateKey(row, event)"
					:action="(event: MouseEvent) => action(event, row)"
					><article tabindex="0">
						<span v-for="column in columns" :key="column.key"
							><b>{{ column.label }}</b> {{ row[column.key] }}</span
						>
					</article>
				</slot>
			</div></template
		>
		<div v-if="loadingMore" class="mobile-loading" role="status">
			<span class="loading-spinner loading-spinner-small" aria-hidden="true"></span
			>正在加载更多记录…
		</div>
	</div>
</template>

<style scoped>
.sortable-data-table-mobile :deep(article) {
	display: grid;
	gap: 6px;
	padding: 14px;
	border-radius: 10px;
	cursor: pointer;
	outline: none;
}
.sortable-data-table-mobile {
	position: relative;
}
.sortable-data-table-mobile.is-refreshing > :not(.mobile-refresh-overlay) {
	opacity: 0.55;
	pointer-events: none;
}
.mobile-refresh-overlay {
	position: absolute;
	inset: 0;
	z-index: 3;
	display: flex;
	align-items: flex-start;
	justify-content: center;
	gap: 8px;
	padding-top: 18px;
	background: rgb(255 253 249 / 55%);
	color: #704d2e;
	font-weight: 700;
	pointer-events: none;
}
.mobile-initial-loading {
	display: grid;
	justify-items: center;
	gap: 10px;
	min-height: 150px;
	font-weight: 700;
}
.mobile-initial-loading i {
	display: block;
	width: min(92%, 360px);
	height: 34px;
	border-radius: 8px;
	background: #f0ebe3;
}
.mobile-initial-loading i + i {
	opacity: 0.7;
}
.loading-spinner-small {
	display: inline-block;
	width: 16px;
	height: 16px;
	margin-right: 6px;
	vertical-align: -3px;
	border-width: 2px;
}
@media (prefers-reduced-motion: reduce) {
	.sortable-data-table-mobile * {
		animation-duration: 0.01ms !important;
		transition-duration: 0.01ms !important;
	}
}
.sortable-mobile-row {
	outline: none;
}
.sortable-data-table-mobile :deep(article:hover),
.sortable-data-table-mobile :deep(article:focus-visible),
.sortable-mobile-row.selected > * {
	background: #eee8db;
}
.sortable-data-table-mobile :deep(article:focus-visible) {
	box-shadow: inset 0 0 0 3px #d99a48;
}
</style>
