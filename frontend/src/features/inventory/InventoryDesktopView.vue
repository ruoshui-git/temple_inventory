<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import "./inventory-surface.css";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import ItemImagePreview from "../../components/ItemImagePreview.vue";
import SortableDataTable from "../../components/SortableDataTable.vue";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import QuantitySummary from "../../components/QuantitySummary.vue";
import InventoryCardGrid from "../../components/InventoryCardGrid.vue";
import DetailPopover from "../../components/DetailPopover.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import InventoryFilterPanel from "../../components/InventoryFilterPanel.vue";
import ColumnSummaryDialog from "../../components/ColumnSummaryDialog.vue";
import { type InventoryController } from "./useInventoryController";

const props = defineProps<{ controller: InventoryController }>();
const {
	scrollResetToken,
	boot,
	rows,
	total,
	overall,
	facetCounts,
	columnSummaries,
	error,
	loading,
	loadingMore,
	desktopFilterOpen,
	filterOpen,
	exportOpen,
	compact,
	selection,
	selected,
	scanner,
	filters,
	sort,
	view,
	summaryMetrics,
	sortColumns,
	pageTitle,
	activeFilterCount,
	operationCaps,
	warehouseNodes,
	categoryNodes,
	panelFilters,
	customError,
	warehouseText,
	chips,
	load,
	removeChip,
	clearFilters,
	operation,
	openItem,
	toggle,
	toggleSelection,
	applySort,
	setView,
	toggleSortOrder,
	onResultsScroll,
	initializeInventory,
} = props.controller;
const summaryOpen = ref(false);
const surface: "desktop" | "mobile" = "desktop";
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
const resultsScroll = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
const restorationKey = "ti:inventory-results-scroll";
const infiniteScroll = useInfiniteScroll({
	hasMore: () => rows.value.length < total.value,
	isLoading: () => loading.value || loadingMore.value,
	onLoadMore: () => load(true),
});
onMounted(async () => {
	await nextTick();
	infiniteScroll.connect(resultsScroll.value, sentinel.value);
	const saved = Number(sessionStorage.getItem(restorationKey) || 0);
	resultsScroll.value?.scrollTo?.({ top: saved });
	compact.value = saved > 80;
});
watch(scrollResetToken, async () => {
	await nextTick();
	resultsScroll.value?.scrollTo?.({ top: 0 });
});
onBeforeUnmount(() => {
	sessionStorage.setItem(restorationKey, String(resultsScroll.value?.scrollTop || 0));
	infiniteScroll.disconnect();
});
</script>

<template>
	<section class="inventory-destination viewport-list-root inventory-desktop-page">
		<div
			class="list-layout desktop-list-layout"
			:class="{ 'filters-open': desktopFilterOpen }"
		>
			<ResponsiveFilterPanel ref="filterPanel" v-model:open="filterOpen">
				<InventoryFilterPanel
					v-model="panelFilters"
					:warehouses="warehouseNodes"
					:categories="categoryNodes"
					:expiry-counts="facetCounts.expiry"
					:custom-error="customError"
				/>
			</ResponsiveFilterPanel>
			<div class="results-column" :class="{ compact }">
				<div class="results-chrome">
					<div class="inventory-heading">
						<div class="inventory-title">
							<h1>{{ pageTitle }}</h1>
							<span>{{ total }} 件物品</span>
						</div>
						<div class="inventory-heading-actions">
							<button
								v-if="operationCaps.Receive"
								type="button"
								@click="operation('Receive')"
							>
								↓ 入库
							</button>
							<button
								v-if="operationCaps.Issue"
								type="button"
								@click="operation('Issue')"
							>
								↑ 出库
							</button>
							<button
								v-if="operationCaps.Transfer"
								type="button"
								@click="operation('Transfer')"
							>
								⇄ 转移
							</button>
							<button type="button" @click="exportOpen = true">导出</button>
							<button
								v-if="boot?.capabilities?.Item"
								type="button"
								class="primary"
								@click="operation('CreateItem')"
							>
								＋ 新建物品
							</button>
						</div>
					</div>
					<div class="result-toolbar">
						<b class="compact-identity">{{ pageTitle }}</b>
						<label class="inventory-search"
							><span aria-hidden="true">⌕</span
							><input
								v-model="filters.search"
								type="search"
								placeholder="搜索物品或条码"
								aria-label="搜索物品或条码"
						/></label>
						<button
							class="toolbar-action"
							aria-label="扫描条码"
							@click="scanner = true"
						>
							<InventoryIcon name="scan" /><span>扫码</span>
						</button>
						<button
							type="button"
							class="inventory-filter-button"
							:class="{ active: desktopFilterOpen || filterOpen }"
							:aria-expanded="desktopFilterOpen || filterOpen"
							@click="openFilters($event)"
						>
							<InventoryIcon name="filter" />
							<span>筛选</span
							><b v-if="activeFilterCount">{{ activeFilterCount }}</b></button
						><button type="button" class="toolbar-action" @click="summaryOpen = true">
							Σ <span>列汇总</span>
						</button>
						><button class="toolbar-action" @click="toggleSelection">
							<InventoryIcon name="select" /><span>{{
								selection ? "完成" : "选择"
							}}</span>
						</button>
						<div
							class="inventory-view-controls"
							role="group"
							aria-label="库存显示方式"
						>
							<button
								type="button"
								:aria-pressed="view === 'card'"
								@click="setView('card')"
							>
								<InventoryIcon name="card" /><span>卡片</span>
							</button>
							<button
								type="button"
								:aria-pressed="view === 'table'"
								@click="setView('table')"
							>
								<InventoryIcon name="table" /><span>表格</span>
							</button>
						</div>
					</div>
					<QuantitySummary
						v-if="!compact"
						:metrics="summaryMetrics"
						:loading="loading"
					/>
					<div class="inventory-filter-strip">
						<ActiveFilterChips
							:chips="chips"
							@remove="removeChip"
							@clear="clearFilters"
						/>
						<span v-if="!chips.length" class="no-filters"
							>全部仓库 · 全部类别 · 全部状态</span
						>
						<span class="inventory-result-count" aria-live="polite"
							>已加载 {{ rows.length }} · 筛选结果 {{ total }} · 全部
							{{ overall ?? total }}</span
						>
						<label v-if="view === 'card'" class="inventory-sort"
							>排序
							<select
								:value="sort.sort_by"
								@change="
									applySort({
										sort_by: ($event.target as HTMLSelectElement).value,
										sort_order: sort.sort_order,
									})
								"
							>
								<option value="item_name">物品名称</option>
								<option value="item_code">物品编码</option>
								<option value="available_stock">可用</option>
								<option value="total_stock">总计</option>
								<option value="on_loan_qty">借出</option>
								<option value="damaged_qty">损坏</option>
							</select>
						</label>
						<button
							v-if="view === 'card'"
							type="button"
							class="sort-direction"
							:aria-label="
								sort.sort_order === 'asc'
									? '当前升序，切换为降序'
									: '当前降序，切换为升序'
							"
							@click="toggleSortOrder"
						>
							{{ sort.sort_order === "asc" ? "升序 ↑" : "降序 ↓" }}
						</button>
					</div>
				</div>
				<div ref="resultsScroll" class="results-scroll" @scroll.passive="onResultsScroll">
					<div class="inventory-results">
						<InventoryCardGrid
							v-if="view === 'card'"
							:rows="rows"
							:loading="loading"
							:loading-more="loadingMore"
							:error="error"
							:selection-mode="selection"
							:selected-keys="selected"
							:warehouse-label="warehouseText"
							@activate="(item) => openItem(item.item_code)"
							@toggle="(item) => toggle(item.item_code)"
						>
							<template #error
								>{{ error }}
								<button type="button" @click="initializeInventory">
									重试
								</button></template
							>
						</InventoryCardGrid>
						<SortableDataTable
							:surface="surface"
							v-else
							:rows="rows"
							:columns="sortColumns"
							:column-summaries="columnSummaries"
							:show-summary="false"
							row-key="item_code"
							:sort="sort"
							:loading="loading"
							:loading-more="loadingMore"
							:error="error"
							empty-message="暂无符合条件的物品"
							:selection-mode="selection"
							:selected-keys="selected"
							@sort="applySort"
							@activate="(item) => openItem(item.item_code)"
							@toggle="(item) => toggle(item.item_code)"
						>
							<template #error
								>{{ error }}
								<button type="button" @click="initializeInventory">
									重试
								</button></template
							>
							<template #cell-item_name="{ row }"
								><div class="primary-cell">
									<span data-row-control
										><ItemImagePreview
											:src="row.image || undefined"
											:alt="row.item_name" /></span
									><RouterLink
										data-row-action
										:to="`/item/${encodeURIComponent(row.item_code)}`"
										><b class="primary-text">{{ row.item_name }}</b
										><small v-if="row.description" class="secondary-text">{{
											String(row.description).replace(/<[^>]*>/g, " ")
										}}</small></RouterLink
									>
								</div></template
							>
							<template #cell-item_code="{ row }"
								><span class="item-code-cell"
									>{{ row.item_code }}<small>{{ row.item_group }}</small></span
								></template
							>
							<template #cell-available_stock="{ row }"
								><span class="quantity available-quantity"
									><b>{{ row.available_stock }} {{ row.stock_uom }}</b></span
								></template
							>
							<template #cell-total_stock="{ row }"
								><span class="quantity"
									>{{ row.total_stock }} {{ row.stock_uom }}</span
								></template
							>
							<template #cell-on_loan_qty="{ row }"
								><span class="quantity"
									>{{ row.on_loan_qty }} {{ row.stock_uom }}</span
								></template
							>
							<template #cell-damaged_qty="{ row }"
								><span class="quantity"
									>{{ row.damaged_qty }} {{ row.stock_uom }}</span
								></template
							>
							<template #cell-details="{ row }">
								<div class="table-details" data-row-control>
									<DetailPopover
										v-if="Object.keys(row.warehouse_stock || {}).length"
										:label="`${row.item_name}的仓库位置`"
										:trigger-text="`${Object.keys(row.warehouse_stock || {}).length} 个库位`"
									>
										<p v-for="(qty, name) in row.warehouse_stock" :key="name">
											{{ warehouseText(String(name)) }}：{{ qty }}
											{{ row.stock_uom }}
										</p>
									</DetailPopover>
									<DetailPopover
										v-if="row.has_batch_no && row.batches?.length"
										:label="`${row.item_name}的批次信息`"
										:trigger-text="`${row.batch_count ?? row.batches.length} 批次`"
									>
										<p v-for="batch in row.batches" :key="batch.batch_no">
											批次 {{ batch.batch_no }} · 数量 {{ batch.qty }}
											{{ row.stock_uom }} ·
											{{ batch.expiry_date || "无效期" }}
										</p>
									</DetailPopover>
									<span v-else-if="row.has_batch_no" class="table-batch-count"
										>{{ row.batch_count ?? "—" }} 批次</span
									>
								</div>
							</template>
							<template #cell-open><InventoryIcon name="open" /></template>
							<template #cell-selection="{ row }"
								><input
									data-row-control
									type="checkbox"
									:checked="selected.includes(row.item_code)"
									:aria-label="`选择 ${row.item_name}`"
									@change="toggle(row.item_code)"
							/></template>
							<template #mobile-row="{ row }"
								><article class="item-card result-card" tabindex="0">
									<span data-row-control
										><ItemImagePreview
											:src="row.image || undefined"
											:alt="row.item_name" /></span
									><RouterLink
										data-row-action
										:to="`/item/${encodeURIComponent(row.item_code)}`"
										><b>{{ row.item_name }}</b
										><small>{{ row.item_code }} · {{ row.item_group }}</small
										><strong class="available-quantity"
											>可用 {{ row.available_stock }}
											{{ row.stock_uom }}</strong
										><small
											>总计 {{ row.total_stock }} {{ row.stock_uom }}</small
										></RouterLink
									><input
										v-if="selection"
										data-row-control
										type="checkbox"
										:checked="selected.includes(row.item_code)"
										:aria-label="`选择 ${row.item_name}`"
										@change="toggle(row.item_code)"
									/></article
							></template>
						</SortableDataTable>
					</div>
					<div ref="sentinel" aria-hidden="true"></div>
				</div>
			</div>
		</div>
		<ColumnSummaryDialog
			v-model:open="summaryOpen"
			:columns="sortColumns"
			:summaries="columnSummaries"
			:loading="loading"
		/>
	</section>
</template>
<style scoped>
@media (min-width: 1024px) {
	.inventory-desktop-page {
		width: 100%;
		max-width: none;
		padding: 0 16px;
	}
	.desktop-list-layout {
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
	}
	.desktop-list-layout.filters-open {
		grid-template-columns: 250px minmax(0, 1fr);
		margin-left: -16px;
	}
	.desktop-list-layout:not(.filters-open) :deep(.filter-sidebar) {
		display: none;
	}
	.desktop-list-layout.filters-open :deep(.filter-sidebar) {
		display: block;
		padding: 14px 12px;
		border-right: 1px solid #e4ded5;
		border-radius: 0;
		background: #fbfaf7;
		box-shadow: none;
	}
	.desktop-list-layout.filters-open :deep(.filter-sidebar h2) {
		color: #202b39;
		font-size: 20px;
	}
	.results-column {
		padding-left: 0;
	}
	.filters-open .results-column {
		padding-left: 16px;
	}
	.results-chrome {
		padding-top: 14px;
	}
	.results-scroll {
		border: 1px solid #ece9e2;
		border-radius: 8px 8px 0 0;
		background: #fff;
	}
	.inventory-results :deep(.sortable-data-table table) {
		font-size: 14px;
	}
	.inventory-results :deep(.sortable-data-table th) {
		background: #f2f2f0;
		color: #7a7d84;
		font-size: 14px;
	}
	.inventory-results :deep(.sortable-data-table td) {
		height: 57px;
		padding: 5px 10px;
		border-bottom-color: #f0f0ed;
	}
	.inventory-results :deep(.sortable-data-table th),
	.inventory-results :deep(.sortable-data-table td) {
		padding-inline: 10px;
	}
	.inventory-fab {
		display: none;
	}
}
</style>
