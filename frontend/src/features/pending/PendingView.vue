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
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import { removeGroupByField } from "../../lib/groupBy";
import { groupLabels, sortableColumnsForView } from "../../lib/reportContract";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import QuickExport from "../../components/QuickExport.vue";
import PopupMenu from "../../components/ui/PopupMenu.vue";
import FilterRailEdge from "../../components/ui/FilterRailEdge.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import { kindIcons } from "../../lib/kindIcons";
const props = withDefaults(defineProps<{ controller: PendingController; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	item: [code: string];
	operation: [kind: "Repair" | "Disposal", allocation: InitialAllocation];
	openExport: [query: ReportQuery];
}>();
const c = props.controller,
	{ query, scope, scopeChips, chips, routeError, metrics, analysisOpen, dimension } = c;
const table = c.report.mainTable,
	analysisTable = c.analysis.mainTable;
const {
	open: filterOpen,
	toggle: toggleFilter,
	saveError: filterSaveError,
	retry: retryFilterSave,
} = useFilterRailPreference("stock.damaged", c.reference, true);
const { isMobile } = useResponsiveLayout();
const filterSheetOpen = ref(false);
const sortColumns = computed(() => sortableColumnsForView(query.value.dataset, query.value.view));
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
			><template #actions
				><QuickExport
					v-if="!routeError"
					:query="query"
					:active="active"
					@open-full="emit('openExport', $event)"
			/></template>
			<template #filters>
				<BrowseFilters
					v-model="scope"
					disclosure-mode
					:fields="['item', 'categories', 'warehouses']"
					:hierarchy-in-rail="filterOpen && !isMobile"
					hide-activity
				/>
				<div data-filter-field="groupBy" tabindex="-1">
					<GroupByFilter
						v-model="query.groupBy"
						:dataset="query.dataset"
						:view="query.view"
					/>
				</div>
				<UiButton @click="c.clear">清空筛选</UiButton>
			</template>
			<div class="browse-callout damaged-callout">
				<span class="browse-callout-icon"><InventoryIcon name="warning" /></span>
				<span>损坏物资待处理：明细均位于“损坏待处理”位置，可修复归库或正式报废。</span>
				<b v-if="table?.initialized">{{ c.report.result.total }} 条明细</b>
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
			</template>
		</BrowseToolbar>
		<SkeletonBlock
			v-if="c.report.result.loading && !table?.initialized"
			variant="list"
			:rows="5"
		/>
		<p
			v-if="c.report.result.stale && c.report.result.error && !c.report.result.loading"
			class="notice-bar warning"
			role="status"
		>
			上次结果 · 尚未更新。
		</p>
		<p v-if="c.report.result.error" role="alert">
			{{ c.report.result.error }} <UiButton @click="c.report.refresh(true)">重试</UiButton>
		</p>

		<BrowseResultSummary
			:label="`${c.report.result.total} 条存放明细`"
			:metrics="metrics"
			:loading="c.report.result.loading"
		>
			<template #controls>
				<UiButton :disabled="!table?.initialized" @click="analysisOpen = true"
					>分析结果</UiButton
				>
			</template>
		</BrowseResultSummary>
		<div class="preview-browse-body">
			<aside v-if="filterOpen && !isMobile" class="preview-filter-rail browse-filter-rail">
				<div class="filter-rail-heading">
					<h3>筛选待处理</h3>
					<FilterRailEdge
						:open="true"
						:active="scope.categories.length + scope.warehouses.length > 0"
						@toggle="toggleFilter"
					/>
				</div>
				<BrowseFilters
					v-model="scope"
					:fields="['categories', 'warehouses']"
					hide-activity
				/>
			</aside>
			<FilterRailEdge
				v-if="!filterOpen && !isMobile"
				:open="false"
				:active="scope.categories.length + scope.warehouses.length > 0"
				@toggle="toggleFilter"
			/>
			<div class="preview-browse-results surface damaged-results-card">
				<ReportTable
					v-if="table"
					sticky-actions
					:preference-id="`pending.${query.dataset}.${query.view}.${table.id}`"
					:table="table"
					:hidden-columns="['warehouse_label', 'warehouse']"
					:total="table.total"
					:loading="table.loading"
					:initialized="table.initialized"
					:error="table.error"
					:stale="c.report.result.stale"
					:sortable-columns="sortColumns"
					:sort-by="query.sortBy"
					:sort-direction="query.sort"
					:grouped="query.groupBy.length > 0"
					:group-pages="c.report.groups"
					@load-more="c.report.loadTable(table, true)"
					@sort="sortReport"
					@retry="
						c.report.loadTable(table, table.initialized && table.next !== null, true)
					"
				>
					<template #actions="{ row }">
						<div class="browse-row-actions damaged-row-actions">
							<UiButton
								v-if="c.canAct('Repair', row as ReportRow)"
								variant="secondary"
								:icon="kindIcons.Repair.icon"
								@click="
									emit('operation', 'Repair', c.allocation(row as ReportRow))
								"
								>修复归库</UiButton
							>
							<UiButton
								v-if="c.canAct('Disposal', row as ReportRow)"
								variant="ghost"
								class="damaged-disposal-button"
								:icon="kindIcons.Disposal.icon"
								@click="
									emit('operation', 'Disposal', c.allocation(row as ReportRow))
								"
								>报废</UiButton
							>
							<PopupMenu label="更多损坏物品操作" align="end">
								<UiButton
									:disabled="c.report.result.stale"
									icon="box"
									@click="emit('item', String(row.item_code))"
									>物品详情</UiButton
								>
								<QuickExport
									:disabled="c.report.result.stale"
									:query="c.rowQuery(row as ReportRow)"
									:active="active"
									@open-full="emit('openExport', $event)"
								/>
							</PopupMenu>
						</div>
					</template>
				</ReportTable>

				<Overlay
					v-if="analysisOpen"
					title="分析当前结果"
					adaptive-creation
					@close="analysisOpen = false"
				>
					<label class="preview-field"
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
