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
	<div class="sortable-data-table-mobile">
		<div v-if="loading" class="mobile-loading" role="status">正在更新记录…</div>
		<div v-else-if="error" class="mobile-loading table-error" role="alert">
			<slot name="error">{{ error }}</slot>
		</div>
		<div v-else-if="!rows.length" class="mobile-loading">{{ emptyMessage }}</div>
		<template v-else
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
		<div v-if="loadingMore" class="mobile-loading" role="status">正在加载更多记录…</div>
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
