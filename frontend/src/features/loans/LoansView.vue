<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import type { ResponsiveSurface } from "../../composables/useResponsiveLayout";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import SortableDataTable, { type SortState } from "../../components/SortableDataTable.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import CategorySelector from "../../components/CategorySelector.vue";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import ItemImagePreview from "../../components/ItemImagePreview.vue";
import IconButton from "../../components/IconButton.vue";
import UiButton from "../../components/UiButton.vue";
import QuantitySummary from "../../components/QuantitySummary.vue";
import MovementLookup from "../../components/MovementLookup.vue";
import CompactFilterSection from "../../components/CompactFilterSection.vue";
import FloatingActionMenu from "../../components/FloatingActionMenu.vue";
import PageActionMenu from "../../components/PageActionMenu.vue";
import ResultCountStrip from "../../components/ResultCountStrip.vue";
import { type LoansController } from "./useLoansController";

const props = defineProps<{
	controller: LoansController;
	surface: ResponsiveSurface;
}>();
const {
	scrollResetToken,
	boot,
	activities,
	activityQuery,
	rows,
	total,
	quantityTotals,
	columnSummaries,
	error,
	loading,
	loadingMore,
	filterOpen,
	desktopFilterOpen,
	filters,
	status,
	sort,
	columns,
	statusLabel,
	summaryMetrics,
	formatQuantities,
	activityOptions,
	activeCount,
	chips,
	load,
	scheduleLoad,
	removeChip,
	clearFilters,
	openLoan,
	createLoan,
	createReturn,
	pageActions,
	appendError,
	overall,
	facets,
} = props.controller;
const surface = toRef(props, "surface");
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
const pageActionsDisabled = () =>
	pageActions.value.length > 0 &&
	pageActions.value.every((action) => action.disabled || action.loading);
function selectPageAction(kind: string) {
	return kind === "Return" ? createReturn() : createLoan();
}
const resultsScroll = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
const infiniteScroll = useInfiniteScroll({
	hasMore: () => rows.value.length < total.value,
	isLoading: () => loading.value || loadingMore.value,
	onLoadMore: () => load(true),
});
onMounted(async () => {
	await nextTick();
	infiniteScroll.connect(resultsScroll.value, sentinel.value);
});
watch(scrollResetToken, async () => {
	await nextTick();
	resultsScroll.value?.scrollTo?.({ top: 0 });
});
onBeforeUnmount(() => infiniteScroll.disconnect());
</script>

<template>
	<section class="app-shell wide-shell viewport-list-root">
		<div
			class="list-layout desktop-list-layout compact-filter-layout"
			:class="{ 'filters-open': desktopFilterOpen }"
		>
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="activeCount"
				:show-trigger="false"
				clearable
				@clear="clearFilters"
			>
				<CompactFilterSection title="借出日期" icon="calendar" :collapsible="false">
					<fieldset>
						<input v-model="filters.loan_date" type="date" aria-label="借出日期" />
					</fieldset>
				</CompactFilterSection>
				<CompactFilterSection title="原始借出位置" icon="warehouse">
					<WarehouseSelector
						v-model="filters.warehouses"
						:rows="boot?.physical_tree || []"
						:counts="facets.warehouses"
						embedded
						placeholder="原始借出位置"
					/>
				</CompactFilterSection>
				<CompactFilterSection title="物品类别" icon="card">
					<CategorySelector
						v-model="filters.item_groups"
						:rows="boot?.item_groups || []"
						:counts="facets.item_groups"
						embedded
						placeholder="物品类别"
					/>
				</CompactFilterSection>
				<CompactFilterSection title="相关活动" icon="calendar">
					<label
						><span class="sr-only">相关活动</span
						><MovementLookup
							v-model="filters.activity"
							v-model:query="activityQuery"
							:options="activityOptions"
							placeholder="搜索活动"
							aria-label="搜索活动"
							@update:query="activityQuery = String($event || '')"
					/></label>
				</CompactFilterSection>
			</ResponsiveFilterPanel>
			<div class="results-column">
				<div class="results-chrome">
					<div class="loans-heading">
						<h1>{{ status === "settled" ? "已结借用" : "未结借用" }}</h1>
						<PageActionMenu
							v-if="surface === 'desktop' && pageActions.length"
							:actions="pageActions"
							:disabled="pageActionsDisabled()"
							label="新增借用记录"
							@select="selectPageAction"
						/>
					</div>
					<div class="result-toolbar">
						<input
							v-model="filters.search"
							type="search"
							placeholder="搜索借用方、记录、活动或物品"
							aria-label="搜索借用记录"
						/><UiButton
							v-if="surface === 'desktop'"
							variant="secondary"
							size="compact"
							type="button"
							class="toolbar-action desktop-filter-button"
							:aria-expanded="desktopFilterOpen"
							@click="openFilters($event)"
						>
							筛选<span v-if="activeCount" class="filter-count">{{
								activeCount
							}}</span></UiButton
						><IconButton
							v-if="surface === 'mobile'"
							class="mobile-filter-button"
							:label="activeCount ? `筛选，已启用 ${activeCount} 项` : '筛选'"
							title="筛选"
							@click="openFilters($event)"
							><svg aria-hidden="true" viewBox="0 0 24 24">
								<path d="M4 6h16M7 12h10M10 18h4" /></svg
							><span v-if="activeCount" class="icon-count">{{
								activeCount
							}}</span></IconButton
						>
					</div>
					<div class="browse-result-meta">
						<ActiveFilterChips
							:chips="chips"
							@remove="removeChip"
							@clear="clearFilters"
						/>
						<ResultCountStrip
							:loaded="rows.length"
							:filtered="total"
							:overall="overall ?? total"
							:updating="loading && rows.length > 0"
						/>
					</div>
					<QuantitySummary :metrics="summaryMetrics" :loading="loading" />
				</div>
				<div ref="resultsScroll" class="results-scroll">
					<SortableDataTable
						:surface="surface"
						:rows="rows"
						:columns="columns"
						:column-summaries="columnSummaries"
						row-key="name"
						:sort="sort"
						:loading="loading"
						:loading-more="loadingMore"
						:error="error"
						empty-message="没有符合条件的借用记录"
						@sort="sort = $event"
						@activate="(row) => openLoan(row.name)"
					>
						<template #error
							>{{ error }}
							<UiButton variant="ghost" size="compact" type="button" @click="load()"
								>重试</UiButton
							></template
						>
						<template #cell-activity_title="{ row }">{{
							row.activity_title || row.activity || "—"
						}}</template>
						<template #cell-loan_status="{ row }">{{
							statusLabel(row.loan_status)
						}}</template>
						<template #cell-loaned_qty="{ row }">{{
							formatQuantities(row.loaned_qty)
						}}</template>
						<template #cell-outstanding_qty="{ row }">{{
							formatQuantities(row.outstanding_qty)
						}}</template>
						<template #mobile-row="{ row }"
							><article class="result-card" tabindex="0">
								<RouterLink
									data-row-action
									class="loan-mobile-card"
									:to="'/loans/' + encodeURIComponent(row.name)"
									><header class="loan-mobile-heading">
										<b>{{ row.borrower }}</b>
										<span>{{ statusLabel(row.loan_status) }}</span>
									</header>
									<small class="loan-mobile-context"
										>{{ row.loan_date }} ·
										{{ row.activity_title || row.activity || "无活动" }} · 物品
										{{ row.line_count }} 行</small
									>
									<div class="loan-mobile-items">
										<span
											v-for="item in row.items || []"
											:key="item.loan_item"
										>
											<ItemImagePreview
												:src="item.image"
												:alt="item.item_name"
											/>
											<span
												><b>{{ item.item_name }}</b
												><small
													>未归还 {{ item.outstanding }}
													{{ item.uom }}</small
												></span
											>
										</span>
									</div>
									<footer class="loan-mobile-quantities">
										<span
											><small>借出</small
											>{{ formatQuantities(row.loaned_qty) }}</span
										>
										<span
											><small>未归还 · {{ row.outstanding_lines }} 行</small
											>{{ formatQuantities(row.outstanding_qty) }}</span
										>
									</footer></RouterLink
								>
							</article></template
						>
					</SortableDataTable>
					<div ref="sentinel" aria-hidden="true"></div>
					<div v-if="appendError" class="table-append-error" role="alert">
						{{ appendError }}
						<UiButton variant="ghost" size="compact" type="button" @click="load(true)">
							重试
						</UiButton>
					</div>
				</div>
			</div>
		</div>
		<FloatingActionMenu
			v-if="surface === 'mobile' && pageActions.length"
			:actions="pageActions"
			:disabled="pageActions.every((action) => action.disabled || action.loading)"
			label="新建借出"
			@select="selectPageAction"
		/>
	</section>
</template>

<style scoped>
.loans-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}
.loans-heading h1 {
	margin: 0;
}
:deep(.filter-sidebar) {
	background: #f7f5ef;
	box-shadow: none;
}
:deep(.filter-drawer-header) {
	background: #f7f5ef;
}
:deep(.compact-filter-section) {
	background: transparent;
}
.browse-result-meta {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
}
.browse-result-meta :deep(.active-filter-chips) {
	min-width: 0;
	flex: 1;
	margin: 10px 0 16px;
}
.browse-result-meta :deep(.result-count-strip) {
	flex: none;
	margin-left: auto;
}
.loan-mobile-card,
.loan-mobile-items,
.loan-mobile-quantities {
	display: grid;
	gap: 10px;
}
.loan-mobile-heading,
.loan-mobile-quantities > span,
.loan-mobile-items > span,
.loan-mobile-items > span > span {
	display: flex;
	align-items: center;
}
.loan-mobile-heading {
	justify-content: space-between;
	gap: 12px;
}
.loan-mobile-heading > span {
	color: #805022;
	font-size: 12px;
	font-weight: 700;
}
.loan-mobile-context,
.loan-mobile-items small,
.loan-mobile-quantities small {
	color: #6b6257;
}
.loan-mobile-items {
	padding-block: 8px;
	border-block: 1px solid #eee5da;
}
.loan-mobile-items > span {
	gap: 9px;
}
.loan-mobile-items > span > span {
	min-width: 0;
	flex: 1;
	align-items: flex-start;
	flex-direction: column;
}
.loan-mobile-quantities {
	grid-template-columns: repeat(2, minmax(0, 1fr));
}
.loan-mobile-quantities > span {
	align-items: flex-start;
	flex-direction: column;
}
@media (max-width: 1023px) {
	.browse-result-meta {
		flex-wrap: wrap;
	}
	.browse-result-meta :deep(.result-count-strip) {
		width: 100%;
		justify-content: flex-end;
	}
}
</style>
