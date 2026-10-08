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
import QuantitySummary from "../../components/QuantitySummary.vue";
import MovementLookup from "../../components/MovementLookup.vue";
import CompactFilterSection from "../../components/CompactFilterSection.vue";
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
	activityOptions,
	activeCount,
	chips,
	load,
	scheduleLoad,
	removeChip,
	clearFilters,
	openLoan,
	createLoan,
} = props.controller;
const surface = toRef(props, "surface");
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
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
						embedded
						placeholder="原始借出位置"
					/>
				</CompactFilterSection>
				<CompactFilterSection title="物品类别" icon="card">
					<CategorySelector
						v-model="filters.item_groups"
						:rows="boot?.item_groups || []"
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
					<div class="result-toolbar">
						<input
							v-model="filters.search"
							type="search"
							placeholder="搜索借用方、记录、活动或物品"
							aria-label="搜索借用记录"
						/><button
							type="button"
							class="toolbar-action desktop-filter-button"
							:aria-expanded="desktopFilterOpen"
							@click="openFilters($event)"
						>
							筛选<span v-if="activeCount" class="filter-count">{{
								activeCount
							}}</span></button
						><IconButton
							class="mobile-filter-button"
							:label="activeCount ? `筛选，已启用 ${activeCount} 项` : '筛选'"
							title="筛选"
							@click="openFilters($event)"
							><svg aria-hidden="true" viewBox="0 0 24 24">
								<path d="M4 6h16M7 12h10M10 18h4" /></svg
							><span v-if="activeCount" class="icon-count">{{
								activeCount
							}}</span></IconButton
						><span aria-live="polite"
							>已加载 {{ rows.length }} · 筛选结果 {{ total }}</span
						>
					</div>
					<ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearFilters" />
					<QuantitySummary :metrics="summaryMetrics" :loading="loading" />
				</div>
				<div ref="resultsScroll" class="results-scroll">
					<SortableDataTable
						:surface="surface"
						:rows="rows"
						:columns="columns"
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
							<button type="button" @click="load()">重试</button></template
						>
						<template #cell-activity_title="{ row }">{{
							row.activity_title || row.activity || "—"
						}}</template>
						<template #cell-loan_status="{ row }">{{
							statusLabel(row.loan_status)
						}}</template>
						<template #mobile-row="{ row }"
							><article class="result-card" tabindex="0">
								<RouterLink
									data-row-action
									:to="'/loans/' + encodeURIComponent(row.name)"
									><b>{{ row.borrower }}</b
									><small
										>{{ row.loan_date }} ·
										{{ row.activity_title || row.activity || "无活动" }}</small
									><span
										>物品 {{ row.line_count }} 行 · 未结
										{{ row.outstanding_lines }} 行 ·
										{{ statusLabel(row.loan_status) }}</span
									><span v-for="item in row.items || []" :key="item.loan_item"
										><ItemImagePreview
											:src="item.image"
											:alt="item.item_name"
										/>
										{{ item.item_name }} {{ item.outstanding }}
										{{ item.uom }}</span
									></RouterLink
								>
							</article></template
						>
					</SortableDataTable>
					<div ref="sentinel" aria-hidden="true"></div>
				</div>
			</div>
		</div>
		<button
			v-if="boot?.stock_operation_capabilities?.Loan"
			type="button"
			class="action-fab"
			aria-label="新建借出"
			@click="createLoan"
		>
			＋
		</button>
	</section>
</template>
