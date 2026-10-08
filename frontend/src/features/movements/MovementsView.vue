<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { useInfiniteScroll } from "../../composables/useInfiniteScroll";
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
import ItemImagePreview from "../../components/ItemImagePreview.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import CompactFilterSection from "../../components/CompactFilterSection.vue";
import { type MovementsController, type Kind } from "./useMovementsController";

const props = defineProps<{
	controller: MovementsController;
	surface: ResponsiveSurface;
}>();
const {
	scrollResetToken,
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
	kindMeta,
	visibleKinds,
	zeroKindCount,
	tableColumns,
	tableSort,
	rowKey,
	activeFilterCount,
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
const filterPanel = ref<{ openPanel: (event?: Event) => void } | null>(null);
const openFilters = (event?: Event) => props.controller.openFilters(event, filterPanel.value);
const scrollRoot = ref<HTMLElement>();
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
				<header class="movement-ledger-header results-chrome">
					<div class="movement-heading">
						<div v-if="!compact" class="movement-title">
							<h1>货物流动 · {{ mode === "items" ? "明细" : "记录" }}</h1>
							<span class="movement-count"
								>{{ total }} {{ mode === "items" ? "条明细" : "条记录" }}</span
							>
						</div>
						<MovementPeriodSelector
							v-model:period-key="filters.period_key"
							v-model:date-from="filters.date_from"
							v-model:date-to="filters.date_to"
							:resolved-from="resolved.date_from"
							:resolved-to="resolved.date_to"
							variant="ledger"
						/>
					</div>
					<div class="result-toolbar movement-ledger-actions">
						<b class="compact-identity"
							>货物流动 · {{ mode === "items" ? "明细" : "记录" }}</b
						>
						<label class="movement-search"
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
						<button
							type="button"
							class="toolbar-action movement-filter-button"
							:class="{ active: desktopFilterOpen || filterOpen }"
							:aria-expanded="desktopFilterOpen || filterOpen"
							@click="openFilters($event)"
						>
							<InventoryIcon name="filter" /><span>筛选</span
							><b v-if="activeFilterCount"> {{ activeFilterCount }}</b></button
						><button type="button" class="toolbar-action" @click="exportOpen = true">
							<InventoryIcon name="download" /><span>导出</span>
						</button>
						<details v-if="mode === 'records'" class="new-record-menu">
							<summary class="primary toolbar-action">
								<span aria-hidden="true">＋</span> 新增记录
							</summary>
							<div role="menu">
								<button
									v-for="kind in operationKinds"
									:key="kind"
									type="button"
									@click="openOperation(kind)"
								>
									{{ kindLabels[kind] }}</button
								><button
									v-if="boot?.can_reconcile_stock"
									type="button"
									@click="openReconciliation"
								>
									库存调整
								</button>
							</div>
						</details>
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
				</header>
				<div ref="scrollRoot" class="results-scroll" @scroll.passive="onResultsScroll">
					<SortableDataTable
						:surface="surface"
						:rows="rows"
						:columns="tableColumns"
						:row-key="rowKey"
						:sort="tableSort"
						:loading="busy"
						:loading-more="loadingMore"
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
									v-if="row.image"
									:src="row.image"
									:alt="row.item_name"
								/>
								<span
									v-else
									class="movement-thumb movement-thumb-placeholder"
									role="img"
									aria-label="暂无图片"
									>暂无图片</span
								><span
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
								class="status-badge"
								>草稿</span
							><span
								v-else-if="mode === 'records' && row.docstatus === 2"
								class="status-badge"
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
						<template #cell-from="{ row }">{{ fromLocation(row) }}</template>
						<template #cell-to="{ row }">{{ toLocation(row) }}</template>
						<template #cell-line_count="{ row }"
							><RouterLink :to="recordRoute(row)" data-row-control @click.stop
								>{{ row.line_count }} 项</RouterLink
							></template
						>
						<template #cell-flow="{ row }">{{ recordFlow(row) }}</template>
						<template #cell-activity="{ row }">{{
							row.activity_title || row.activity || "—"
						}}</template>
						<template #cell-notes="{ row }">{{
							row.notes || row.source_text || "—"
						}}</template>
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
										v-if="row.image"
										:src="row.image"
										:alt="row.item_name"
									/>
									<span
										v-else
										class="movement-thumb movement-thumb-placeholder"
										role="img"
										aria-label="暂无图片"
										>暂无图片</span
									><span
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
									<span v-if="row.docstatus === 0" class="status-badge"
										>草稿</span
									><span v-else-if="row.docstatus === 2" class="status-badge"
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
												{{ fromLocation(row) }} → {{ toLocation(row) }}
											</dd>
										</div></template
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
											<dd>{{ recordFlow(row) }}</dd>
										</div></template
									>
									<div>
										<dt>活动</dt>
										<dd>{{ row.activity_title || row.activity || "—" }}</dd>
									</div>
									<div>
										<dt>备注</dt>
										<dd>{{ row.notes || row.source_text || "—" }}</dd>
									</div>
								</dl>
							</article></template
						>
					</SortableDataTable>
					<div ref="sentinel" aria-hidden="true"></div>
				</div>
			</div>
		</div>
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
	gap: 7px;
	padding: 14px 0 8px;
}
.movement-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
}
.movement-title {
	display: flex;
	align-items: baseline;
	gap: 10px;
}
.movement-heading h1 {
	margin: 0;
	color: #202b39;
	font-size: 25px;
	font-weight: 750;
	line-height: 1.2;
}
.movement-ledger .movement-title {
	min-width: 0;
}
.movement-count {
	color: #6b6257;
	font-size: 12px;
}
.movement-ledger-actions,
.movement-kind-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-items: center;
}
.movement-ledger-actions {
	justify-content: flex-end;
	min-width: 0;
}
.movement-search {
	display: flex;
	align-items: center;
	flex: 1;
	min-width: 180px;
	height: 36px;
	gap: 8px;
	padding: 0 10px;
	border: 1px solid #e0e2e4;
	border-radius: 6px;
	background: #fff;
	color: #7b8492;
}
.movement-search:focus-within {
	outline: 2px solid #946c3f;
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
	gap: 6px;
	min-height: 34px;
	white-space: nowrap;
}
.toolbar-action :deep(svg),
.movement-filter-button :deep(svg) {
	width: 19px;
	height: 19px;
}
.movement-filter-button b {
	display: grid;
	min-width: 18px;
	height: 18px;
	place-items: center;
	border-radius: 50%;
	background: #ede4d6;
	color: #855e33;
	font-size: 10px;
}
.movement-ledger-actions > input {
	min-width: 180px;
	flex: 1;
	margin: 0;
}
.compact-identity {
	display: none;
	font-size: 17px;
	white-space: nowrap;
}
.movement-filter-button.active {
	border-color: #c8b69b;
	background: #f5f0e8;
}
.new-record-menu {
	position: relative;
}
.new-record-menu summary {
	list-style: none;
	cursor: pointer;
	padding: 8px 12px;
	border-radius: 4px;
}
.new-record-menu summary::-webkit-details-marker {
	display: none;
}
.new-record-menu div {
	position: absolute;
	right: 0;
	z-index: 4;
	display: grid;
	min-width: 130px;
	padding: 5px;
	background: #fffaf2;
	border: 1px solid #eadfce;
	box-shadow: 0 8px 20px rgba(65, 44, 22, 0.12);
}
.new-record-menu div button {
	text-align: left;
	border: 0;
	background: transparent;
}
.movement-kind-chips {
	padding: 8px 0;
	overflow-x: auto;
	flex-wrap: nowrap;
	position: relative;
	z-index: 2;
}
.movement-kind-chips button {
	flex: none;
	padding: 7px 10px;
	border-radius: 999px;
}
.movement-kind-chip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
}
.movement-kind-chip-zero {
	display: none !important;
}
.movement-kind-chip-empty {
	opacity: 0.58;
}
.movement-kind-chip[data-tone="receive"] {
	border-color: #bddab9;
	background: #f0f8ee;
	color: #2f6a35;
}
.movement-kind-chip[data-tone="issue"],
.movement-kind-chip[data-tone="loss"],
.movement-kind-chip[data-tone="disposal"] {
	border-color: #edc5be;
	background: #fff4f1;
	color: #974438;
}
.movement-kind-chip[data-tone="transfer"] {
	border-color: #c8d3ee;
	background: #f1f4fb;
	color: #405c96;
}
.movement-kind-chip[data-tone="loan"] {
	border-color: #e7d0a1;
	background: #fff8e9;
	color: #8a5a19;
}
.movement-kind-chip[data-tone="return"],
.movement-kind-chip[data-tone="repair"] {
	border-color: #bfddd2;
	background: #eff8f5;
	color: #2f6a58;
}
.movement-kind-chip[data-tone="damage"] {
	border-color: #dfc7dc;
	background: #fbf1f9;
	color: #7f4e76;
}
.movement-kind-chip[data-tone="reconcile"] {
	border-color: #d1c4e6;
	background: #f5f1fb;
	color: #624e8a;
}
.kind-icon {
	font-size: 15px;
	font-weight: 800;
}
.movement-kind-chips button[aria-pressed="true"] {
	background: #9b571d;
	color: white;
}
.movement-zero-kinds-toggle {
	border-style: dashed;
	color: #7b8087;
	background: #fafafa;
}
.movement-kind-chips span {
	font-variant-numeric: tabular-nums;
	opacity: 0.75;
}
.movement-ledger :deep(.sortable-data-table) {
	border: 1px solid #ece9e2;
	border-radius: 8px 8px 0 0;
	background: #fff;
	overflow: hidden;
}
.movement-ledger :deep(.sortable-data-table table) {
	font-size: 14px;
}
.movement-ledger :deep(.sortable-data-table th) {
	padding: 8px 10px;
	background: #f2f2f0;
	color: #7a7d84;
	font-size: 14px;
}
.movement-ledger :deep(.sortable-data-table td) {
	height: 52px;
	padding: 5px 10px;
	border-bottom-color: #f0f0ed;
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
	color: #7b8087;
	font-size: 11px;
}
.movement-item-cell {
	flex-direction: row;
	align-items: center;
	gap: 7px;
	min-width: 150px;
}
.movement-thumb {
	width: 32px;
	height: 32px;
	object-fit: cover;
	border-radius: 5px;
	float: left;
	margin-right: 7px;
}
.movement-thumb-placeholder {
	display: inline-grid;
	place-items: center;
	flex: none;
	width: 52px;
	height: 52px;
	margin: 0;
	border: 1px solid #e4ded5;
	border-radius: 8px;
	background: #f5f1ea;
	color: #8a8176;
	font-size: 10px;
	text-align: center;
}
.movement-badge,
.status-badge {
	display: inline-block !important;
	width: max-content;
	padding: 3px 7px;
	border-radius: 999px;
	background: #f0e0c7;
	color: #724215;
	white-space: nowrap;
}
.movement-badge[data-kind="Receive"] {
	background: #e4f2e1;
	color: #2f6a35;
}
.movement-badge[data-kind="Issue"],
.movement-badge[data-kind="Loss"],
.movement-badge[data-kind="Disposal"] {
	background: #f8e3df;
	color: #974438;
}
.movement-badge[data-kind="Transfer"] {
	background: #e4eafa;
	color: #405c96;
}
.movement-badge[data-kind="Loan"] {
	background: #f4e5c8;
	color: #8a5a19;
}
.movement-badge[data-kind="Return"],
.movement-badge[data-kind="Repair"] {
	background: #e1f0eb;
	color: #2f6a58;
}
.movement-badge[data-kind="Damage"] {
	background: #f0e2ee;
	color: #7f4e76;
}
.movement-badge[data-kind="Reconcile"] {
	background: #e7e1f3;
	color: #624e8a;
}
.status-badge {
	margin-left: 5px;
	background: #ead8bc;
	color: #795c39;
	font-size: 11px;
}
.movement-filter-field {
	display: grid;
	gap: 4px;
	margin: 8px 0;
	font-size: 13px;
}
.movement-filter-field input {
	width: 100%;
}
.movement-ledger :deep(.filter-sidebar) {
	font-size: 13px;
}
.movement-ledger :deep(.filter-sidebar h2) {
	margin: 0 0 12px;
	font-size: 19px;
}
.movement-ledger :deep(.filter-sidebar > button.secondary) {
	width: 100%;
	min-height: 36px;
	margin-top: 10px;
}
.movement-ledger :deep(.filter-sidebar input),
.movement-ledger :deep(.filter-sidebar select),
.movement-ledger :deep(.filter-sidebar .selector-button) {
	min-height: 36px;
	margin: 3px 0 8px;
	padding: 8px 9px;
	border-radius: 6px;
}
.movement-ledger :deep(.filter-sidebar .choice-row) {
	min-height: 36px;
	padding: 7px 5px;
}
.movement-mobile-card {
	display: grid;
	gap: 9px;
	padding: 13px;
	border: 1px solid #ece9e2;
	border-radius: 10px;
	background: #fff;
}
.movement-mobile-card-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}
.movement-mobile-card dl {
	display: grid;
	gap: 5px;
	margin: 0;
}
.movement-mobile-card dl > div {
	display: grid;
	grid-template-columns: 70px minmax(0, 1fr);
	gap: 8px;
}
.movement-mobile-card dt {
	color: #7b8087;
	font-size: 12px;
}
.movement-mobile-card dd {
	margin: 0;
	word-break: break-word;
}
@media (min-width: 1024px) {
	.movement-ledger {
		width: 100%;
		max-width: none;
		padding-inline: 16px;
	}
	.movement-ledger .desktop-list-layout {
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
	}
	.movement-ledger .desktop-list-layout.filters-open {
		grid-template-columns: 250px minmax(0, 1fr);
		margin-left: -16px;
	}
	.movement-ledger .desktop-list-layout:not(.filters-open) :deep(.filter-sidebar) {
		display: none;
	}
	.movement-ledger .desktop-list-layout.filters-open :deep(.filter-sidebar) {
		display: block;
		padding: 14px 12px;
		border-right: 1px solid #e4ded5;
		border-radius: 0;
		background: #fbfaf7;
		box-shadow: none;
	}
	.movement-ledger .filters-open .results-column {
		padding-left: 16px;
	}
	.movement-ledger .compact .movement-heading {
		gap: 8px;
		padding-block: 4px;
	}
	.movement-ledger .compact .movement-title h1 {
		font-size: 17px;
	}
	.movement-ledger .compact .movement-title {
		display: none;
	}
	.movement-ledger .compact .movement-count {
		font-size: 11px;
	}
	.movement-ledger .compact .compact-identity {
		display: block;
	}
	.movement-ledger .compact .movement-ledger-header {
		padding-top: 9px;
	}
}
@media (max-width: 800px) {
	.movement-heading {
		align-items: flex-start;
		flex-direction: column;
		gap: 4px;
	}
	.movement-heading h1 {
		font-size: 20px;
	}
	.movement-search {
		min-width: 140px;
	}
}
</style>
