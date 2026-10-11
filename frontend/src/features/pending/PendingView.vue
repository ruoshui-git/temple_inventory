<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import { useCompactBrowse } from "../../composables/useCompactBrowse";
import type { ResponsiveSurface } from "../../composables/useResponsiveLayout";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import CategorySelector from "../../components/CategorySelector.vue";
import QuantitySummary from "../../components/QuantitySummary.vue";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import CompactFilterSection from "../../components/CompactFilterSection.vue";
import UiButton from "../../components/UiButton.vue";
import ResultCountStrip from "../../components/ResultCountStrip.vue";
import UiLoadingBoundary from "../../components/UiLoadingBoundary.vue";
import ReturnToTop from "../../components/ReturnToTop.vue";
import MobileBrowseHeader from "../../components/MobileBrowseHeader.vue";
import { type PendingController } from "./usePendingController";

const props = defineProps<{
	controller: PendingController;
	surface: ResponsiveSurface;
}>();
const {
	scrollResetToken,
	boot,
	rows,
	total,
	overall,
	facets,
	quantityTotals,
	error,
	loading,
	loadingMore,
	filterOpen,
	desktopFilterOpen,
	operationCaps,
	filters,
	warehouseRows,
	summaryMetrics,
	warehouseText,
	chips,
	load,
	begin,
	removeChip,
	clearFilters,
	close,
} = props.controller;
const surface = toRef(props, "surface");
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
const sentinel = ref<HTMLElement>();
const resultsScroll = ref<HTMLElement>();
const browseHeading = ref<HTMLElement>();
const mobileBrowseHeader = ref<{ heading?: HTMLElement }>();
const compact = ref(false);
useCompactBrowse(resultsScroll, compact);
const pendingResults = ref<HTMLElement>();
const infiniteScroll = useInfiniteScroll({
	hasMore: () => rows.value.length < total.value,
	isLoading: () => loading.value || loadingMore.value,
	onLoadMore: () => load(true),
});
async function connectInfiniteScroll() {
	await nextTick();
	infiniteScroll.connect(resultsScroll.value || null, sentinel.value || null);
}
onMounted(() => {
	void connectInfiniteScroll();
});
watch(surface, () => void connectInfiniteScroll());
watch(scrollResetToken, async () => {
	await nextTick();
	if (typeof resultsScroll.value?.scrollTo === "function")
		resultsScroll.value.scrollTo({ top: 0 });
	else if (resultsScroll.value) resultsScroll.value.scrollTop = 0;
	compact.value = false;
});
function updateCompact(event: Event) {
	compact.value = (event.currentTarget as HTMLElement).scrollTop > 80;
}
onBeforeUnmount(() => infiniteScroll.disconnect());
</script>

<template>
	<section class="app-shell wide-shell viewport-list-root pending-page">
		<header v-if="surface === 'desktop'">
			<UiButton variant="ghost" size="compact" type="button" @click="close">‹ 库存</UiButton>
			<h1 ref="browseHeading" tabindex="-1">待处理</h1>
		</header>
		<MobileBrowseHeader
			v-else
			ref="mobileBrowseHeader"
			title="待处理"
			:compact="compact"
			destination-key="pending"
		>
			<template #back
				><button type="button" class="pending-back" @click="close">
					‹ 库存
				</button></template
			>
			<template #search-actions>
				<div class="pending-mobile-search">
					<input
						v-model="filters.search"
						type="search"
						placeholder="搜索物品或编号"
						aria-label="搜索待处理物品"
					/>
					<UiButton
						variant="secondary"
						size="compact"
						type="button"
						class="mobile-filter-button"
						:aria-expanded="desktopFilterOpen"
						:aria-label="`筛选，${filters.warehouses.length + filters.item_groups.length} 项已启用`"
						@click="openFilters($event)"
						>筛选<span
							v-if="filters.warehouses.length + filters.item_groups.length"
							class="filter-count"
							>{{ filters.warehouses.length + filters.item_groups.length }}</span
						></UiButton
					>
				</div>
			</template>
			<template #secondary>
				<div class="browse-result-meta">
					<ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearFilters" />
					<ResultCountStrip
						:loaded="rows.length"
						:filtered="total"
						:overall="overall ?? total"
						:updating="loading && rows.length > 0"
					/>
				</div>
			</template>
		</MobileBrowseHeader>
		<div
			class="list-layout desktop-list-layout compact-filter-layout pending-list-layout"
			:class="{ 'filters-open': desktopFilterOpen }"
		>
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="filters.warehouses.length + filters.item_groups.length"
				clearable
				@clear="clearFilters"
			>
				<CompactFilterSection title="仓库 / 位置" icon="warehouse">
					<WarehouseSelector
						v-model="filters.warehouses"
						:rows="warehouseRows"
						embedded
						:counts="facets.warehouses"
						placeholder="搜索仓库 / 位置"
					/>
				</CompactFilterSection>
				<CompactFilterSection title="物品类别" icon="card">
					<CategorySelector
						v-model="filters.item_groups"
						:rows="boot?.item_groups || []"
						embedded
						:counts="facets.item_groups"
						placeholder="搜索物品类别"
					/>
				</CompactFilterSection>
			</ResponsiveFilterPanel>
			<div
				ref="pendingResults"
				class="results-column pending-results"
				:class="{ 'is-refreshing': loading && rows.length }"
				:aria-busy="loading || loadingMore"
			>
				<div v-if="surface === 'desktop'" class="result-toolbar results-chrome">
					<input
						v-model="filters.search"
						type="search"
						placeholder="搜索物品或编号"
						aria-label="搜索待处理物品"
					/><UiButton
						variant="secondary"
						size="compact"
						type="button"
						class="toolbar-action desktop-filter-button mobile-filter-button"
						:aria-expanded="desktopFilterOpen"
						:aria-label="`筛选，${filters.warehouses.length + filters.item_groups.length} 项已启用`"
						@click="openFilters($event)"
					>
						筛选<span
							v-if="filters.warehouses.length + filters.item_groups.length"
							class="filter-count"
							>{{ filters.warehouses.length + filters.item_groups.length }}</span
						></UiButton
					>
				</div>
				<div v-if="surface === 'desktop'" class="browse-result-meta">
					<ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearFilters" />
					<ResultCountStrip
						:loaded="rows.length"
						:filtered="total"
						:overall="overall ?? total"
						:updating="loading && rows.length > 0"
					/>
				</div>
				<QuantitySummary
					v-if="surface === 'desktop'"
					:metrics="summaryMetrics"
					:loading="loading"
				/>
				<p v-if="error" class="error">
					{{ error }}
					<UiButton variant="ghost" size="compact" type="button" @click="load()"
						>重试</UiButton
					>
				</p>
				<UiLoadingBoundary
					v-if="loading && !rows.length"
					:busy="true"
					mode="initial"
					message="正在加载待处理物品…"
					:region="pendingResults"
					:block-interactions="false"
				/>
				<div
					v-if="loading && !rows.length"
					class="pending-loading-skeleton"
					aria-hidden="true"
				>
					<i v-for="index in 3" :key="index"></i>
				</div>
				<UiLoadingBoundary
					v-if="loading && rows.length"
					:busy="true"
					:region="resultsScroll"
					:scroll-element="resultsScroll"
					:dim-region="true"
					:block-interactions="false"
					class="list-refresh-overlay"
					message="正在更新待处理物品…"
				/>
				<div
					ref="resultsScroll"
					class="results-scroll"
					@scroll.passive="updateCompact"
					:inert="loading && rows.length ? true : undefined"
				>
					<QuantitySummary
						v-if="surface !== 'desktop'"
						:metrics="summaryMetrics"
						:loading="loading"
					/>
					<article
						v-for="row in rows"
						:key="row.item_code"
						class="selection-row result-card"
					>
						<RouterLink :to="`/item/${encodeURIComponent(row.item_code)}`"
							><b>{{ row.item_name }}</b
							><small
								>损坏 {{ row.damaged_qty }} {{ row.stock_uom }}</small
							></RouterLink
						>
						<div class="detail-actions">
							<UiButton
								variant="secondary"
								size="compact"
								v-if="row.damaged_qty && operationCaps.Repair"
								type="button"
								@click="begin(row, 'Repair')"
							>
								修复归库</UiButton
							><UiButton
								variant="danger"
								size="compact"
								v-if="row.damaged_qty && operationCaps.Disposal"
								type="button"
								@click="begin(row, 'Disposal')"
							>
								正式报废
							</UiButton>
						</div>
					</article>
					<p
						v-if="!rows.length && !error && !loading && !loadingMore"
						class="empty-state"
					>
						暂无损坏库存
					</p>
					<div ref="sentinel" aria-hidden="true"></div>
					<div v-if="loadingMore" class="mobile-loading" role="status">
						<span
							class="loading-spinner loading-spinner-small"
							aria-hidden="true"
						></span
						>正在加载更多…
					</div>
				</div>
			</div>
		</div>
		<ReturnToTop
			:target="resultsScroll"
			:heading="surface === 'desktop' ? browseHeading : mobileBrowseHeader?.heading"
			:hidden="Boolean(filterOpen)"
		/>
	</section>
</template>
<style scoped>
.pending-results {
	position: relative;
}
.pending-list-layout {
	min-height: 0;
	flex: 1;
}
.pending-page {
	display: flex;
	flex-direction: column;
}
.pending-list-layout,
.pending-results {
	min-width: 0;
}
.pending-loading-skeleton {
	display: grid;
	gap: 8px;
	margin-top: 10px;
}
.pending-loading-skeleton i {
	display: block;
	height: 42px;
	border-radius: 9px;
	background: #f0ebe3;
}
.pending-mobile-search {
	display: flex;
	min-width: 0;
	flex: 1;
	gap: 6px;
}
.pending-mobile-search > input {
	min-width: 0;
	flex: 1;
}
.pending-back {
	flex: none;
	min-height: 40px;
	padding: 6px 8px;
}
.loading-spinner-small {
	display: inline-block;
	width: 16px;
	height: 16px;
	margin-right: 6px;
	vertical-align: -3px;
	border-width: 2px;
}
@media (min-width: 1024px) {
	.pending-page {
		height: calc(100dvh - var(--shell-header-height, 0px));
	}
	.pending-list-layout {
		overflow: hidden;
	}
	.pending-page > .mobile-browse-header {
		flex: none;
		padding: 10px 12px 8px;
		background: #f8f7f4;
	}
	.pending-results {
		display: flex;
		flex-direction: column;
	}
	.pending-results > :not(.results-scroll) {
		flex: none;
	}
	.pending-results > .results-scroll {
		min-height: 0;
		flex: 1;
		overflow: auto;
		padding-bottom: 82px;
	}
}
@media (max-width: 1023px) {
	.pending-page {
		box-sizing: border-box;
		display: flex;
		height: calc(100dvh - var(--mobile-nav-height, 0px));
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
	}
	.pending-list-layout {
		flex: 1;
		overflow: hidden;
	}
	.pending-results {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.pending-results > :not(.results-scroll) {
		flex: none;
	}
	.pending-results > .results-scroll {
		min-height: 0;
		flex: 1;
		overflow: auto;
		padding-bottom: calc(var(--mobile-nav-height, 0px) + 105px);
	}
}
</style>
