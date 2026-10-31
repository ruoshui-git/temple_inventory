<script setup lang="ts">
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { useFilterRailPreference } from "../../composables/useFilterRailPreference";
import { computed, ref, watch } from "vue";
import type { PendingController } from "./usePendingController";
import type { InitialAllocation } from "../../lib/routeSelection";
import type { ReportQuery, ReportRow } from "../../lib/reportContract";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import ItemStatusFilter from "../../components/filters/ItemStatusFilter.vue";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import { removeGroupByField } from "../../lib/groupBy";
import { groupLabels, sortableColumnsForView } from "../../lib/reportContract";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import DataTable from "../../components/ui/DataTable.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import QuickExport from "../../components/QuickExport.vue";
import FilterRailEdge from "../../components/ui/FilterRailEdge.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import BrowseRefreshNotice from "../../components/ui/BrowseRefreshNotice.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import { kindIcons } from "../../lib/kindIcons";
import { reportExportColumns } from "../../lib/reportExportColumns";
import { useOptionalInventoryServices } from "../../services/contracts";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { exportFields } from "../../lib/exportColumns";
import type { DataColumn, DataTableEntry } from "../../lib/dataTable";
import { RouterLink } from "vue-router";
import { routeTarget } from "../../lib/routeRegistry";
import UnitText from "../../components/ui/UnitText.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
const props = withDefaults(defineProps<{ controller: PendingController; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	item: [code: string];
	operation: [kind: "Repair" | "Disposal", allocations: InitialAllocation[]];
	openExport: [query: ReportQuery];
}>();
const c = props.controller,
	{ query, scope, scopeChips, chips, routeError, metrics, analysisOpen, dimension, reference } =
		c;
const table = c.report.mainTable,
	analysisTable = c.analysis.mainTable;
const reportColumns = computed<DataColumn[]>(() =>
	table.value
		? reportExportColumns(table.value, query.value.dataset, [
				"warehouse_label",
				"warehouse",
			]).map((column) => ({
				...column,
				pinned: column.id === "item_name" ? "start" : column.pinned,
			}))
		: [],
);
const exportServices = useOptionalInventoryServices();
const reportPrefs = exportServices
	? useColumnPreferences(
			computed(
				() =>
					`pending.${query.value.dataset}.${query.value.view}.${table.value?.id || ""}`,
			),
			reportColumns,
			c.reference,
			exportServices,
		)
	: undefined;
const exportColumns = computed(() => {
	if (!table.value) return undefined;
	const columns = reportColumns.value;
	const visible = reportPrefs?.visible.value.length
		? reportPrefs.visible.value
		: columns
				.filter((column) => column.defaultVisible !== false || column.required)
				.map((column) => String(column.id));
	const order = reportPrefs?.order.value.length
		? reportPrefs.order.value
		: columns.map((column) => String(column.id));
	return exportFields(columns, order, visible);
});
const {
	open: filterOpen,
	toggle: toggleFilter,
	saveError: filterSaveError,
	retry: retryFilterSave,
} = useFilterRailPreference("stock.damaged", c.reference, true);
const { isMobile } = useResponsiveLayout();
const filterSheetOpen = ref(false);
const sortColumns = computed(() => sortableColumnsForView(query.value.dataset, query.value.view));
const pendingRows = computed<DataTableEntry[]>(() =>
	query.value.groupBy.length
		? c.report.groups.entries.value
		: (table.value?.rows || []).map((row) => ({
				kind: "record",
				id: String(row.id),
				value: row as unknown as Record<string, unknown>,
			})),
);
const selectedAllocations = computed(() =>
	(table.value?.rows || []).filter((row) => c.selected.value.includes(String(row.id))),
);
function bulkOperation(kind: "Repair" | "Disposal") {
	emit(
		"operation",
		kind,
		selectedAllocations.value.map((row) => c.allocation(row)),
	);
}
function sortReport(field: string) {
	if (!sortColumns.value.includes(field)) return;
	if (query.value.sortBy === field)
		query.value.sort = query.value.sort === "asc" ? "desc" : "asc";
	else {
		query.value.sortBy = field;
		query.value.sort = "asc";
	}
}
watch([() => props.active, isMobile], () => {
	analysisOpen.value = false;
});
</script>
<template>
	<ReturnToTop :active="active" :hidden="isMobile && filterSheetOpen" />
	<section class="browse-page damaged-page">
		<BrowseToolbar
			class="damaged-browse-toolbar"
			title="损坏待处理"
			:summary="table?.initialized ? `损坏待处理 · ${c.report.result.total} 条明细` : ''"
			v-model:search="query.search"
			search-label="搜索物品、批次或存放位置"
			:active="active"
			:sidebar-open="filterOpen"
			:sidebar-save-error="filterSaveError"
			:retry-sidebar-save="retryFilterSave"
			@filter-open="filterSheetOpen = $event"
			sidebar-available
			:filter-count="scopeChips.length + chips.filter((chip) => !chip.fixed).length"
		>
			<template #actions>
				<BrowseOverflowMenu>
					<UiButton
						v-if="isMobile"
						icon="select"
						:aria-pressed="c.selecting.value"
						@click="c.selecting.value ? c.exitSelection() : c.enterSelection()"
						>{{ c.selecting.value ? "取消选择" : "选择" }}</UiButton
					>
					<QuickExport
						v-if="!routeError"
						:query="query"
						:table="table?.id"
						:columns="exportColumns"
						title="待处理"
						:active="active"
					/>
				</BrowseOverflowMenu>
				<UiButton
					v-if="!isMobile"
					icon="select"
					:aria-pressed="c.selecting.value"
					@click="c.selecting.value ? c.exitSelection() : c.enterSelection()"
					>{{ c.selecting.value ? "取消选择" : "选择" }}</UiButton
				>
			</template>
			<template #selection>
				<div
					v-if="c.selecting.value"
					class="selection-bar stock-selection-actions"
					role="region"
					aria-label="损坏物资批量操作"
				>
					<span role="status">已选择 {{ c.selected.value.length }} 项</span>
					<UiButton
						v-for="action in [
							{ kind: 'Repair', label: '修复归库' },
							{ kind: 'Disposal', label: '报废' },
						]"
						:key="action.kind"
						:disabled="
							!selectedAllocations.length ||
							c.report.result.stale ||
							reference.operations[action.kind] !== true
						"
						:title="
							!selectedAllocations.length
								? '请先选择损坏明细'
								: reference.operations[action.kind] !== true
									? '当前账户不可执行此操作'
									: ''
						"
						@click="bulkOperation(action.kind as 'Repair' | 'Disposal')"
						>{{ action.label }}</UiButton
					>
					<UiButton variant="ghost" @click="c.exitSelection()">取消</UiButton>
				</div>
			</template>
			<template #filters>
				<BrowseFilters
					v-model="scope"
					disclosure-mode
					:fields="['item', 'categories', 'tracking', 'warehouses']"
					:hierarchy-in-rail="filterOpen && !isMobile"
					hide-activity
				/>
				<ItemStatusFilter v-model="query.itemStatus" />
				<div data-filter-field="groupBy" tabindex="-1">
					<GroupByFilter
						v-model="query.groupBy"
						:dataset="query.dataset"
						:view="query.view"
					/>
				</div>
				<UiButton @click="c.clear">清空筛选</UiButton>
			</template>
			<div class="notice-bar">
				<InventoryIcon name="info" />
				<span>损坏物资待处理：明细均位于“损坏待处理”位置，可修复归库或正式报废。</span>
			</div>
			<p v-if="routeError" role="alert">{{ routeError }}</p>
			<template #chips="{ editFilter }">
				<BrowseChip
					v-for="(group, index) in query.groupBy"
					:key="`group:${group}`"
					:label="`分组：${groupLabels[group] || group}`"
					@edit="editFilter('groupBy')"
					@remove="
						query.groupBy = removeGroupByField(
							query.dataset,
							query.view,
							query.groupBy,
							index,
						)
					"
				/>
				<BrowseChip
					v-for="chip in scopeChips"
					:key="chip.key"
					:label="chip.label"
					@edit="editFilter(chip.field)"
					@remove="c.removeScope(chip.field)"
				/>
				<BrowseChip
					v-for="chip in chips"
					:key="chip.key"
					:label="chip.summary || chip.label"
					:removable="!chip.fixed"
					@edit="editFilter(chip.field)"
					@remove="Object.assign(query, chip.reset)"
				/>
				<UiButton
					v-if="query.groupBy.length || scopeChips.length || chips.length"
					variant="ghost"
					@click="c.reset"
					>清除全部</UiButton
				>
			</template>
		</BrowseToolbar>
		<SkeletonBlock
			v-if="c.report.result.loading && !table?.initialized"
			variant="list"
			:rows="5"
		/>
		<BrowseRefreshNotice
			:show="c.report.result.refreshFailed"
			:retry="() => c.report.refresh(true)"
		/>
		<p v-if="c.report.result.error && !c.report.result.refreshFailed" role="alert">
			{{ c.report.result.error }} <UiButton @click="c.report.refresh(true)">重试</UiButton>
		</p>

		<BrowseResultSummary
			:label="`${c.report.result.total} 条存放明细`"
			:metrics="metrics"
			:loading="c.report.result.loading && !table?.initialized"
		>
			<template #controls>
				<UiButton :disabled="!table?.initialized" @click="analysisOpen = true"
					>分析结果</UiButton
				>
			</template>
		</BrowseResultSummary>
		<div class="browse-body">
			<aside v-if="filterOpen && !isMobile" class="browse-filter-rail browse-filter-rail">
				<div class="filter-rail-heading">
					<h3>筛选待处理</h3>
					<FilterRailEdge
						:open="true"
						:active="
							scope.categories.length + scope.warehouses.length > 0 ||
							scope.tracking !== 'all'
						"
						@toggle="toggleFilter"
					/>
				</div>
				<BrowseFilters
					v-model="scope"
					:fields="['categories', 'tracking', 'warehouses']"
					hide-activity
				/>
			</aside>
			<FilterRailEdge
				v-if="!filterOpen && !isMobile"
				:open="false"
				:active="
					scope.categories.length + scope.warehouses.length > 0 ||
					scope.tracking !== 'all'
				"
				@toggle="toggleFilter"
			/>
			<div class="browse-results surface damaged-results-card">
				<DataTable
					v-if="table"
					data-browse-scroll="damaged-table"
					ariaLabel="损坏待处理明细"
					table-class="browse-table"
					:columns="
						reportColumns.filter(
							(column) =>
								!['warehouse_label', 'warehouse'].includes(String(column.id)),
						)
					"
					:rows="pendingRows"
					:column-preferences="reportPrefs"
					:selection-enabled="c.selecting.value"
					:selected-keys="c.selected.value"
					:sort-by="query.sortBy"
					:sort-direction="query.sort"
					:loading="table.loading"
					:initialized="table.initialized"
					:error="table.error"
					:stale="c.report.result.stale"
					:has-more="table.next !== null"
					:loaded-count="table.rows.length"
					:total-count="table.total"
					@select="c.setSelected"
					@select-visible="
						(keys, checked) => keys.forEach((key) => c.setSelected(key, checked))
					"
					@sort="sortReport"
					@toggle-group="c.report.groups.toggleGroup"
					@load-more="c.report.loadTable(table, true)"
					@retry="
						c.report.loadTable(table, table.initialized && table.next !== null, true)
					"
				>
					<template #group-label="{ group }">{{ group.label }}</template>
					<template #cell="{ column, row, value }">
						<RouterLink
							v-if="column.id === 'item_name' && row.item_code"
							class="browse-row-link"
							:to="routeTarget('item-detail', { code: String(row.item_code) })"
							>{{ value }}</RouterLink
						>
						<UnitText
							v-else-if="column.kind === 'unit'"
							:name="row.stock_uom"
							:qty="Number(value || 0)"
						/>
						<template v-else>{{ value }}</template>
					</template>
				</DataTable>

				<Overlay
					v-if="analysisOpen"
					title="分析当前结果"
					adaptive-creation
					@close="analysisOpen = false"
				>
					<label class="form-field"
						>分析维度<select v-model="dimension">
							<option value="category">类别</option>
							<option value="location">位置</option>
						</select></label
					>
					<SkeletonBlock
						v-if="
							c.analysis.result.loading && !c.analysis.mainTable.value?.initialized
						"
						variant="lines"
						:count="4"
					/>
					<p v-if="c.analysis.result.error" role="alert">
						{{ c.analysis.result.error }}
						<UiButton @click="c.analysis.refresh">重试分析</UiButton>
					</p>
					<ReportTable
						v-if="analysisTable && !c.analysis.result.stale"
						:preference-id="`pending.analysis.${dimension}`"
						:table="{
							...analysisTable,
							columns: [
								dimension === 'location' ? 'warehouse' : 'category',
								'stock_uom',
								'item_count',
								'allocation_count',
								'damaged',
							],
						}"
						:total="analysisTable.total"
						:loading="analysisTable.loading"
						:initialized="analysisTable.initialized"
						:error="analysisTable.error"
						@load-more="c.analysis.loadTable(analysisTable, true)"
						@retry="c.analysis.loadTable(analysisTable, true)"
					/>
				</Overlay>
			</div>
		</div>
	</section>
</template>
