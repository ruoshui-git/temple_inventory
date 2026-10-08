<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import type { ResponsiveSurface } from "../../composables/useResponsiveLayout";
import { labels } from "../../lib/api";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import CategorySelector from "../../components/CategorySelector.vue";
import DetailPopover from "../../components/DetailPopover.vue";
import IconButton from "../../components/IconButton.vue";
import MovementPeriodSelector, {
	type MovementPeriodKey,
} from "../../components/MovementPeriodSelector.vue";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import SortableDataTable, { type SortState } from "../../components/SortableDataTable.vue";
import WarehousePreview from "../../components/WarehousePreview.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import QuantitySummary from "../../components/QuantitySummary.vue";
import ExportDialog from "../../components/ExportDialog.vue";
import CompactFilterSection from "../../components/CompactFilterSection.vue";
import { type HistoryController } from "./useHistoryController";

const props = defineProps<{
	controller: HistoryController;
	surface: ResponsiveSurface;
}>();
const {
	scrollResetToken,
	boot,
	rows,
	total,
	overallTotal,
	quantityTotals,
	resolvedPeriod,
	facets,
	start,
	error,
	appendError,
	busy,
	refreshing,
	appending,
	filterOpen,
	desktopFilterOpen,
	exportOpen,
	pageLength,
	defaultSort,
	sort,
	movementKind,
	statusGroup,
	operationCaps,
	warehouseRows,
	scrollKey,
	filters,
	movementWarehouseColumns,
	movementColumns,
	adjustmentColumns,
	draftColumns,
	sortColumns,
	summaryMetrics,
	activeCount,
	warehouseText,
	locationsFor,
	warehouseColumnLabel,
	chips,
	removeChip,
	clearAll,
	requestFilters,
	exportFilters,
	routeQuery,
	load,
	applyQuery,
	operation,
	openReconciliation,
	activate,
	deleteDraft,
	close,
} = props.controller;
const surface = toRef(props, "surface");
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
const destination = props.controller.destination;
const resultsScroll = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
const restorationKey = props.controller.scrollKey;
const infiniteScroll = useInfiniteScroll({
	hasMore: () => rows.value.length < total.value,
	isLoading: () => busy.value || refreshing.value || appending.value,
	onLoadMore: () => load(true),
});
onMounted(async () => {
	await nextTick();
	infiniteScroll.connect(resultsScroll.value, sentinel.value);
	const saved = Number(sessionStorage.getItem(restorationKey.value) || 0);
	resultsScroll.value?.scrollTo?.({ top: saved });
});
watch(scrollResetToken, async () => {
	await nextTick();
	resultsScroll.value?.scrollTo?.({ top: 0 });
});
onBeforeUnmount(() => {
	sessionStorage.setItem(restorationKey.value, String(resultsScroll.value?.scrollTop || 0));
	infiniteScroll.disconnect();
});
</script>

<template>
	<main class="app-shell wide-shell viewport-list-root">
		<header v-if="destination === 'drafts'" class="browse-back">
			<button type="button" @click="close">‹ 更多</button>
		</header>
		<div
			class="list-layout desktop-list-layout compact-filter-layout"
			:class="{ 'filters-open': desktopFilterOpen }"
		>
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="activeCount"
				clearable
				@clear="clearAll"
			>
				<CompactFilterSection
					v-if="destination === 'drafts'"
					title="日期"
					icon="calendar"
					:collapsible="false"
				>
					<label class="sr-only" for="drafts-posting-date">日期</label>
					<input
						id="drafts-posting-date"
						v-model="filters.posting_date"
						type="date"
						aria-label="日期"
					/>
				</CompactFilterSection>
				<fieldset v-else-if="destination !== 'movements'">
					<legend>日期</legend>
					<input v-model="filters.posting_date" type="date" aria-label="日期" />
				</fieldset>
				<fieldset v-if="destination === 'adjustments'">
					<legend>类型</legend>
					<label
						><input v-model="filters.movement_kind" type="radio" value="" />全部</label
					>
					<label
						><input
							v-model="filters.movement_kind"
							type="radio"
							value="期初库存"
						/>期初库存</label
					>
					<label
						><input
							v-model="filters.movement_kind"
							type="radio"
							value="盘点调整"
						/>库存盘点</label
					>
				</fieldset>
				<CompactFilterSection title="物品类别" icon="card">
					<CategorySelector
						v-model="filters.item_groups"
						:rows="boot?.item_groups || []"
						:counts="facets.item_groups"
						embedded
					/>
				</CompactFilterSection>
				<CompactFilterSection title="仓库 / 位置" icon="warehouse">
					<WarehouseSelector
						v-if="destination === 'movements' && movementKind === 'Receive'"
						v-model="filters.destination_warehouses"
						:rows="warehouseRows"
						:counts="facets.destination_warehouses"
						title="入库位置"
						embedded
					/>
					<WarehouseSelector
						v-else-if="destination === 'movements' && movementKind === 'Issue'"
						v-model="filters.source_warehouses"
						:rows="warehouseRows"
						:counts="facets.source_warehouses"
						title="出库位置"
						embedded
					/>
					<template v-else-if="destination === 'movements'">
						<WarehouseSelector
							v-model="filters.source_warehouses"
							:rows="warehouseRows"
							:counts="facets.source_warehouses"
							title="来源位置"
							embedded
						/>
						<WarehouseSelector
							v-model="filters.destination_warehouses"
							:rows="warehouseRows"
							:counts="facets.destination_warehouses"
							title="去向位置"
							embedded
						/>
					</template>
					<WarehouseSelector
						v-else
						v-model="filters.warehouses"
						:rows="warehouseRows"
						:counts="facets.warehouses"
						title="位置"
						embedded
					/>
				</CompactFilterSection>
			</ResponsiveFilterPanel>
			<div class="results-column">
				<div class="results-chrome">
					<MovementPeriodSelector
						v-if="destination === 'movements'"
						v-model:period-key="filters.period_key"
						v-model:date-from="filters.date_from"
						v-model:date-to="filters.date_to"
						:resolved-from="resolvedPeriod.date_from"
						:resolved-to="resolvedPeriod.date_to"
					/>
					<div class="result-toolbar">
						<input
							v-model="filters.search"
							type="search"
							placeholder="搜索记录或物品"
							aria-label="搜索记录或物品"
						/>
						<button
							type="button"
							class="toolbar-action desktop-filter-button mobile-filter-button"
							:aria-expanded="desktopFilterOpen"
							@click="openFilters($event)"
						>
							筛选<span v-if="activeCount" class="filter-count">{{
								activeCount
							}}</span>
						</button>
						<IconButton
							class="mobile-filter-button"
							:label="activeCount ? `筛选，已启用 ${activeCount} 项` : '筛选'"
							title="筛选"
							@click="openFilters($event)"
							><svg aria-hidden="true" viewBox="0 0 24 24">
								<path d="M4 6h16M7 12h10M10 18h4" /></svg
							><span v-if="activeCount" class="icon-count">{{
								activeCount
							}}</span></IconButton
						>
						<button
							v-if="destination === 'movements'"
							type="button"
							@click="exportOpen = true"
						>
							导出
						</button>
						<span aria-live="polite">{{
							refreshing
								? "正在更新…"
								: `已加载 ${rows.length} · 筛选结果 ${total} · 全部记录 ${overallTotal}`
						}}</span>
					</div>
					<ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
					<QuantitySummary :metrics="summaryMetrics" :loading="busy || refreshing" />
				</div>
				<div ref="resultsScroll" class="results-scroll">
					<SortableDataTable
						:surface="surface"
						:rows="rows"
						:columns="sortColumns"
						row-key="name"
						:sort="sort"
						:loading="busy || refreshing"
						:loading-more="appending"
						:error="error"
						:empty-message="
							destination === 'drafts'
								? '暂无草稿'
								: destination === 'adjustments'
									? '暂无盘点调整记录'
									: '暂无货物流动记录'
						"
						@sort="sort = $event"
						@activate="activate"
					>
						<template #error
							>{{ error }}
							<button type="button" @click="load()">重试</button></template
						>
						<template #cell-movement_kind="{ row }">{{
							row.movement_kind === "盘点调整"
								? "库存盘点"
								: labels[row.movement_kind] || row.movement_kind
						}}</template>
						<template #cell-status="{ row }">{{
							row.docstatus === 0
								? "编辑中"
								: row.docstatus === 1
									? "已完成"
									: "已取消"
						}}</template>
						<template #cell-line_count="{ row }">{{ row.line_count ?? 0 }}</template>
						<template #cell-source_warehouses="{ row }">
							<WarehousePreview
								:locations="locationsFor(row, 'source')"
								:tree="warehouseRows"
								:label="warehouseColumnLabel('source')"
							/>
						</template>
						<template #cell-destination_warehouses="{ row }">
							<WarehousePreview
								:locations="locationsFor(row, 'destination')"
								:tree="warehouseRows"
								:label="warehouseColumnLabel('destination')"
							/>
						</template>
						<template #cell-category_count="{ row }">
							<DetailPopover
								:label="`查看 ${row.category_count ?? 0} 个类别`"
								:trigger-text="String(row.category_count ?? 0)"
							>
								<span
									v-for="category in row.categories || []"
									:key="category.item_group"
									>{{ category.item_group }}：{{ category.line_count }} 行<br
								/></span>
							</DetailPopover>
						</template>
						<template #cell-increase_line_count="{ row }">{{
							row.increase_line_count ?? 0
						}}</template>
						<template #cell-decrease_line_count="{ row }">{{
							row.decrease_line_count ?? 0
						}}</template>
						<template #cell-actions="{ row }"
							><button data-row-control type="button" @click="deleteDraft(row.name)">
								删除草稿
							</button></template
						>
						<template #mobile-row="{ row }">
							<article class="result-card" tabindex="0">
								<RouterLink
									data-row-action
									:to="
										row.document_type === 'Stock Reconciliation'
											? `/reconcile/${encodeURIComponent(row.name)}`
											: row.legacy
												? `/entry/${encodeURIComponent(row.name)}`
												: `/workspace/${encodeURIComponent(row.name)}`
									"
								>
									<b v-if="destination !== 'movements'">{{
										row.movement_kind === "盘点调整"
											? "库存盘点"
											: labels[row.movement_kind] || row.movement_kind
									}}</b>
									<b v-else>{{ row.posting_date }}</b>
									<p v-if="destination === 'adjustments'">
										{{ row.posting_date }} · 增加
										{{ row.increase_line_count ?? 0 }} 行 · 减少
										{{ row.decrease_line_count ?? 0 }} 行
									</p>
									<p v-else-if="destination === 'movements'">
										物品 {{ row.line_count ?? 0 }} 行 · 类别
										{{ row.category_count ?? 0 }} 个
									</p>
									<p v-else>
										{{ row.posting_date }} · {{ row.line_count ?? 0 }} 行
									</p>
									<small>{{
										row.docstatus === 0
											? "编辑中"
											: row.docstatus === 1
												? "已完成"
												: "已取消"
									}}</small>
								</RouterLink>
								<div
									v-if="destination === 'movements'"
									class="movement-card-warehouses"
								>
									<div
										v-for="column in movementWarehouseColumns"
										:key="column.key"
										class="movement-card-warehouse"
									>
										<small>{{ column.label }}</small>
										<WarehousePreview
											:locations="locationsFor(row, column.role)"
											:tree="warehouseRows"
											:label="column.label"
										/>
									</div>
								</div>
								<button
									v-if="destination === 'drafts'"
									data-row-control
									type="button"
									@click="deleteDraft(row.name)"
								>
									删除草稿
								</button>
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
		<button
			v-if="destination === 'movements' && operationCaps[movementKind]"
			type="button"
			class="action-fab"
			:aria-label="`新建${labels[movementKind]}`"
			@click="operation(movementKind)"
		>
			＋
		</button>
		<button
			v-else-if="destination === 'adjustments' && boot?.can_reconcile_stock"
			type="button"
			class="action-fab"
			aria-label="新建盘点调整"
			@click="openReconciliation"
		>
			＋
		</button>
		<ExportDialog
			v-if="destination === 'movements'"
			v-model:open="exportOpen"
			report-type="movement"
			:filters="exportFilters"
			:title="`导出${labels[movementKind] || '货物流动'}`"
			summary="沿用当前时间、动作、来源或去向位置、类别、搜索和排序条件。"
		/>
	</main>
</template>
<style scoped>
.movement-card-warehouses {
	display: grid;
	gap: 8px;
	padding: 0 14px 14px;
}

.movement-card-warehouse {
	display: grid;
	gap: 3px;
}

.movement-card-warehouse > small {
	color: #6b6257;
	font-weight: 600;
}
</style>
