<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import "./inventory-surface.css";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import MobileInventoryList from "../../components/MobileInventoryList.vue";
import MobileInventorySummary from "../../components/MobileInventorySummary.vue";
import FloatingActionMenu from "../../components/FloatingActionMenu.vue";
import InventoryCardGrid from "../../components/InventoryCardGrid.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import ColumnSummaryDialog from "../../components/ColumnSummaryDialog.vue";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import InventoryFilterPanel from "../../components/InventoryFilterPanel.vue";
import MobileSubnav from "../../components/MobileSubnav.vue";
import { type InventoryController } from "./useInventoryController";

const props = defineProps<{ controller: InventoryController }>();
const {
	scrollResetToken,
	rows,
	total,
	facetCounts,
	error,
	loading,
	loadingMore,
	filterOpen,
	panelFilters,
	warehouseNodes,
	categoryNodes,
	customError,
	compact,
	expandedSummary,
	scanner,
	filters,
	view,
	sortColumns,
	columnSummaries,
	pageTitle,
	activeFilterCount,
	inventoryTabQuery,
	pageActions,
	mobileInventoryMetrics,
	warehouseText,
	chips,
	load,
	removeChip,
	clearFilters,
	operation,
	openItem,
	setView,
	onResultsScroll,
	initializeInventory,
} = props.controller;
const summaryOpen = ref(false);
const mobileActions = computed(() =>
	pageActions.value.filter((action) => action.kind !== "Export"),
);
const mobileActionsDisabled = computed(
	() =>
		mobileActions.value.length > 0 &&
		mobileActions.value.every((action) => action.disabled || action.loading),
);
const surface: "desktop" | "mobile" = "mobile";
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
const subnavItems = computed(() => [
	{ key: "inventory", label: "库存列表", path: "/", query: inventoryTabQuery.value },
	{
		key: "expiry",
		label: "效期批次",
		path: "/expiry",
		query: inventoryTabQuery.value,
		count: facetCounts.value.expiry?.all || 0,
	},
]);
const mobileResultsScroll = ref<HTMLElement>();
const mobileSentinel = ref<HTMLElement>();
const restorationKey = "ti:inventory-results-scroll";
const infiniteScroll = useInfiniteScroll({
	hasMore: () => rows.value.length < total.value,
	isLoading: () => loading.value || loadingMore.value,
	onLoadMore: () => load(true),
});
onMounted(async () => {
	await nextTick();
	infiniteScroll.connect(mobileResultsScroll.value, mobileSentinel.value);
	const saved = Number(sessionStorage.getItem(restorationKey) || 0);
	mobileResultsScroll.value?.scrollTo?.({ top: saved });
	compact.value = saved > 80;
});
watch(scrollResetToken, async () => {
	await nextTick();
	mobileResultsScroll.value?.scrollTo?.({ top: 0 });
	compact.value = false;
});
onBeforeUnmount(() => {
	sessionStorage.setItem(restorationKey, String(mobileResultsScroll.value?.scrollTop || 0));
	infiniteScroll.disconnect();
});
</script>

<template>
	<section class="inventory-destination viewport-list-root inventory-desktop-page">
		<div class="mobile-inventory-page" :class="{ compact }">
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="activeFilterCount"
				:show-trigger="false"
			>
				<InventoryFilterPanel
					v-model="panelFilters"
					:warehouses="warehouseNodes"
					:categories="categoryNodes"
					:expiry-counts="facetCounts.expiry"
					:custom-error="customError"
				/>
			</ResponsiveFilterPanel>
			<header class="mobile-browse-header">
				<div class="mobile-title-row">
					<div>
						<h1>{{ pageTitle }}</h1>
						<span>{{ total }} 件物品</span>
					</div>
				</div>
				<MobileSubnav
					:items="subnavItems"
					active-key="inventory"
					:compact="compact"
					aria-label="库存页面"
				/>
				<div class="mobile-search-actions" aria-label="浏览工具">
					<b class="compact-page-title">{{ pageTitle }}</b>
					<label
						><span aria-hidden="true">⌕</span
						><input
							v-model="filters.search"
							type="search"
							placeholder="搜索物品或条码"
							aria-label="搜索物品或条码"
					/></label>
					<button
						type="button"
						class="mobile-scan"
						aria-label="扫码"
						@click="scanner = true"
					>
						<InventoryIcon name="scan" /><span>扫码</span>
					</button>
					<button
						type="button"
						class="mobile-filter"
						:aria-label="`筛选，${activeFilterCount} 项已启用`"
						@click="openFilters($event)"
					>
						<InventoryIcon name="filter" /><span>筛选</span
						><b v-if="activeFilterCount">{{ activeFilterCount }}</b>
					</button>
				</div>
				<MobileInventorySummary
					:metrics="mobileInventoryMetrics"
					:expanded-key="expandedSummary"
					@select="expandedSummary = expandedSummary === $event ? '' : $event"
				/>
				<ActiveFilterChips
					:chips="chips"
					:show-clear="false"
					@remove="removeChip"
					@clear="clearFilters"
				/>
				<div class="mobile-result-controls">
					<span aria-live="polite">共 {{ total }} 件物品</span>
					<div role="group" aria-label="库存显示方式">
						<button
							type="button"
							aria-label="列表"
							:aria-pressed="view === 'table'"
							@click="setView('table')"
						>
							<InventoryIcon name="table" />
						</button>
						<button
							type="button"
							aria-label="卡片"
							:aria-pressed="view === 'card'"
							@click="setView('card')"
						>
							<InventoryIcon name="card" />
						</button>
					</div>
					<button
						type="button"
						class="mobile-summary-trigger"
						@click="summaryOpen = true"
					>
						<InventoryIcon name="table" /> Σ 列汇总
					</button>
				</div>
			</header>
			<section
				ref="mobileResultsScroll"
				class="mobile-results"
				aria-label="库存结果"
				@scroll.passive="onResultsScroll"
			>
				<InventoryCardGrid
					v-if="view === 'card'"
					:rows="rows"
					:loading="loading"
					:loading-more="loadingMore"
					:error="error"
					compact-mobile
					:warehouse-label="warehouseText"
					@activate="(item) => openItem(item.item_code)"
				>
					<template #error
						>{{ error }}
						<button type="button" @click="initializeInventory">重试</button></template
					>
				</InventoryCardGrid>
				<MobileInventoryList
					v-else
					:rows="rows"
					:loading="loading"
					:loading-more="loadingMore"
					:error="error"
					:warehouse-label="warehouseText"
					@retry="initializeInventory"
					@activate="(item) => openItem(item.item_code)"
				/>
				<div ref="mobileSentinel" aria-hidden="true"></div>
			</section>
		</div>
		<FloatingActionMenu
			v-if="mobileActions.length"
			:actions="mobileActions"
			:disabled="mobileActionsDisabled"
			label="新增库存操作"
			@select="(kind) => void operation(kind)"
		/>
		<ColumnSummaryDialog
			v-model:open="summaryOpen"
			:columns="sortColumns"
			:summaries="columnSummaries"
			:loading="loading"
		/>
	</section>
</template>
<style scoped>
@media (max-width: 1023px) {
	.inventory-desktop-page {
		width: 100%;
		height: calc(
			100dvh - var(--mobile-nav-height, 0px) - var(--mobile-context-nav-height, 0px)
		);
		min-height: 0;
		overflow: hidden;
		padding: 0;
	}
	.desktop-list-layout {
		display: none !important;
	}
	.mobile-inventory-page {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
		background: #f8f7f4;
	}
	.mobile-browse-header {
		position: sticky;
		top: 0;
		z-index: 20;
		display: grid;
		gap: 9px;
		margin: 0;
		padding: 12px 10px 7px;
		border-bottom: 1px solid #ebe6dd;
		background: rgb(248 247 244 / 97%);
		box-shadow: 0 2px 10px rgb(72 54 32 / 4%);
		backdrop-filter: blur(10px);
	}
	.mobile-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.mobile-title-row > div:first-child {
		display: flex;
		min-width: 0;
		align-items: baseline;
		gap: 8px;
		margin-right: auto;
	}
	.mobile-title-row > .overflow-action-menu {
		margin-left: auto;
		margin-right: 0;
	}
	.mobile-title-row h1 {
		margin: 0;
		color: #202b39;
		font-size: 24px;
		line-height: 1.2;
	}
	.mobile-title-row span {
		color: #7c858f;
		font-size: 12px;
	}
	.mobile-subnav {
		display: grid;
		grid-template-columns: 1fr 1fr;
		box-sizing: border-box;
		min-height: 46px;
		gap: 3px;
		padding: 3px;
		border-radius: 8px;
		background: #ece8e1;
	}
	.mobile-subnav a {
		display: flex;
		box-sizing: border-box;
		min-height: 38px;
		align-items: center;
		justify-content: center;
		padding: 9px;
		border-radius: 6px;
		color: #746d63;
		text-align: center;
		text-decoration: none;
	}
	.mobile-subnav a[aria-current="page"] {
		background: #fff;
		color: #80572f;
		box-shadow: 0 1px 3px #5b49351c;
		font-weight: 700;
	}
	.mobile-subnav span {
		margin-left: 2px;
		font-size: 10px;
	}
	.mobile-search-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.compact-page-title {
		display: none;
		flex: none;
		color: #202b39;
		font-size: 15px;
		white-space: nowrap;
	}
	.mobile-search-actions label {
		display: flex;
		min-width: 0;
		height: 44px;
		flex: 1;
		align-items: center;
		gap: 6px;
		padding: 0 9px;
		border: 1px solid #e3dfd7;
		border-radius: 8px;
		background: #fff;
		color: #7c858f;
	}
	.mobile-search-actions input {
		width: 100%;
		min-width: 0;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 12px;
	}
	.mobile-search-actions > button {
		position: relative;
		display: flex;
		min-width: 62px;
		height: 44px;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 0 7px;
		border: 1px solid #e3dfd7;
		border-radius: 8px;
		background: #fff;
		font-size: 12px;
	}
	.mobile-filter > b {
		position: absolute;
		top: -5px;
		right: -4px;
		display: grid;
		min-width: 18px;
		height: 18px;
		place-items: center;
		padding: 0 4px;
		border: 2px solid #f8f7f4;
		border-radius: 50%;
		background: #f2dfc9;
		color: #965a23;
		font-size: 9px;
	}
	.mobile-result-controls {
		display: flex;
		min-height: 34px;
		align-items: center;
		justify-content: space-between;
	}
	.mobile-result-controls > span {
		font-size: 13px;
		font-weight: 600;
	}
	.mobile-result-controls > div {
		display: flex;
		padding: 2px;
		border-radius: 7px;
		background: #efebe5;
	}
	.mobile-result-controls > div button {
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
	}
	.mobile-result-controls > div button[aria-pressed="true"] {
		background: #fff;
		color: #95602d;
		box-shadow: 0 1px 3px rgb(59 46 31 / 12%);
	}
	.mobile-results {
		min-height: 0;
		flex: 1;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 4px 8px 16px;
		background: #f8f7f4;
	}
	.mobile-results :deep(.inventory-card-grid) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		padding: 4px 0;
	}
	.mobile-results :deep(.inventory-card-body) {
		padding: 7px 8px 9px;
		gap: 4px;
	}
	.mobile-results :deep(.inventory-card-name) {
		font-size: 13px;
	}
	.mobile-results :deep(.inventory-card-image) {
		aspect-ratio: 1.08;
	}
	.mobile-results :deep(.inventory-card-totals) {
		font-size: 10px;
	}
	.mobile-results :deep(.card-state) {
		padding: 25px 8px;
	}
	.mobile-inventory-page.compact .mobile-title-row,
	.mobile-inventory-page.compact :deep(.mobile-summary) {
		display: none;
	}
	.mobile-inventory-page.compact .mobile-browse-header {
		gap: 5px;
		padding: 7px 8px 4px;
	}
	.mobile-inventory-page.compact .mobile-search-actions > button {
		min-width: 40px;
	}
	.mobile-inventory-page.compact .mobile-search-actions > button span {
		display: none;
	}
	.mobile-inventory-page.compact .compact-page-title {
		display: block;
	}
	.mobile-inventory-page.compact .mobile-subnav {
		min-height: 40px;
		gap: 2px;
		padding: 2px;
	}
	.mobile-inventory-page.compact .mobile-subnav a {
		min-height: 36px;
		padding: 4px 7px;
		font-size: 11px;
	}
	.mobile-summary-trigger {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		border: 1px solid #e2d8c9;
		border-radius: 7px;
		background: #fff;
		color: #80572f;
		font-size: 11px;
	}
	.mobile-search-actions input {
		box-sizing: border-box;
		height: 100%;
		margin: 0;
		padding: 0;
		line-height: 1.2;
	}
}

@media (max-width: 1023px) {
	.inventory-desktop-page {
		padding: 14px;
	}
	.inventory-heading {
		display: none;
	}
	.inventory-filter-button span {
		display: none;
	}
	.inventory-result-count {
		width: 100%;
		margin-left: 0;
	}
	.inventory-filter-strip {
		flex-wrap: wrap;
	}
}
</style>
