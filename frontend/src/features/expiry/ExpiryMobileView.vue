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
		background: var(--ti-canvas);
	}
	.mobile-browse-header {
		position: sticky;
		top: 0;
		z-index: var(--ti-layer-nav);
		display: grid;
		gap: var(--ti-space-2);
		margin: 0;
		padding: var(--ti-space-3) var(--ti-space-2) var(--ti-space-2);
		border-bottom: 1px solid var(--ti-border);
		background: color-mix(in srgb, var(--ti-canvas) 97%, transparent);
		box-shadow: var(--ti-shadow-card);
		backdrop-filter: blur(10px);
	}
	.mobile-title-row {
		display: flex;
		align-items: center;
		gap: var(--ti-space-1);
	}
	.mobile-title-row > div:first-child {
		display: flex;
		min-width: 0;
		align-items: baseline;
		gap: var(--ti-density-row-gap);
		margin-right: auto;
	}
	.mobile-title-row > .overflow-action-menu {
		margin-left: auto;
		margin-right: 0;
	}
	.mobile-title-row h1 {
		margin: 0;
		color: var(--ti-ink);
		font-size: var(--ti-font-heading);
		line-height: 1.2;
	}
	.mobile-title-row span {
		color: var(--ti-muted);
		font-size: max(12px, var(--ti-font-small));
	}
	.mobile-subnav {
		display: grid;
		grid-template-columns: 1fr 1fr;
		box-sizing: border-box;
		min-height: 46px;
		gap: var(--ti-space-1);
		padding: var(--ti-space-1);
		border-radius: var(--ti-radius-small);
		background: var(--ti-border);
	}
	.mobile-subnav a {
		display: flex;
		box-sizing: border-box;
		min-height: max(44px, var(--ti-density-control));
		align-items: center;
		justify-content: center;
		padding: var(--ti-space-2);
		border-radius: var(--ti-radius-small);
		color: var(--ti-muted);
		text-align: center;
		text-decoration: none;
	}
	.mobile-subnav a[aria-current="page"] {
		background: var(--ti-surface);
		color: var(--ti-accent-strong);
		box-shadow: var(--ti-shadow-card);
		font-weight: 700;
	}
	.mobile-subnav span {
		margin-left: var(--ti-space-1);
		font-size: max(12px, var(--ti-font-small));
	}
	.mobile-search-actions {
		display: flex;
		align-items: center;
		gap: var(--ti-space-1);
		min-width: 0;
	}
	.compact-page-title {
		display: none;
		flex: none;
		color: var(--ti-ink);
		font-size: var(--ti-font-body);
		white-space: nowrap;
	}
	.mobile-search-actions label {
		display: flex;
		min-width: 0;
		height: 44px;
		flex: 1;
		align-items: center;
		gap: var(--ti-space-1);
		padding: 0 var(--ti-space-2);
		border: 1px solid var(--ti-border);
		border-radius: var(--ti-radius-small);
		background: var(--ti-surface);
		color: var(--ti-muted);
	}
	.mobile-search-actions input {
		width: 100%;
		min-width: 0;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: max(16px, var(--ti-font-body));
	}
	.mobile-search-actions > button {
		position: relative;
		display: flex;
		min-width: 62px;
		height: 44px;
		align-items: center;
		justify-content: center;
		gap: var(--ti-space-1);
		padding: 0 var(--ti-space-2);
		border: 1px solid var(--ti-border);
		border-radius: var(--ti-radius-small);
		background: var(--ti-surface);
		font-size: max(12px, var(--ti-font-small));
	}
	.mobile-filter > b {
		position: absolute;
		top: -5px;
		right: -4px;
		display: grid;
		min-width: 18px;
		height: 18px;
		place-items: center;
		padding: 0 var(--ti-space-1);
		border: 2px solid var(--ti-canvas);
		border-radius: var(--ti-radius-pill);
		background: var(--ti-accent-soft);
		color: var(--ti-accent-strong);
		font-size: max(12px, var(--ti-font-small));
	}
	.mobile-result-controls {
		display: flex;
		min-height: 34px;
		align-items: center;
		justify-content: space-between;
	}
	.mobile-result-controls > span {
		font-size: var(--ti-font-body);
		font-weight: 600;
	}
	.mobile-results {
		min-height: 0;
		flex: 1;
		overflow-x: hidden;
		overflow-y: auto;
		padding: var(--ti-space-1) var(--ti-space-2)
			calc(var(--mobile-nav-height, 0) + var(--ti-space-8));
		background: var(--ti-canvas);
	}
	.mobile-expiry-page.compact .mobile-browse-header {
		gap: var(--ti-space-1);
		padding: var(--ti-space-2) var(--ti-space-2) var(--ti-space-1);
	}
	.mobile-expiry-page.compact .mobile-search-actions > button {
		min-width: 40px;
	}
	.mobile-expiry-page.compact .mobile-search-actions > button span {
		display: none;
	}
	.mobile-expiry-page.compact .mobile-subnav {
		min-height: 40px;
		gap: var(--ti-space-1);
		padding: var(--ti-space-1);
	}
	.mobile-result-controls > div {
		display: flex;
		padding: var(--ti-space-1);
		border-radius: var(--ti-radius-small);
		background: var(--ti-border);
	}
	.mobile-result-controls > div button {
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		border: 0;
		border-radius: var(--ti-radius-small);
		background: transparent;
	}
	.mobile-result-controls > div button[aria-pressed="true"] {
		background: var(--ti-surface);
		color: var(--ti-accent-strong);
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
		padding: var(--ti-space-2) 0;
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
