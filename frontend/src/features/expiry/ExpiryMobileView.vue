<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import "./expiry-surface.css";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import { useCompactBrowse } from "../../composables/useCompactBrowse";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import FloatingActionMenu from "../../components/FloatingActionMenu.vue";
import MobileExpiryResults from "../../components/MobileExpiryResults.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import { type ExpiryController } from "./useExpiryController";
import ColumnSummaryDialog from "../../components/ColumnSummaryDialog.vue";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import InventoryFilterPanel from "../../components/InventoryFilterPanel.vue";
import ExpiryCardGrid from "../../components/ExpiryCardGrid.vue";
import MobileSubnav from "../../components/MobileSubnav.vue";
import ResultCountStrip from "../../components/ResultCountStrip.vue";
import ReturnToTop from "../../components/ReturnToTop.vue";
import MobileBrowseHeader from "../../components/MobileBrowseHeader.vue";
import ColumnSummaryTrigger from "../../components/ColumnSummaryTrigger.vue";

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
	panelFilters,
	warehouseNodes,
	categoryNodes,
	customError,
	filterOpen,
	compact,
	scanner,
	pageActions,
	filters,
	sortColumns,
	columnSummaries,
	routeValidationError,
	warehouseText,
	activeCount,
	expiryTabQuery,
	chips,
	removeChip,
	clearAll,
	operation,
	openItem,
	onResultsScroll,
	load,
	view,
	setView,
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
	{
		key: "inventory",
		label: "库存列表",
		path: "/stock",
		query: expiryTabQuery.value,
	},
	{
		key: "expiry",
		label: "效期批次",
		path: "/expiry",
		query: expiryTabQuery.value,
	},
]);
const mobileResultsScroll = ref<HTMLElement>();
useCompactBrowse(mobileResultsScroll, compact);
const browseHeader = ref<{ heading?: HTMLElement }>();
const floatingActionsOpen = ref(false);
const mobileSentinel = ref<HTMLElement>();
const restorationKey = "temple_inventory.scroll.expiry";
const infiniteScroll = useInfiniteScroll({
	hasMore: () => rows.value.length < total.value,
	isLoading: () => busy.value || refreshing.value || appending.value,
	onLoadMore: () => load(true),
});
onMounted(async () => {
	await nextTick();
	infiniteScroll.connect(mobileResultsScroll.value, mobileSentinel.value);
	const saved = Number(sessionStorage.getItem(restorationKey) || 0);
	if (mobileResultsScroll.value) {
		mobileResultsScroll.value.scrollTop = saved;
		compact.value = mobileResultsScroll.value.scrollTop > 80;
	}
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
	<main class="inventory-destination wide-shell viewport-list-root expiry-desktop-page">
		<div class="mobile-expiry-page" :class="{ compact }">
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="activeCount"
				:show-trigger="false"
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
			<MobileBrowseHeader
				ref="browseHeader"
				title="效期批次"
				:compact="compact"
				destination-key="expiry"
			>
				<template #tabs>
					<MobileSubnav
						:items="subnavItems"
						active-key="expiry"
						:compact="compact"
						aria-label="库存页面"
					/>
				</template>
				<template #search-actions>
					<div class="mobile-search-actions" aria-label="浏览工具">
						<label
							><span aria-hidden="true">⌕</span
							><input
								v-model="filters.search"
								type="search"
								placeholder="搜索物品或批次"
								aria-label="搜索物品或批次"
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
							:aria-label="`筛选，${activeCount} 项已启用`"
							@click="openFilters($event)"
						>
							<InventoryIcon name="filter" /><span>筛选</span
							><b v-if="activeCount">{{ activeCount }}</b>
						</button>
					</div>
				</template>
				<template #secondary>
					<div class="browse-result-meta">
						<ActiveFilterChips
							:chips="chips"
							:show-clear="false"
							@remove="removeChip"
							@clear="clearAll"
						/>
						<ResultCountStrip
							:loaded="rows.length"
							:filtered="total"
							:overall="overallTotal"
							:updating="refreshing"
						/>
					</div>
					<div class="mobile-result-controls">
						<div role="group" aria-label="效期显示方式">
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
						<ColumnSummaryTrigger @click="summaryOpen = true" />
					</div>
				</template>
			</MobileBrowseHeader>
			<section
				ref="mobileResultsScroll"
				class="mobile-results"
				aria-label="效期批次结果"
				@scroll.passive="onResultsScroll"
			>
				<ExpiryCardGrid
					v-if="view === 'card'"
					:rows="rows"
					:loading="busy || refreshing"
					:loading-more="appending"
					:error="error || routeValidationError"
					:warehouse-label="warehouseText"
					compact-mobile
					@retry="load()"
					@activate="(row) => openItem(row.item_code, row.batch_no)"
				/>
				<MobileExpiryResults
					v-else
					:rows="rows"
					:loading="busy || refreshing"
					:loading-more="appending"
					:error="error || routeValidationError"
					:warehouse-label="warehouseText"
					@retry="load()"
					@activate="(row) => openItem(row.item_code, row.batch_no)"
				/>
				<div ref="mobileSentinel" aria-hidden="true"></div>
			</section>
		</div>
		<FloatingActionMenu
			v-if="mobileActions.length"
			:actions="mobileActions"
			:disabled="mobileActionsDisabled"
			label="新增效期操作"
			@select="(kind) => void operation(kind)"
			@update:open="floatingActionsOpen = $event"
		/>
		<ReturnToTop
			:target="mobileResultsScroll"
			:heading="browseHeader?.heading"
			:hidden="Boolean(filterOpen || scanner || summaryOpen)"
			:floating-action-open="floatingActionsOpen"
			:has-floating-action="mobileActions.length > 0"
		/>
		<ColumnSummaryDialog
			v-model:open="summaryOpen"
			:columns="sortColumns"
			:summaries="columnSummaries"
			:loading="busy || refreshing"
		/>
	</main>
</template>
<style scoped>
@media (max-width: 1023px) {
	.expiry-desktop-page {
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
	.mobile-expiry-page {
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
	.mobile-results {
		min-height: 0;
		flex: 1;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 4px 8px calc(var(--mobile-nav-height, 0px) + 105px);
		background: #f8f7f4;
	}
	.mobile-expiry-page.compact .mobile-browse-header {
		gap: 5px;
		padding: 7px 8px 4px;
	}
	.mobile-expiry-page.compact .mobile-search-actions > button {
		min-width: 40px;
	}
	.mobile-expiry-page.compact .mobile-search-actions > button span {
		display: none;
	}
	.mobile-expiry-page.compact .mobile-subnav {
		min-height: 40px;
		gap: 2px;
		padding: 2px;
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
		border: 0;
		border-radius: 5px;
		background: transparent;
	}
	.mobile-result-controls > div button[aria-pressed="true"] {
		background: #fff;
		color: #95602d;
	}
	.mobile-search-actions input {
		box-sizing: border-box;
		height: 100%;
		margin: 0;
		padding: 0;
		line-height: 1.2;
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
	.expiry-card-grid {
		grid-template-columns: 1fr;
		padding: 8px 0;
	}
	.expiry-batch-card {
		grid-template-columns: 52px 1fr;
	}
	.expiry-batch-card img,
	.expiry-card-placeholder {
		width: 52px;
		height: 52px;
	}
}
</style>
