<script setup lang="ts">
import "../../components/browse-surface.css";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
import { useCompactBrowse } from "../../composables/useCompactBrowse";
import type { ResponsiveSurface } from "../../composables/useResponsiveLayout";
import CategorySelector from "../../components/CategorySelector.vue";
import ExportDialog from "../../components/ExportDialog.vue";
import MovementLookup from "../../components/MovementLookup.vue";
import MovementPeriodSelector, {
	type MovementPeriodKey,
} from "../../components/MovementPeriodSelector.vue";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.vue";
import SortableDataTable, {
	type DataTableColumn,
	type SortState,
} from "../../components/SortableDataTable.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import UiButton from "../../components/UiButton.vue";
import TruncatedTextPopover from "../../components/TruncatedTextPopover.vue";
import ItemImagePreview from "../../components/ItemImagePreview.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import CompactFilterSection from "../../components/CompactFilterSection.vue";
import ColumnSummaryDialog from "../../components/ColumnSummaryDialog.vue";
import FloatingActionMenu from "../../components/FloatingActionMenu.vue";
import PageActionMenu from "../../components/PageActionMenu.vue";
import ResultCountStrip from "../../components/ResultCountStrip.vue";
import ActiveFilterChips from "../../components/ActiveFilterChips.vue";
import MovementLocation from "../../components/MovementLocation.vue";
import MovementFlow from "../../components/MovementFlow.vue";
import MobileSubnav from "../../components/MobileSubnav.vue";
import ReturnToTop from "../../components/ReturnToTop.vue";
import MobileBrowseHeader from "../../components/MobileBrowseHeader.vue";
import ColumnSummaryTrigger from "../../components/ColumnSummaryTrigger.vue";
import { type MovementsController, type Kind } from "./useMovementsController";

const props = defineProps<{
	controller: MovementsController;
	surface: ResponsiveSurface;
}>();
const {
	scrollResetToken,
	contextItems,
	mode,
	kinds,
	kindLabels,
	boot,
	itemOptions,
	activityOptions,
	itemQuery,
	activityQuery,
	filterOptionsBusy,
	rows,
	total,
	allTotal,
	counts,
	columnSummaries,
	resolved,
	busy,
	loadingMore,
	error,
	filterOpen,
	desktopFilterOpen,
	exportOpen,
	compact,
	zeroKindsExpanded,
	pageLength,
	filters,
	warehouseRows,
	operationKinds,
	pageActions,
	kindMeta,
	visibleKinds,
	zeroKindCount,
	tableColumns,
	tableSort,
	rowKey,
	activeFilterCount,
	chips,
	periodFilters,
	exportFilters,
	itemSelectOptions,
	activitySelectOptions,
	scheduleFilterOptionSearch,
	loadFilterOptions,
	location,
	kindLabel,
	flow,
	fromLocation,
	toLocation,
	recordFlow,
	quantity,
	displayTime,
	recordQuantity,
	toggleKind,
	clearKinds,
	clearFilters,
	removeChip,
	clearAll,
	onResultsScroll,
	openRow,
	openOperation,
	openReconciliation,
	recordRoute,
	queryArgs,
	load,
	applyRouteQuery,
} = props.controller;
const surface = toRef(props, "surface");
const summaryOpen = ref(false);
const pageActionsDisabled = computed(
	() =>
		pageActions.value.length > 0 &&
		pageActions.value.every((action) => action.disabled || action.loading),
);
function selectPageAction(kind: string) {
	if (kind === "Reconcile") return openReconciliation();
	return openOperation(kind);
}
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
const scrollRoot = ref<HTMLElement>();
useCompactBrowse(scrollRoot, compact);
const browseHeading = ref<HTMLElement>();
const mobileBrowseHeader = ref<{ heading?: HTMLElement }>();
const floatingActionsOpen = ref(false);
const sentinel = ref<HTMLElement>();
const infiniteScroll = useInfiniteScroll({
	hasMore: () => rows.value.length < total.value,
	isLoading: () => busy.value || loadingMore.value,
	onLoadMore: () => load(true),
});
onMounted(async () => {
	await nextTick();
	infiniteScroll.connect(scrollRoot.value, sentinel.value);
});
watch(scrollResetToken, async () => {
	await nextTick();
	scrollRoot.value?.scrollTo?.({ top: 0 });
	compact.value = false;
});
onBeforeUnmount(() => infiniteScroll.disconnect());
</script>

<template>
	<main class="app-shell wide-shell viewport-list-root movement-ledger">
		<div
			class="list-layout desktop-list-layout"
			:class="{ 'filters-open': desktopFilterOpen }"
		>
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="activeFilterCount"
				clearable
				@clear="clearFilters"
			>
				<CompactFilterSection v-if="mode === 'items'" title="物品类别" icon="card">
					<CategorySelector
						v-if="mode === 'items'"
						v-model="filters.item_groups"
						:rows="boot?.item_groups || []"
						embedded
					/>
				</CompactFilterSection>
				<CompactFilterSection v-if="mode === 'items'" title="物品" icon="search">
					<label class="movement-filter-field"
						><span class="sr-only">物品</span
						><MovementLookup
							v-model="filters.item_code"
							v-model:query="itemQuery"
							:options="itemSelectOptions"
							:loading="filterOptionsBusy"
							placeholder="搜索物品名称或编码"
							aria-label="物品"
							@update:query="
								scheduleFilterOptionSearch('item', String($event || ''))
							"
					/></label>
				</CompactFilterSection>
				<CompactFilterSection title="来源位置" icon="warehouse">
					<WarehouseSelector
						v-model="filters.source_warehouses"
						:rows="warehouseRows"
						embedded
						title="来源位置"
					/>
				</CompactFilterSection>
				<CompactFilterSection title="去向位置" icon="warehouse">
					<WarehouseSelector
						v-model="filters.destination_warehouses"
						:rows="warehouseRows"
						embedded
						title="去向位置"
					/>
				</CompactFilterSection>
				<CompactFilterSection title="活动" icon="calendar">
					<label class="movement-filter-field"
						><span class="sr-only">活动</span
						><MovementLookup
							v-model="filters.activity"
							v-model:query="activityQuery"
							:options="activitySelectOptions"
							:loading="filterOptionsBusy"
							placeholder="搜索活动标题"
							aria-label="活动"
							@update:query="
								scheduleFilterOptionSearch('activity', String($event || ''))
							"
					/></label>
				</CompactFilterSection>
				<CompactFilterSection v-if="mode === 'records'" title="状态" icon="filter">
					<fieldset>
						<legend class="sr-only">状态</legend>
						<label
							v-for="status in [
								{ value: 1, label: '已完成' },
								{ value: 0, label: '草稿' },
								{ value: 2, label: '已取消' },
							]"
							:key="status.value"
							class="choice-row"
							><input
								v-model="filters.docstatuses"
								type="checkbox"
								:value="status.value"
							/>{{ status.label }}</label
						>
					</fieldset>
				</CompactFilterSection>
			</ResponsiveFilterPanel>
			<div class="results-column" :class="{ compact }">
				<header
					v-if="surface === 'desktop'"
					class="movement-ledger-header browse-results-header results-chrome"
				>
					<div class="movement-heading">
						<b class="compact-heading" aria-hidden="true"
							>货物流动 · {{ mode === "items" ? "明细" : "记录" }}</b
						>
						<div class="movement-title">
							<h1 ref="browseHeading" :class="{ 'sr-only': compact }" tabindex="-1">
								货物流动 · {{ mode === "items" ? "明细" : "记录" }}
							</h1>
						</div>
						<MovementPeriodSelector
							v-model:period-key="filters.period_key"
							v-model:date-from="filters.date_from"
							v-model:date-to="filters.date_to"
							:resolved-from="resolved.date_from"
							:resolved-to="resolved.date_to"
							variant="ledger"
							:compact="compact"
						/>
					</div>
					<div class="result-toolbar movement-ledger-actions">
						<label class="movement-search browse-search-field"
							><span aria-hidden="true">⌕</span
							><input
								v-model="filters.search"
								type="search"
								:placeholder="
									mode === 'items'
										? '搜索物品名称、编码或记录编号…'
										: '搜索记录编号、活动或备注…'
								"
								aria-label="搜索货物流动"
						/></label>
						<UiButton
							variant="secondary"
							size="compact"
							icon="filter"
							type="button"
							class="toolbar-action movement-filter-button"
							:class="{ active: desktopFilterOpen || filterOpen }"
							:aria-expanded="desktopFilterOpen || filterOpen"
							@click="openFilters($event)"
						>
							筛选<span
								><b v-if="activeFilterCount"> {{ activeFilterCount }}</b></span
							>
						</UiButton>
						<UiButton
							v-if="surface === 'desktop'"
							class="toolbar-action"
							icon="download"
							size="compact"
							@click="exportOpen = true"
							>导出</UiButton
						>
						<ColumnSummaryTrigger @click="summaryOpen = true" />
						<PageActionMenu
							v-if="surface === 'desktop' && pageActions.length"
							:actions="pageActions"
							:disabled="pageActionsDisabled"
							label="新增记录"
							@select="selectPageAction"
						/>
					</div>
					<div class="browse-result-meta">
						<div class="movement-active-filter-row">
							<ActiveFilterChips
								:chips="chips"
								@remove="removeChip"
								@clear="clearAll"
							/>
							<div class="movement-result-count-line">
								<ResultCountStrip
									class="movement-result-count"
									:loaded="rows.length"
									:filtered="total"
									:overall="allTotal ?? total"
									:updating="busy && rows.length > 0"
								/>
							</div>
						</div>
						<div class="movement-kind-chips" role="toolbar" aria-label="动作筛选">
							<button
								type="button"
								:aria-pressed="!filters.kinds.length"
								@click="clearKinds"
							>
								全部 <span>{{ allTotal }}</span></button
							><button
								v-for="kind in kinds"
								:key="kind"
								v-show="visibleKinds.includes(kind)"
								type="button"
								class="movement-kind-chip"
								:class="{
									'movement-kind-chip-zero': !visibleKinds.includes(kind),
									'movement-kind-chip-empty': Number(counts[kind] || 0) === 0,
								}"
								:aria-hidden="!visibleKinds.includes(kind)"
								:tabindex="visibleKinds.includes(kind) ? 0 : -1"
								:disabled="!visibleKinds.includes(kind)"
								:data-kind="kind"
								:data-tone="kindMeta[kind].tone"
								:aria-pressed="filters.kinds.includes(kind)"
								@click="toggleKind(kind)"
							>
								<span class="kind-icon" aria-hidden="true">{{
									kindMeta[kind].icon
								}}</span>
								{{ kindMeta[kind].label }} <span>{{ counts[kind] || 0 }}</span>
							</button>
							<button
								v-if="zeroKindCount"
								type="button"
								class="movement-zero-kinds-toggle"
								:aria-expanded="zeroKindsExpanded"
								:aria-label="
									zeroKindsExpanded
										? '收起无记录动作'
										: `展开无记录 ${zeroKindCount}`
								"
								@click="zeroKindsExpanded = !zeroKindsExpanded"
							>
								{{ zeroKindsExpanded ? "收起无记录" : `无记录 ${zeroKindCount}` }}
							</button>
						</div>
					</div>
				</header>
				<MobileBrowseHeader
					v-else
					ref="mobileBrowseHeader"
					:title="`货物流动 · ${mode === 'items' ? '明细' : '记录'}`"
					short-title="流动"
					:compact="compact"
					:destination-key="`movement-${mode}`"
				>
					<template #tabs>
						<MobileSubnav
							:items="contextItems"
							:active-key="mode"
							:compact="compact"
							aria-label="货物流动页面"
						/>
					</template>
					<template #search-actions>
						<label class="movement-search browse-search-field mobile-movement-search">
							<span aria-hidden="true">⌕</span>
							<input
								v-model="filters.search"
								type="search"
								:placeholder="
									mode === 'items'
										? '搜索物品名称、编码或记录编号…'
										: '搜索记录编号、活动或备注…'
								"
								aria-label="搜索货物流动"
							/>
						</label>
						<UiButton
							variant="secondary"
							size="compact"
							icon="filter"
							type="button"
							class="toolbar-action movement-filter-button"
							:aria-label="`筛选，${activeFilterCount} 项已启用`"
							@click="openFilters($event)"
						>
							筛选<span v-if="activeFilterCount">{{ activeFilterCount }}</span>
						</UiButton>
					</template>
					<template #secondary>
						<MovementPeriodSelector
							v-model:period-key="filters.period_key"
							v-model:date-from="filters.date_from"
							v-model:date-to="filters.date_to"
							:resolved-from="resolved.date_from"
							:resolved-to="resolved.date_to"
							variant="ledger"
							:compact="compact"
						/>
						<div class="browse-result-meta">
							<ActiveFilterChips
								:chips="chips"
								@remove="removeChip"
								@clear="clearAll"
							/>
							<ResultCountStrip
								:loaded="rows.length"
								:filtered="total"
								:overall="allTotal ?? total"
								:updating="busy && rows.length > 0"
							/>
						</div>
						<div class="movement-kind-chips" role="toolbar" aria-label="动作筛选">
							<button
								type="button"
								:aria-pressed="!filters.kinds.length"
								@click="clearKinds"
							>
								全部 <span>{{ allTotal }}</span>
							</button>
							<button
								v-for="kind in kinds"
								:key="kind"
								v-show="visibleKinds.includes(kind)"
								type="button"
								class="movement-kind-chip"
								:class="{
									'movement-kind-chip-zero': !visibleKinds.includes(kind),
									'movement-kind-chip-empty': Number(counts[kind] || 0) === 0,
								}"
								:aria-hidden="!visibleKinds.includes(kind)"
								:tabindex="visibleKinds.includes(kind) ? 0 : -1"
								:data-kind="kind"
								:data-tone="kindMeta[kind].tone"
								:aria-pressed="filters.kinds.includes(kind)"
								:disabled="!visibleKinds.includes(kind)"
								@click="toggleKind(kind)"
							>
								{{ kindMeta[kind].label }} <span>{{ counts[kind] || 0 }}</span>
							</button>
							<button
								v-if="zeroKindCount"
								type="button"
								class="movement-zero-kinds-toggle"
								:aria-expanded="zeroKindsExpanded"
								:aria-label="
									zeroKindsExpanded
										? '收起无记录动作'
										: `展开无记录 ${zeroKindCount}`
								"
								@click="zeroKindsExpanded = !zeroKindsExpanded"
							>
								{{ zeroKindsExpanded ? "收起无记录" : `无记录 ${zeroKindCount}` }}
							</button>
						</div>
						<ColumnSummaryTrigger @click="summaryOpen = true" />
					</template>
				</MobileBrowseHeader>
				<div
					ref="scrollRoot"
					class="results-scroll browse-compact-table"
					@scroll.passive="onResultsScroll"
				>
					<SortableDataTable
						:surface="surface"
						:rows="rows"
						:columns="tableColumns"
						:column-summaries="columnSummaries"
						:row-key="rowKey"
						:sort="tableSort"
						:loading="busy"
						:loading-more="loadingMore"
						:show-summary="false"
						:error="error"
						empty-message="所选时间和筛选条件下暂无记录"
						@activate="openRow"
					>
						<template #error
							>{{ error }}
							<button type="button" @click.stop="load()">重试</button></template
						>
						<template #cell-date="{ row }"
							><span class="movement-date"
								>{{ row.posting_date
								}}<small>{{ displayTime(row.posting_time) }}</small></span
							></template
						>
						<template #cell-item="{ row }"
							><div class="movement-item-cell">
								<ItemImagePreview
									:src="row.image || undefined"
									:alt="row.item_name"
								/>
								<span
									>{{ row.item_name }}<small>{{ row.item_code }}</small></span
								>
							</div></template
						>
						<template #cell-record="{ row }"
							><RouterLink :to="recordRoute(row)" data-row-control @click.stop>{{
								row.record_name
							}}</RouterLink
							><span
								v-if="mode === 'records' && row.docstatus === 0"
								class="status-badge status-badge--draft"
								>草稿</span
							><span
								v-else-if="mode === 'records' && row.docstatus === 2"
								class="status-badge status-badge--cancelled"
								>已取消</span
							></template
						>
						<template #cell-action="{ row }"
							><span
								class="movement-badge"
								:data-kind="row.movement_kind"
								:data-tone="kindMeta[row.movement_kind as Kind]?.tone"
								><span aria-hidden="true">{{
									kindMeta[row.movement_kind as Kind]?.icon
								}}</span
								>{{ kindLabel(row.movement_kind as Kind) }}</span
							></template
						>
						<template #cell-quantity="{ row }">{{
							mode === "items" ? quantity(row) : recordQuantity(row)
						}}</template>
						<template #cell-from="{ row }"
							><MovementLocation :name="row.source_warehouse" :rows="warehouseRows"
						/></template>
						<template #cell-to="{ row }"
							><MovementLocation
								:name="row.destination_warehouse"
								:rows="warehouseRows"
						/></template>
						<template #cell-line_count="{ row }"
							><RouterLink :to="recordRoute(row)" data-row-control @click.stop
								>{{ row.line_count }} 项</RouterLink
							></template
						>
						<template #cell-flow="{ row }"
							><MovementFlow :row="row" :rows="warehouseRows"
						/></template>
						<template #cell-activity="{ row }">{{
							row.activity_title || row.activity || "—"
						}}</template>
						<template #cell-notes="{ row }"
							><TruncatedTextPopover
								:text="row.notes || row.source_text"
								label="完整备注"
						/></template>
						<template #mobile-row="{ row, activateKey }"
							><article
								class="movement-mobile-card"
								:class="{ cancelled: row.docstatus === 2 }"
								tabindex="0"
								@keydown="activateKey"
							>
								<div class="movement-mobile-card-heading">
									<span class="movement-date"
										>{{ row.posting_date
										}}<small>{{ displayTime(row.posting_time) }}</small></span
									><span class="movement-badge" :data-kind="row.movement_kind">{{
										kindLabel(row.movement_kind as Kind)
									}}</span>
								</div>
								<div v-if="mode === 'items'" class="movement-item-cell">
									<ItemImagePreview
										:src="row.image || undefined"
										:alt="row.item_name"
									/>
									<span
										>{{ row.item_name
										}}<small>{{ row.item_code }}</small></span
									>
								</div>
								<RouterLink
									v-else
									:to="recordRoute(row)"
									data-row-control
									@click.stop
									>{{ row.record_name }}
									<span
										v-if="row.docstatus === 0"
										class="status-badge status-badge--draft"
										>草稿</span
									><span
										v-else-if="row.docstatus === 2"
										class="status-badge status-badge--cancelled"
										>已取消</span
									></RouterLink
								>
								<dl>
									<template v-if="mode === 'items'"
										><div>
											<dt>数量</dt>
											<dd>{{ quantity(row) }}</dd>
										</div>
										<div>
											<dt>从 / 到</dt>
											<dd>
												<MovementFlow :row="row" :rows="warehouseRows" />
											</dd></div></template
									><template v-else
										><div>
											<dt>物品行数</dt>
											<dd>
												<RouterLink
													:to="recordRoute(row)"
													data-row-control
													@click.stop
													>{{ row.line_count }} 项</RouterLink
												>
											</dd>
										</div>
										<div>
											<dt>数量</dt>
											<dd>{{ recordQuantity(row) }}</dd>
										</div>
										<div>
											<dt>流向</dt>
											<dd>
												<MovementFlow :row="row" :rows="warehouseRows" />
											</dd></div
									></template>
									<div>
										<dt>活动</dt>
										<dd>{{ row.activity_title || row.activity || "—" }}</dd>
									</div>
									<div>
										<dt>备注</dt>
										<dd>
											<TruncatedTextPopover
												:text="row.notes || row.source_text"
												label="完整备注"
												:mobile-lines="2"
											/>
										</dd>
									</div>
								</dl></article
						></template>
					</SortableDataTable>
					<div ref="sentinel" aria-hidden="true"></div>
				</div>
			</div>
		</div>
		<ColumnSummaryDialog
			v-model:open="summaryOpen"
			:columns="tableColumns"
			:summaries="columnSummaries"
			:loading="busy"
		/>
		<FloatingActionMenu
			v-if="surface === 'mobile' && pageActions.length"
			:actions="pageActions"
			:disabled="pageActionsDisabled"
			label="新增货物流动"
			@select="selectPageAction"
			@update:open="floatingActionsOpen = $event"
		/>
		<ReturnToTop
			:target="scrollRoot"
			:heading="surface === 'desktop' ? browseHeading : mobileBrowseHeader?.heading"
			:hidden="Boolean(filterOpen || summaryOpen || exportOpen)"
			:floating-action-open="floatingActionsOpen"
			:has-floating-action="surface === 'mobile' && pageActions.length > 0"
		/>
		<ExportDialog
			v-model:open="exportOpen"
			:report-type="mode === 'items' ? 'movement' : 'movement_records'"
			:filters="exportFilters"
			:title="mode === 'items' ? '导出货物流动明细' : '导出货物流动记录'"
			summary="包含当前筛选条件下的全部匹配结果。"
		/>
	</main>
</template>
<style scoped>
.movement-ledger-header {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	grid-template-areas: "heading" "actions" "chips";
	align-items: center;
	gap: var(--ti-space-2);
	padding: var(--ti-space-3) 0 var(--ti-space-2);
}
.movement-heading {
	grid-area: heading;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--ti-density-gap);
}
.movement-title {
	display: flex;
	align-items: baseline;
	gap: var(--ti-space-2);
}
.movement-heading h1 {
	margin: 0;
	color: var(--ti-ink);
	font-size: var(--ti-font-heading);
	font-weight: 750;
	line-height: 1.2;
}
.movement-heading h1.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: calc(var(--ti-space-1) * -1);
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
.movement-ledger .movement-title {
	min-width: 0;
}
.movement-count {
	color: var(--ti-muted);
	font-size: max(12px, var(--ti-font-small));
}
.movement-ledger-actions,
.movement-kind-chips {
	display: flex;
	flex-wrap: wrap;
	gap: var(--ti-space-1);
	align-items: center;
}
.movement-ledger-actions {
	grid-area: actions;
	justify-content: flex-start;
	width: 100%;
	min-width: 0;
}
.movement-search {
	display: flex;
	align-items: center;
	flex: 1;
	min-width: 180px;
	height: var(--ti-density-control);
	gap: var(--ti-density-row-gap);
	padding: 0 var(--ti-space-2);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-small);
	background: var(--ti-surface);
	color: var(--ti-muted);
}
.movement-search:focus-within {
	outline: 2px solid var(--ti-accent);
}
.movement-search input {
	width: 100%;
	min-width: 0;
	height: 100%;
	margin: 0;
	padding: 0;
	border: 0;
	outline: 0;
	background: transparent;
	box-shadow: none;
}
.toolbar-action,
.movement-filter-button {
	display: flex;
	align-items: center;
	gap: var(--ti-space-1);
	min-height: var(--ti-density-control);
	white-space: nowrap;
}
.toolbar-action :deep(svg),
.movement-filter-button :deep(svg) {
	width: 19px;
	height: auto;
}
.movement-ledger :deep(.movement-date) {
	white-space: nowrap;
	min-width: 104px;
	font-variant-numeric: tabular-nums;
}
.movement-ledger :deep(.movement-date-column) {
	min-width: 112px;
	white-space: nowrap;
}
.movement-filter-button b {
	display: grid;
	min-width: 18px;
	height: 18px;
	place-items: center;
	border-radius: var(--ti-radius-pill);
	background: var(--ti-accent-soft);
	color: var(--ti-accent-strong);
	font-size: max(12px, var(--ti-font-small));
}
.movement-ledger-actions > input {
	min-width: 180px;
	flex: 1;
	margin: 0;
}
.compact-heading {
	display: none;
	color: var(--ti-ink);
	font-size: var(--ti-font-section);
	white-space: nowrap;
}
.movement-filter-button.active {
	border-color: var(--ti-border-strong);
	background: var(--ti-accent-soft);
}
.new-record-menu {
	position: relative;
}
.new-record-menu summary {
	list-style: none;
	cursor: pointer;
	padding: var(--ti-space-2) var(--ti-space-3);
	border-radius: var(--ti-radius-small);
}
.new-record-menu summary::-webkit-details-marker {
	display: none;
}
.new-record-menu summary.disabled {
	opacity: 0.55;
	pointer-events: none;
	cursor: default;
}
.new-record-menu div {
	position: absolute;
	right: 0;
	z-index: var(--ti-layer-menu);
	display: grid;
	min-width: 130px;
	padding: var(--ti-space-1);
	background: var(--ti-surface);
	border: 1px solid var(--ti-border);
	box-shadow: var(--ti-shadow-overlay);
}
.new-record-menu div button {
	text-align: left;
	border: 0;
	background: transparent;
}
.movement-kind-chips {
	grid-area: chips;
	padding: var(--ti-space-2) 0;
	overflow-x: auto;
	flex-wrap: nowrap;
	position: relative;
	z-index: var(--ti-layer-nav);
}
@media (max-width: 1023px) {
	.movement-ledger-header {
		display: flex;
		flex-direction: column;
		align-items: stretch;
	}
	.movement-heading,
	.movement-ledger-actions {
		width: 100%;
	}
}

.movement-kind-chips button {
	flex: none;
	padding: var(--ti-space-2) var(--ti-space-2);
	border-radius: var(--ti-radius-pill);
}
.movement-kind-chip {
	display: inline-flex;
	align-items: center;
	gap: var(--ti-space-1);
}
.movement-kind-chip-zero {
	display: none !important;
}
.movement-kind-chip-empty {
	opacity: 0.58;
}
.movement-kind-chip[data-tone="receive"] {
	border-color: color-mix(in srgb, var(--ti-movement-receive) 20%, var(--ti-surface));
	background: var(--ti-movement-receive-bg);
	color: var(--ti-movement-receive);
}
.movement-kind-chip[data-tone="issue"],
.movement-kind-chip[data-tone="loss"],
.movement-kind-chip[data-tone="disposal"] {
	border-color: color-mix(in srgb, var(--ti-movement-issue) 20%, var(--ti-surface));
	background: var(--ti-movement-issue-bg);
	color: var(--ti-movement-issue);
}
.movement-kind-chip[data-tone="transfer"] {
	border-color: color-mix(in srgb, var(--ti-movement-transfer) 20%, var(--ti-surface));
	background: var(--ti-movement-transfer-bg);
	color: var(--ti-movement-transfer);
}
.movement-kind-chip[data-tone="loan"] {
	border-color: color-mix(in srgb, var(--ti-movement-loan) 20%, var(--ti-surface));
	background: var(--ti-movement-loan-bg);
	color: var(--ti-movement-loan);
}
.movement-kind-chip[data-tone="return"],
.movement-kind-chip[data-tone="repair"] {
	border-color: color-mix(in srgb, var(--ti-movement-return) 20%, var(--ti-surface));
	background: var(--ti-movement-return-bg);
	color: var(--ti-movement-return);
}
.movement-kind-chip[data-tone="damage"] {
	border-color: color-mix(in srgb, var(--ti-movement-damage) 20%, var(--ti-surface));
	background: var(--ti-movement-damage-bg);
	color: var(--ti-movement-damage);
}
.movement-kind-chip[data-tone="reconcile"] {
	border-color: color-mix(in srgb, var(--ti-movement-reconcile) 20%, var(--ti-surface));
	background: var(--ti-movement-reconcile-bg);
	color: var(--ti-movement-reconcile);
}
.movement-kind-chip[data-tone="opening"],
.movement-badge[data-kind="Opening"] {
	border-color: color-mix(in srgb, var(--ti-movement-opening) 20%, var(--ti-surface));
	background: var(--ti-movement-opening-bg);
	color: var(--ti-movement-opening);
}
.kind-icon {
	font-size: var(--ti-font-body);
	font-weight: 800;
}
.movement-kind-chips button[aria-pressed="true"] {
	background: var(--ti-accent-strong);
	color: var(--ti-ink-inverse);
}
.movement-zero-kinds-toggle {
	border-style: dashed;
	color: var(--ti-muted);
	background: var(--ti-surface);
}
.movement-kind-chips span {
	font-variant-numeric: tabular-nums;
	opacity: 0.75;
}
.movement-ledger .browse-result-meta {
	display: block;
}
.movement-active-filter-row {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: var(--ti-density-row-gap);
}
.movement-active-filter-row :deep(.active-filter-chips) {
	min-width: 0;
	flex: 1 1 auto;
}
.movement-ledger .results-column.compact .movement-ledger-header {
	grid-template-areas: "heading actions" "chips chips";
}
.movement-ledger .results-column.compact .browse-result-meta {
	grid-area: chips;
}
.movement-ledger .movement-kind-chips {
	width: 100%;
}
.movement-result-count-line {
	display: flex;
	justify-content: flex-end;
	flex: 0 0 auto;
	margin-left: auto;
}
.movement-ledger :deep(.sortable-data-table tbody tr.cancelled) {
	opacity: 0.55;
}
.movement-date,
.movement-item-cell,
.movement-item-cell > span {
	display: flex;
	flex-direction: column;
}
.movement-date small,
.movement-item-cell small {
	color: var(--ti-muted);
	font-size: max(12px, var(--ti-font-small));
}
.movement-item-cell {
	flex-direction: row;
	align-items: center;
	gap: var(--ti-space-2);
	min-width: 150px;
}
.movement-item-cell > :deep(.image-preview),
.movement-item-cell > :deep(.image-placeholder) {
	display: inline-grid;
	flex: none;
}
.movement-badge,
.status-badge {
	display: inline-block !important;
	width: max-content;
	padding: var(--ti-space-1) var(--ti-space-2);
	border-radius: var(--ti-radius-pill);
	background: var(--ti-warning-bg);
	color: var(--ti-movement-loan);
	white-space: nowrap;
}
.movement-badge[data-kind="Receive"] {
	background: var(--ti-movement-receive-bg);
	color: var(--ti-movement-receive);
}
.movement-badge[data-kind="Issue"],
.movement-badge[data-kind="Loss"],
.movement-badge[data-kind="Disposal"] {
	background: var(--ti-movement-issue-bg);
	color: var(--ti-movement-issue);
}
.movement-badge[data-kind="Transfer"] {
	background: var(--ti-movement-transfer-bg);
	color: var(--ti-movement-transfer);
}
.movement-badge[data-kind="Loan"] {
	background: var(--ti-movement-loan-bg);
	color: var(--ti-movement-loan);
}
.movement-badge[data-kind="Return"],
.movement-badge[data-kind="Repair"] {
	background: var(--ti-movement-return-bg);
	color: var(--ti-movement-return);
}
.movement-badge[data-kind="Damage"] {
	background: var(--ti-movement-damage-bg);
	color: var(--ti-movement-damage);
}
.movement-badge[data-kind="Reconcile"] {
	background: var(--ti-movement-reconcile-bg);
	color: var(--ti-movement-reconcile);
}
.status-badge {
	margin-left: var(--ti-space-1);
	font-size: max(12px, var(--ti-font-small));
}
.status-badge--draft {
	background: var(--ti-warning-bg);
	color: var(--ti-warning);
}
.status-badge--cancelled {
	background: var(--ti-canvas);
	color: var(--ti-muted);
}
.movement-filter-field {
	display: grid;
	gap: var(--ti-space-1);
	margin: var(--ti-space-2) 0;
	font-size: var(--ti-font-body);
}
.movement-filter-field input {
	width: 100%;
}
.movement-ledger :deep(.filter-sidebar) {
	font-size: var(--ti-font-body);
}
.movement-ledger :deep(.filter-sidebar h2) {
	margin: 0 0 var(--ti-space-3);
	font-size: var(--ti-font-section);
}
.movement-ledger :deep(.filter-sidebar > button.secondary) {
	width: 100%;
	min-height: var(--ti-density-control);
	margin-top: var(--ti-space-2);
}
.movement-ledger :deep(.filter-sidebar .selector-button) {
	min-height: var(--ti-density-control);
	margin: var(--ti-space-1) 0 var(--ti-space-2);
	padding: var(--ti-space-2) var(--ti-space-2);
	border-radius: var(--ti-radius-small);
}
.movement-ledger :deep(.filter-sidebar .choice-row) {
	min-height: var(--ti-density-control);
	padding: var(--ti-space-2) var(--ti-space-1);
}
.movement-mobile-card {
	display: grid;
	gap: var(--ti-space-2);
	padding: var(--ti-space-3);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-small);
	background: var(--ti-surface);
}
.movement-mobile-card-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--ti-density-row-gap);
}
.movement-mobile-card dl {
	display: grid;
	gap: var(--ti-space-1);
	margin: 0;
}
.movement-mobile-card dl > div {
	display: grid;
	grid-template-columns: 70px minmax(0, 1fr);
	gap: var(--ti-density-row-gap);
}
.movement-mobile-card dt {
	color: var(--ti-muted);
	font-size: max(12px, var(--ti-font-small));
}
.movement-mobile-card dd {
	margin: 0;
	word-break: break-word;
}
@media (min-width: 1024px) {
	.movement-ledger {
		width: 100%;
		max-width: none;
		padding-inline: var(--ti-space-4);
	}
	.movement-ledger .desktop-list-layout {
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
	}
	.movement-ledger .desktop-list-layout.filters-open {
		grid-template-columns: 250px minmax(0, 1fr);
		margin-left: calc(var(--ti-space-4) * -1);
	}
	.movement-ledger .desktop-list-layout:not(.filters-open) :deep(.filter-sidebar) {
		display: none;
	}
	.movement-ledger .desktop-list-layout.filters-open :deep(.filter-sidebar) {
		display: block;
		padding: var(--ti-density-row-gap) var(--ti-space-3);
		border-right: 1px solid var(--ti-border);
		border-radius: 0;
		background: var(--ti-canvas);
		box-shadow: none;
	}
	.movement-ledger .filters-open .results-column {
		padding-left: var(--ti-space-4);
	}
}
@media (max-width: 800px) {
	.movement-heading {
		align-items: flex-start;
		flex-direction: column;
		gap: var(--ti-space-1);
	}
	.movement-heading h1 {
		font-size: var(--ti-font-section);
	}
	.movement-search {
		min-width: 140px;
	}
}
@media (max-width: 1023px) {
	.movement-ledger {
		box-sizing: border-box;
		width: 100%;
		max-width: 100vw;
		height: calc(
			100dvh - var(--mobile-nav-height, 0px) - var(--mobile-context-nav-height, 0px)
		);
		min-width: 0;
		min-height: 0;
		padding-inline: var(--ti-space-2);
		overflow: hidden;
	}
	.movement-ledger > .desktop-list-layout {
		display: flex;
		flex: 1;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.movement-ledger > .desktop-list-layout > .results-column {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		width: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.movement-ledger .movement-ledger-header {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		flex: none;
	}
	.movement-ledger .results-scroll {
		width: 100%;
		min-width: 0;
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		padding-bottom: calc(var(--mobile-nav-height, 0) + var(--ti-space-8));
	}
	.movement-ledger .movement-mobile-card,
	.movement-ledger :deep(.sortable-data-table) {
		box-sizing: border-box;
		max-width: 100%;
		min-width: 0;
	}
	.movement-ledger .results-column.compact .movement-ledger-header {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--ti-space-1);
		padding-block: var(--ti-space-1);
	}
	.movement-ledger .results-column.compact .movement-heading {
		width: 100%;
		min-width: 0;
		flex-direction: column;
		align-items: stretch;
		gap: var(--ti-space-1);
	}
	.movement-ledger .results-column.compact .compact-heading {
		display: block;
		font-size: var(--ti-font-body);
	}
	.movement-ledger .results-column.compact .movement-ledger-actions {
		width: 100%;
		justify-content: flex-start;
		flex-wrap: nowrap;
		gap: var(--ti-space-1);
		overflow-x: auto;
	}
	.movement-ledger .results-column.compact .movement-kind-chips {
		width: 100%;
		min-width: 0;
		flex-wrap: nowrap;
		padding-block: var(--ti-space-1);
		overflow-x: auto;
	}
	.movement-ledger .movement-active-filter-row {
		align-items: flex-start;
		flex-wrap: wrap;
		gap: var(--ti-space-1) var(--ti-space-2);
	}
	.movement-ledger
		.results-column.compact
		.movement-ledger-actions
		> *:not(.column-summary-trigger) {
		min-height: max(44px, var(--ti-density-control));
	}
	.movement-ledger .results-column.compact .movement-search {
		height: max(44px, var(--ti-density-control));
		min-width: 140px;
	}
	.movement-ledger .results-column.compact .movement-kind-chips button {
		min-height: max(44px, var(--ti-density-control));
		padding-block: var(--ti-space-1);
	}
	.movement-search input {
		min-height: max(44px, var(--ti-density-control));
		font-size: max(16px, var(--ti-font-body));
	}
}
@media (min-width: 1024px) {
	.movement-ledger .results-scroll {
		padding-bottom: var(--ti-space-8);
	}
	.movement-ledger .results-column.compact .movement-ledger-header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
		grid-template-areas: "heading actions" "chips chips";
		gap: var(--ti-space-1);
		padding-block: var(--ti-space-1);
	}
	.movement-ledger .results-column.compact .movement-heading {
		min-width: 0;
		gap: var(--ti-density-row-gap);
	}
	.movement-ledger .results-column.compact .compact-heading {
		display: block;
		font-size: var(--ti-font-section);
	}
	.movement-ledger .results-column.compact .movement-ledger-actions {
		flex-wrap: nowrap;
		gap: var(--ti-space-1);
		overflow-x: auto;
	}
	.movement-ledger
		.results-column.compact
		.movement-ledger-actions
		> *:not(.column-summary-trigger) {
		min-height: var(--ti-control-height-compact);
	}
	.movement-ledger .results-column.compact .movement-search {
		height: var(--ti-control-height-compact);
		min-width: 140px;
	}
	.movement-ledger .results-column.compact .movement-kind-chips {
		padding-block: var(--ti-space-1);
	}
}
</style>
