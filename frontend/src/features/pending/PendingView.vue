<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import type { ResponsiveSurface } from "../../composables/useResponsiveLayout";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import CategorySelector from "../../components/CategorySelector.vue";
import LoadingIndicator from "../../components/LoadingIndicator.vue";
import QuantitySummary from "../../components/QuantitySummary.vue";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import CompactFilterSection from "../../components/CompactFilterSection.vue";
import UiButton from "../../components/UiButton.vue";
import ResultCountStrip from "../../components/ResultCountStrip.vue";
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
const infiniteScroll = useInfiniteScroll({
	hasMore: () => rows.value.length < total.value,
	isLoading: () => loading.value || loadingMore.value,
	onLoadMore: () => load(true),
});
onMounted(async () => {
	await nextTick();
	infiniteScroll.connect(null, sentinel.value);
});
onBeforeUnmount(() => infiniteScroll.disconnect());
</script>

<template>
	<section class="app-shell wide-shell">
		<header>
			<UiButton variant="ghost" size="compact" type="button" @click="close">‹ 库存</UiButton>
			<h1>待处理</h1>
		</header>
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
				class="results-column pending-results"
				:class="{ 'is-refreshing': loading && rows.length }"
				:aria-busy="loading || loadingMore"
			>
				<div class="result-toolbar results-chrome">
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
				<div class="browse-result-meta">
					<ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearFilters" />
					<ResultCountStrip
						:loaded="rows.length"
						:filtered="total"
						:overall="overall ?? total"
						:updating="loading && rows.length > 0"
					/>
				</div>
				<QuantitySummary :metrics="summaryMetrics" :loading="loading" />
				<p v-if="error" class="error">
					{{ error }}
					<UiButton variant="ghost" size="compact" type="button" @click="load()"
						>重试</UiButton
					>
				</p>
				<LoadingIndicator v-if="loading && !rows.length" text="正在加载待处理物品…" />
				<div
					v-if="loading && !rows.length"
					class="pending-loading-skeleton"
					aria-hidden="true"
				>
					<i v-for="index in 3" :key="index"></i>
				</div>
				<div v-if="loading && rows.length" class="list-refresh-overlay" role="status">
					<span class="loading-spinner" aria-hidden="true"></span>正在更新待处理物品…
				</div>
				<article
					v-for="row in rows"
					:key="row.item_code"
					class="selection-row result-card"
				>
					<RouterLink :to="`/item/${encodeURIComponent(row.item_code)}`"
						><b>{{ row.item_name }}</b
						><small>损坏 {{ row.damaged_qty }} {{ row.stock_uom }}</small></RouterLink
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
				<p v-if="!rows.length && !error && !loading && !loadingMore" class="empty-state">
					暂无损坏库存
				</p>
				<div ref="sentinel" aria-hidden="true"></div>
				<div v-if="loadingMore" class="mobile-loading" role="status">
					<span class="loading-spinner loading-spinner-small" aria-hidden="true"></span
					>正在加载更多…
				</div>
			</div>
		</div>
	</section>
</template>
<style scoped>
.list-refresh-overlay {
	position: absolute;
	inset: 0;
	z-index: 2;
	display: flex;
	justify-content: center;
	gap: 8px;
	padding-top: 18px;
	background: rgb(255 253 249 / 60%);
	color: #704d2e;
	font-weight: 700;
	pointer-events: none;
}
.pending-results {
	position: relative;
}
.pending-results.is-refreshing > article {
	opacity: 0.55;
	pointer-events: none;
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
.loading-spinner-small {
	display: inline-block;
	width: 16px;
	height: 16px;
	margin-right: 6px;
	vertical-align: -3px;
	border-width: 2px;
}
</style>
