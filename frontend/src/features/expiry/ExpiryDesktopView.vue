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
	facetCounts,
	filterOpen,
	desktopFilterOpen,
	exportOpen,
	compact,
	view,
	operationCaps,
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
						<button
							type="button"
							class="inventory-filter-button"
							:class="{ active: desktopFilterOpen || filterOpen }"
							:aria-expanded="desktopFilterOpen || filterOpen"
							@click="openFilters($event)"
						>
							<InventoryIcon name="filter" /><span>筛选</span
							><b v-if="activeCount">{{ activeCount }}</b>
						</button>
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
					<div
						v-if="view === 'card'"
						class="expiry-card-grid"
						:aria-busy="busy || refreshing"
					>
						<RouterLink
							v-for="row in rows"
							:key="row.batch_no"
							class="expiry-batch-card"
							:class="{
								overdue: row.days_to_expiry < 0,
								soon: row.days_to_expiry >= 0 && row.days_to_expiry <= 30,
							}"
							:to="`/item/${encodeURIComponent(row.item_code)}?batch=${encodeURIComponent(row.batch_no)}`"
						>
							<img
								v-if="row.image"
								:src="row.image"
								:alt="row.item_name"
								loading="lazy"
								decoding="async"
							/><span v-else class="expiry-card-placeholder"
								><InventoryIcon name="box"
							/></span>
							<div>
								<small>{{ row.item_group }}</small>
								<h3>{{ row.item_name }}</h3>
								<p>{{ row.item_code }} · {{ row.batch_no }}</p>
								<strong>{{ row.total_qty }} {{ row.stock_uom }}</strong>
								<p class="expiry-date">
									{{ row.expiry_date ? `到期 ${row.expiry_date}` : "无效期"
									}}<span v-if="row.days_to_expiry != null">
										· {{ formatExpiryDuration(row.days_to_expiry) }}</span
									>
								</p>
								<p
									v-for="location in row.locations"
									:key="location.warehouse"
									class="location-line"
								>
									{{ warehouseText(location.warehouse) }}：{{ location.qty }}
								</p>
							</div>
						</RouterLink>
						<p v-if="!busy && !rows.length" class="empty-state">暂无符合条件的批次</p>
					</div>
					<SortableDataTable
						:surface="surface"
						v-else
						:rows="rows"
						:columns="sortColumns"
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
								>
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
							><span
								v-for="location in row.locations"
								:key="location.warehouse"
								class="location-line"
								>{{ warehouseText(location.warehouse) }}：{{ location.qty }}</span
							></template
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
					<p
						v-if="view === 'card' && (error || routeValidationError)"
						class="inline-error"
					>
						{{ error || routeValidationError }}
						<button type="button" @click="load()">重试</button>
					</p>
					<div ref="sentinel" aria-hidden="true"></div>
				</div>
			</div>
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
