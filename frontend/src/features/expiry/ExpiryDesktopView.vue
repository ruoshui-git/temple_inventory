<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import "./expiry-surface.css";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import ItemImagePreview from "../../components/ItemImagePreview.vue";
import SortableDataTable from "../../components/SortableDataTable.vue";
import { formatExpiryDuration } from "../../lib/duration";
import InventoryIcon from "../../components/InventoryIcon.vue";
import InventoryFilterPanel from "../../components/InventoryFilterPanel.vue";
import ExpiryCardGrid from "../../components/ExpiryCardGrid.vue";
import UiButton from "../../components/UiButton.vue";
import ColumnSummaryDialog from "../../components/ColumnSummaryDialog.vue";
import DetailPopover from "../../components/DetailPopover.vue";
import { type ExpiryController } from "./useExpiryController";

const props = defineProps<{ controller: ExpiryController }>();
const {
	scrollResetToken,
	rows,
	error,
	busy,
	refreshing,
	appending,
	total,
	overallTotal,
	columnSummaries,
	facetCounts,
	filterOpen,
	desktopFilterOpen,
	exportOpen,
	compact,
	view,
	pageActions,
	filters,
	sort,
	sortColumns,
	routeValidationError,
	warehouseNodes,
	categoryNodes,
	panelFilters,
	customError,
	warehouseText,
	activeCount,
	chips,
	removeChip,
	clearAll,
	operation,
	openItem,
	applySort,
	setView,
	onResultsScroll,
	load,
} = props.controller;
const summaryOpen = ref(false);
const surface: "desktop" | "mobile" = "desktop";
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
const resultsScroll = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
const restorationKey = "temple_inventory.scroll.expiry";
const infiniteScroll = useInfiniteScroll({
	hasMore: () => rows.value.length < total.value,
	isLoading: () => busy.value || refreshing.value || appending.value,
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
	<main class="inventory-destination wide-shell viewport-list-root expiry-desktop-page">
		<div
			class="list-layout desktop-list-layout"
			:class="{ 'filters-open': desktopFilterOpen }"
		>
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="activeCount"
			>
				<InventoryFilterPanel
					v-model="panelFilters"
					:warehouses="warehouseNodes"
					:categories="categoryNodes"
					:expiry-counts="facetCounts.expiry"
					:custom-error="customError"
					expiry-primary
				/>
			</ResponsiveFilterPanel>
			<div class="results-column" :class="{ compact }">
				<div class="results-chrome">
					<div class="inventory-heading">
						<div class="inventory-title">
							<h1>效期批次</h1>
							<span>{{ total }} 个批次</span>
						</div>
						<div class="inventory-heading-actions">
							<UiButton
								v-for="action in pageActions"
								:key="action.kind"
								:size="action.kind === 'Export' ? undefined : 'compact'"
								:icon="action.kind === 'Export' ? 'download' : undefined"
								:disabled="action.disabled"
								@click="
									action.kind === 'Export'
										? (exportOpen = true)
										: operation(action.kind)
								"
							>
								{{ action.label }}
							</UiButton>
						</div>
					</div>
					<div class="result-toolbar">
						<b class="compact-identity">效期批次</b>
						<label class="inventory-search"
							><span aria-hidden="true">⌕</span
							><input
								v-model="filters.search"
								type="search"
								placeholder="搜索物品或批次"
								aria-label="搜索物品或批次"
						/></label>
						<UiButton
							variant="secondary"
							size="compact"
							icon="filter"
							type="button"
							class="inventory-filter-button"
							:class="{ active: desktopFilterOpen || filterOpen }"
							:aria-expanded="desktopFilterOpen || filterOpen"
							@click="openFilters($event)"
						>
							筛选<span
								><b v-if="activeCount">{{ activeCount }}</b></span
							>
						</UiButton>
						<UiButton
							variant="secondary"
							size="compact"
							icon="table"
							class="toolbar-action"
							@click="summaryOpen = true"
						>
							列汇总
						</UiButton>
						<div
							class="inventory-view-controls"
							role="group"
							aria-label="效期显示方式"
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
					<div class="inventory-filter-strip">
						<ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
						<span v-if="!chips.length" class="no-filters"
							>全部仓库 · 全部类别 · 全部效期</span
						>
						<span class="inventory-result-count" aria-live="polite">{{
							refreshing
								? "正在更新…"
								: `已加载 ${rows.length} · 筛选结果 ${total} · 全部 ${overallTotal}`
						}}</span>
					</div>
				</div>
				<div ref="resultsScroll" class="results-scroll" @scroll.passive="onResultsScroll">
					<ExpiryCardGrid
						v-if="view === 'card'"
						:rows="rows"
						:warehouse-label="warehouseText"
						:loading="busy || refreshing"
						:loading-more="appending"
						:error="error || routeValidationError"
						@retry="load()"
						@activate="(row) => openItem(row.item_code, row.batch_no)"
					/>
					<SortableDataTable
						:surface="surface"
						v-else
						:rows="rows"
						:columns="sortColumns"
						:column-summaries="columnSummaries"
						:show-summary="false"
						row-key="batch_no"
						:sort="sort"
						:loading="busy || refreshing"
						:loading-more="appending"
						:error="error || routeValidationError"
						empty-message="暂无符合条件的批次"
						@sort="applySort"
						@activate="(row) => openItem(row.item_code, row.batch_no)"
					>
						<template #error
							>{{ error || routeValidationError }}
							<button type="button" @click="load()">重试</button></template
						>
						<template #cell-item_name="{ row }"
							><div class="primary-cell">
								<span data-row-control
									><ItemImagePreview
										:src="row.image"
										:alt="row.item_name" /></span
								><RouterLink
									data-row-action
									:to="`/item/${encodeURIComponent(row.item_code)}?batch=${encodeURIComponent(row.batch_no)}`"
									><b class="primary-text">{{ row.item_name }}</b
									><small class="secondary-text"
										>{{ row.item_code }} · {{ row.batch_no }}</small
									></RouterLink
								><DetailPopover
									data-row-control
									:label="`${row.item_name}的批次信息`"
									:trigger-text="`批次 ${row.batch_no}`"
								>
					<p :class="{ warn: Number(row.days_to_expiry) < 0 }">
						{{ row.expiry_date || "无效期" }} · {{ row.total_qty }}
						{{ row.stock_uom }} ·
						{{ row.days_to_expiry == null ? "无效期" : formatExpiryDuration(row.days_to_expiry) }}
									</p>
								</DetailPopover>
							</div></template
						>
						<template #cell-expiry_date="{ row }"
							><span :class="{ warn: row.days_to_expiry < 0 }">{{
								row.expiry_date || "无效期"
							}}</span></template
						>
						<template #cell-days_to_expiry="{ row }"
							><span :class="{ warn: row.days_to_expiry < 0 }">{{
								row.days_to_expiry == null
									? "—"
									: formatExpiryDuration(row.days_to_expiry)
							}}</span></template
						>
						<template #cell-total_qty="{ row }"
							><span class="quantity"
								>{{ row.total_qty }} {{ row.stock_uom }}</span
							></template
						>
						<template #cell-locations="{ row }"
							><DetailPopover
								v-if="row.locations?.length"
								data-row-control
								:label="`${row.item_name}的库位信息`"
								:trigger-text="`${row.locations.length} 个库位`"
							>
								<p
									v-for="location in row.locations"
									:key="location.warehouse"
									:class="{ warn: Number(row.days_to_expiry) < 0 }"
								>
									<strong v-if="Number(row.days_to_expiry) < 0">已过期 · </strong
									>{{ warehouseText(location.warehouse) }}：{{ location.qty }}
								</p> </DetailPopover
							><span v-else>—</span></template
						>
						<template #mobile-row="{ row }"
							><article
								class="item-card result-card"
								tabindex="0"
								:class="{ 'expiry-overdue-row': row.days_to_expiry < 0 }"
							>
								<RouterLink
									data-row-action
									:to="`/item/${encodeURIComponent(row.item_code)}?batch=${encodeURIComponent(row.batch_no)}`"
									><b>{{ row.item_code }} · {{ row.item_name }}</b>
									<p>
										{{ row.item_group }} · 批次 {{ row.batch_no }} ·
										{{ row.total_qty }} {{ row.stock_uom }}
									</p>
									<p>
										{{ row.expiry_date ? `到期 ${row.expiry_date}` : "无效期"
										}}<span v-if="row.days_to_expiry != null">
											· {{ formatExpiryDuration(row.days_to_expiry) }}</span
										>
									</p></RouterLink
								>
							</article></template
						>
					</SortableDataTable>
					<div ref="sentinel" aria-hidden="true"></div>
				</div>
			</div>
			<ColumnSummaryDialog
				v-model:open="summaryOpen"
				:columns="sortColumns"
				:summaries="columnSummaries"
				:loading="busy || refreshing"
			/>
		</div>
	</main>
</template>
<style scoped>
@media (min-width: 1024px) {
	.expiry-desktop-page {
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
	.results-scroll :deep(.sortable-data-table table) {
		font-size: 14px;
	}
	.results-scroll :deep(.sortable-data-table th) {
		background: #f2f2f0;
		color: #7a7d84;
		font-size: 14px;
	}
	.results-scroll :deep(.sortable-data-table td) {
		height: 57px;
		padding: 5px 10px;
	}
}
</style>
