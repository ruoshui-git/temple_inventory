<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import "./expiry-surface.css";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import OverflowActionMenu from "../../components/OverflowActionMenu.vue";
import MobileExpiryResults from "../../components/MobileExpiryResults.vue";
import MobileInventorySummary from "../../components/MobileInventorySummary.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import { type ExpiryController } from "./useExpiryController";
import ColumnSummaryDialog from "../../components/ColumnSummaryDialog.vue";

const props = defineProps<{ controller: ExpiryController }>();
const {
	scrollResetToken,
	rows,
	error,
	busy,
	refreshing,
	appending,
	total,
	facetCounts,
	filterOpen,
	compact,
	expandedSummary,
	scanner,
	overflowActions,
	expirySummary,
	mobileExpiryMetrics,
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
	setQuickExpiry,
	onResultsScroll,
	load,
} = props.controller;
const summaryOpen = ref(false);
function selectOverflow(kind: string) {
	if (kind === "ColumnSummary") summaryOpen.value = true;
	else void operation(kind);
}
const surface: "desktop" | "mobile" = "mobile";
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
const mobileResultsScroll = ref<HTMLElement>();
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
	mobileResultsScroll.value?.scrollTo?.({ top: saved });
	compact.value = saved > 80;
});
watch(scrollResetToken, async () => {
	await nextTick();
	mobileResultsScroll.value?.scrollTo?.({ top: 0 });
});
onBeforeUnmount(() => {
	sessionStorage.setItem(restorationKey, String(mobileResultsScroll.value?.scrollTop || 0));
	infiniteScroll.disconnect();
});
</script>

<template>
	<main class="inventory-destination wide-shell viewport-list-root expiry-desktop-page">
		<div class="mobile-expiry-page" :class="{ compact }">
			<header class="mobile-browse-header">
				<div class="mobile-title-row">
					<div>
						<h1>效期批次</h1>
						<span>{{ total }} 个批次</span>
					</div>
					<OverflowActionMenu
						:actions="[
							...overflowActions,
							{ kind: 'ColumnSummary', label: 'Σ 列汇总' },
						]"
						@select="selectOverflow"
					/>
				</div>
				<nav class="mobile-subnav" aria-label="库存页面">
					<RouterLink :to="{ path: '/', query: expiryTabQuery }">库存列表</RouterLink>
					<RouterLink
						:to="{ path: '/expiry', query: expiryTabQuery }"
						aria-current="page"
						>效期批次 <span>{{ facetCounts.expiry?.all || 0 }}</span></RouterLink
					>
				</nav>
				<div class="mobile-search-actions" aria-label="浏览工具">
					<b class="compact-page-title">效期批次</b>
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
				<MobileInventorySummary
					:metrics="mobileExpiryMetrics"
					:expanded-key="expandedSummary"
					@select="expandedSummary = expandedSummary === $event ? '' : $event"
				/>
				<div class="expiry-quick-filters" role="group" aria-label="效期状态">
					<button
						type="button"
						:aria-pressed="filters.expiry_window === 'all'"
						@click="setQuickExpiry('all')"
					>
						全部 <span>{{ facetCounts.expiry?.all || 0 }}</span>
					</button>
					<button
						type="button"
						:aria-pressed="
							filters.expiry_window === 'remaining_within' &&
							filters.expiry_days === '30'
						"
						@click="setQuickExpiry('soon')"
					>
						即将到期 <span>{{ expirySummary.expiring_soon }}</span>
					</button>
					<button
						type="button"
						:aria-pressed="filters.expiry_window === 'overdue'"
						@click="setQuickExpiry('expired')"
					>
						已过期 <span>{{ expirySummary.expired }}</span>
					</button>
				</div>
				<ActiveFilterChips
					:chips="chips"
					:show-clear="false"
					@remove="removeChip"
					@clear="clearAll"
				/>
				<div class="mobile-result-controls">
					<span aria-live="polite">共 {{ total }} 个批次</span>
				</div>
			</header>
			<section
				ref="mobileResultsScroll"
				class="mobile-results"
				aria-label="效期批次结果"
				@scroll.passive="onResultsScroll"
			>
				<MobileExpiryResults
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
		padding: 3px;
		border-radius: 8px;
		background: #ece8e1;
	}
	.mobile-subnav a {
		min-height: 38px;
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
	.expiry-quick-filters {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 5px;
	}
	.expiry-quick-filters button {
		min-height: 36px;
		padding: 4px;
		border: 1px solid transparent;
		border-radius: 7px;
		background: #efede8;
		color: #6d6c69;
		font-size: 12px;
	}
	.expiry-quick-filters button[aria-pressed="true"] {
		border-color: #dda56d;
		background: #fff8f1;
		color: #a64f19;
		font-weight: 700;
	}
	.expiry-quick-filters span {
		margin-left: 2px;
		font-size: 10px;
	}
	.mobile-results {
		min-height: 0;
		flex: 1;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 4px 8px 16px;
		background: #f8f7f4;
	}
	.mobile-expiry-page.compact .mobile-title-row,
	.mobile-expiry-page.compact .mobile-subnav,
	.mobile-expiry-page.compact :deep(.mobile-summary),
	.mobile-expiry-page.compact .expiry-quick-filters {
		display: none;
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
	.mobile-expiry-page.compact .compact-page-title {
		display: block;
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
