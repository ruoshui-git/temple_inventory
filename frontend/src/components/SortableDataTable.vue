<script setup lang="ts" generic="TRow extends Record<string, any>">
import { computed, ref } from "vue";
import { useResponsiveLayout, type ResponsiveSurface } from "../composables/useResponsiveLayout";
import SortableDataTableDesktopRenderer from "./SortableDataTableDesktopRenderer.vue";
import SortableDataTableMobileRenderer from "./SortableDataTableMobileRenderer.vue";
import ColumnSummaryDialog, { type ColumnSummary } from "./ColumnSummaryDialog.vue";

export type SortOrder = "asc" | "desc";
export interface DataTableColumn {
	key: string;
	label: string;
	sortable?: boolean;
	initialOrder?: SortOrder;
	headerClass?: string;
	cellClass?: string;
	/** Key in the complete-result column_summaries response. */
	summary?: string;
}
export interface SortState {
	sort_by: string;
	sort_order: SortOrder;
}

const props = withDefaults(
	defineProps<{
		rows: TRow[];
		columns: DataTableColumn[];
		rowKey: string;
		sort: SortState;
		loading?: boolean;
		loadingMore?: boolean;
		error?: string;
		emptyMessage?: string;
		selectionMode?: boolean;
		selectedKeys?: Array<string | number>;
		/** Force one renderer when the parent owns the responsive surface. */
		surface?: ResponsiveSurface;
		columnSummaries?: ColumnSummary;
		showSummary?: boolean;
	}>(),
	{
		selectionMode: false,
		selectedKeys: () => [],
		loading: false,
		loadingMore: false,
		error: "",
		emptyMessage: "暂无记录",
		surface: undefined,
		columnSummaries: () => ({}),
		showSummary: true,
	},
);
const summaryOpen = ref(false);
const emit = defineEmits<{
	sort: [state: SortState];
	activate: [row: TRow];
	toggle: [row: TRow];
}>();
const { surface: responsiveSurface } = useResponsiveLayout(props.surface === undefined);
const resolvedSurface = computed<ResponsiveSurface>(
	() => props.surface || responsiveSurface.value,
);
</script>

<template>
	<div
		class="sortable-data-table"
		:data-surface="resolvedSurface"
		:aria-busy="loading || loadingMore"
	>
		<div v-if="showSummary" class="sortable-data-table-toolbar">
			<button type="button" class="column-summary-trigger" @click="summaryOpen = true">
				Σ <span>列汇总</span>
			</button>
		</div>
		<ColumnSummaryDialog
			v-model:open="summaryOpen"
			:columns="columns"
			:summaries="columnSummaries"
			:loading="loading"
		/>
		<SortableDataTableDesktopRenderer
			v-if="resolvedSurface === 'desktop'"
			:rows="rows"
			:columns="columns"
			:row-key="rowKey"
			:sort="sort"
			:loading="loading"
			:loading-more="loadingMore"
			:error="error"
			:empty-message="emptyMessage"
			:selection-mode="selectionMode"
			:selected-keys="selectedKeys"
			@sort="emit('sort', $event)"
			@activate="emit('activate', $event)"
			@toggle="emit('toggle', $event)"
		>
			<template v-for="(_, name) in $slots" #[name]="slotProps">
				<slot :name="name" v-bind="slotProps || {}" />
			</template>
		</SortableDataTableDesktopRenderer>
		<SortableDataTableMobileRenderer
			v-else
			:rows="rows"
			:columns="columns"
			:row-key="rowKey"
			:sort="sort"
			:loading="loading"
			:loading-more="loadingMore"
			:error="error"
			:empty-message="emptyMessage"
			:selection-mode="selectionMode"
			:selected-keys="selectedKeys"
			@sort="emit('sort', $event)"
			@activate="emit('activate', $event)"
			@toggle="emit('toggle', $event)"
		>
			<template v-for="(_, name) in $slots" #[name]="slotProps">
				<slot :name="name" v-bind="slotProps || {}" />
			</template>
		</SortableDataTableMobileRenderer>
	</div>
</template>

<style scoped>
.sortable-data-table {
	min-width: 0;
}
.sortable-data-table[aria-busy="true"] {
	position: relative;
}
.sortable-data-table-toolbar {
	display: flex;
	justify-content: flex-end;
	min-height: 0;
	margin: 0 0 6px;
}
.column-summary-trigger {
	min-height: 36px;
	padding: 6px 10px;
	border: 1px solid #ded6ca;
	border-radius: 7px;
	background: #fff;
	color: #634d35;
	font-weight: 650;
}
@media (max-width: 1023px) {
	.column-summary-trigger {
		width: 38px;
		padding: 6px 0;
	}
	.column-summary-trigger span {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
}
</style>
