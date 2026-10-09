<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import type { ResponsiveSurface } from "../../composables/useResponsiveLayout";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import CategorySelector from "../../components/CategorySelector.vue";
import IconButton from "../../components/IconButton.vue";
import ItemImagePreview from "../../components/ItemImagePreview.vue";
import MovementPeriodSelector, {
	type MovementPeriodKey,
} from "../../components/MovementPeriodSelector.vue";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import SortableDataTable, { type SortState } from "../../components/SortableDataTable.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import ExportDialog from "../../components/ExportDialog.vue";
import UiButton from "../../components/UiButton.vue";
import { labels } from "../../lib/api";
import { type MovementOverviewController } from "./useMovementOverviewController";

const props = defineProps<{
	controller: MovementOverviewController;
	surface: ResponsiveSurface;
}>();
const {
	actionGroups,
	allKinds,
	scrollResetToken,
	boot,
	rows,
	total,
	summaries,
	columnSummaries,
	facets,
	resolved,
	busy,
	refreshing,
	appending,
	error,
	appendError,
	filterOpen,
	exportOpen,
	pageLength,
	defaultSort,
	sort,
	filters,
	columns,
	activeCount,
	warehouseRows,
	recordTotal,
	chips,
	formatQuantity,
	actionSummary,
	openItem,
	nonzeroActions,
	toggleKind,
	removeChip,
	clearAll,
	requestFilters,
	exportFilters,
	routeQuery,
	applyQuery,
	load,
} = props.controller;
const surface = toRef(props, "surface");
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
const resultsScroll = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
const restorationKey = "temple_inventory.scroll.movement-overview";
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
	<main class="app-shell wide-shell viewport-list-root movement-overview">
		<div class="list-layout desktop-list-layout">
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="activeCount"
			>
				<fieldset>
					<legend>动作</legend>
					<label v-for="kind in allKinds" :key="kind" class="choice-row">
						<input
							type="checkbox"
							:checked="filters.movement_kinds.includes(kind)"
							@change="toggleKind(kind)"
						/>
						<span>{{ labels[kind] }}</span>
					</label>
				</fieldset>
				<CategorySelector
					v-model="filters.item_groups"
					:rows="boot?.item_groups || []"
					:counts="facets.item_groups"
				/>
				<WarehouseSelector
					v-model="filters.warehouses"
					:rows="warehouseRows"
					:counts="facets.warehouses"
					title="位置"
				/>
			</ResponsiveFilterPanel>
			<div class="results-column">
				<div class="results-chrome">
					<MovementPeriodSelector
						v-model:period-key="filters.period_key"
						v-model:date-from="filters.date_from"
						v-model:date-to="filters.date_to"
						:resolved-from="resolved.date_from"
						:resolved-to="resolved.date_to"
					/>
					<div class="result-toolbar">
						<input
							v-model="filters.search"
							type="search"
							placeholder="搜索物品名称或编码"
							aria-label="搜索物品名称或编码"
						/>
						<IconButton
							class="mobile-filter-button"
							:label="activeCount ? `筛选，已启用 ${activeCount} 项` : '筛选'"
							@click="filterPanel?.openPanel($event)"
							><svg aria-hidden="true" viewBox="0 0 24 24">
								<path d="M4 6h16M7 12h10M10 18h4" /></svg
						></IconButton>
						<UiButton icon="download" @click="exportOpen = true">导出</UiButton>
						<span aria-live="polite">{{
							refreshing
								? "正在更新…"
								: `涉及 ${total} 种物品 · ${recordTotal} 条记录`
						}}</span>
					</div>
					<ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
					<div class="movement-summary-groups" aria-label="动作汇总">
						<section v-for="group in actionGroups" :key="group.label">
							<h2>{{ group.label }}</h2>
							<div class="movement-summary-grid">
								<button
									v-for="kind in group.kinds"
									:key="kind"
									type="button"
									class="movement-summary-card"
									:aria-pressed="filters.movement_kinds.includes(kind)"
									@click="toggleKind(kind)"
								>
									<small>{{ labels[kind] }}</small>
									<span v-if="busy" class="summary-loading">正在更新…</span>
									<strong v-else-if="actionSummary(kind).quantities.length">
										<span
											v-for="quantity in actionSummary(kind).quantities"
											:key="quantity.uom"
											>{{ formatQuantity(quantity.qty) }}
											{{ quantity.uom }}</span
										>
									</strong>
									<strong v-else>0</strong>
									<span class="summary-counts"
										>{{ actionSummary(kind).item_count }} 种物品 ·
										{{ actionSummary(kind).record_count }} 条记录</span
									>
								</button>
							</div>
						</section>
					</div>
				</div>
				<div ref="resultsScroll" class="results-scroll">
					<SortableDataTable
						:surface="surface"
						:rows="rows"
						:columns="columns"
						:column-summaries="columnSummaries"
						row-key="item_code"
						:sort="sort"
						:loading="busy || refreshing"
						:loading-more="appending"
						:error="error"
						empty-message="所选时间和筛选条件下暂无货物流动"
						@sort="sort = $event"
						@activate="(row) => openItem(row.item_code)"
					>
						<template #error
							>{{ error }}
							<button type="button" @click="load()">重试</button></template
						>
						<template #cell-item_name="{ row }">
							<div class="primary-cell">
								<span data-row-control
									><ItemImagePreview :src="row.image" :alt="row.item_name"
								/></span>
								<RouterLink
									data-row-action
									:to="`/item/${encodeURIComponent(row.item_code)}`"
									><b class="primary-text">{{ row.item_name }}</b
									><small class="secondary-text">{{
										row.item_code
									}}</small></RouterLink
								>
							</div>
						</template>
						<template #cell-movement_totals="{ row }">
							<div class="movement-detail-values">
								<span v-for="kind in nonzeroActions(row)" :key="kind">
									{{ labels[kind] }}
									{{ formatQuantity(row.movement_totals[kind]) }}
									{{ row.stock_uom }}
								</span>
							</div>
						</template>
						<template #mobile-row="{ row }">
							<article class="item-card result-card movement-item-card" tabindex="0">
								<span data-row-control
									><ItemImagePreview :src="row.image" :alt="row.item_name"
								/></span>
								<RouterLink
									data-row-action
									:to="`/item/${encodeURIComponent(row.item_code)}`"
								>
									<b>{{ row.item_name }}</b>
									<small>{{ row.item_code }} · {{ row.item_group }}</small>
									<span
										v-for="kind in nonzeroActions(row)"
										:key="kind"
										class="movement-mobile-value"
										>{{ labels[kind] }}
										{{ formatQuantity(row.movement_totals[kind]) }}
										{{ row.stock_uom }}</span
									>
									<small
										>{{ row.record_count }} 条记录 · 最近
										{{ row.last_posting_date }}</small
									>
								</RouterLink>
							</article>
						</template>
					</SortableDataTable>
					<div ref="sentinel" aria-hidden="true"></div>
					<div v-if="appendError" class="table-append-error" role="alert">
						{{ appendError }} <button type="button" @click="load(true)">重试</button>
					</div>
				</div>
			</div>
		</div>
		<ExportDialog
			v-model:open="exportOpen"
			report-type="movement"
			:filters="exportFilters"
			title="导出货物流动"
			summary="沿用当前时间、动作、物品类别、位置、搜索和排序条件，包含汇总与记录明细。"
		/>
	</main>
</template>
<style scoped>
.movement-summary-groups {
	display: grid;
	gap: 8px;
	padding-bottom: 10px;
}
.movement-summary-groups h2 {
	margin: 4px 0 6px;
	font-size: 14px;
	color: #6b6257;
}
.movement-summary-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: 8px;
}
.movement-summary-card {
	display: grid;
	align-content: start;
	gap: 5px;
	min-width: 0;
	min-height: 102px;
	padding: 10px 12px;
	text-align: left;
	background: #fffaf2;
}
.movement-summary-card[aria-pressed="true"] {
	border-color: #9b571d;
	box-shadow: inset 0 0 0 2px #9b571d;
}
.movement-summary-card small,
.summary-counts,
.summary-loading {
	color: #6b6257;
}
.movement-summary-card strong {
	display: flex;
	flex-wrap: wrap;
	gap: 3px 9px;
	font-variant-numeric: tabular-nums;
}
.movement-detail-values {
	display: grid;
	gap: 4px;
	font-variant-numeric: tabular-nums;
}
.movement-item-card {
	align-items: flex-start;
}
.movement-item-card > a {
	display: grid;
	gap: 4px;
}
.movement-mobile-value {
	display: block;
	font-variant-numeric: tabular-nums;
}
@media (max-width: 600px) {
	.movement-summary-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.movement-summary-card {
		min-height: 112px;
	}
}
</style>
