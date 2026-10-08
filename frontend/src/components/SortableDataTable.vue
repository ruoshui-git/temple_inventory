<script setup lang="ts" generic="TRow extends Record<string, any>">
import { computed } from "vue";
import { useResponsiveLayout, type ResponsiveSurface } from "../composables/useResponsiveLayout";
import SortableDataTableDesktopRenderer from "./SortableDataTableDesktopRenderer.vue";
import SortableDataTableMobileRenderer from "./SortableDataTableMobileRenderer.vue";

export type SortOrder = "asc" | "desc";
export interface DataTableColumn {
	key: string;
	label: string;
	sortable?: boolean;
	initialOrder?: SortOrder;
	headerClass?: string;
	cellClass?: string;
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
	}>(),
	{
		selectionMode: false,
		selectedKeys: () => [],
		loading: false,
		loadingMore: false,
		error: "",
		emptyMessage: "暂无记录",
		surface: undefined,
	},
);
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
	<div class="sortable-data-table" :data-surface="resolvedSurface">
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
</style>
