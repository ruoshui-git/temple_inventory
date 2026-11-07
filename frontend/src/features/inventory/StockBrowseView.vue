<script setup lang="ts">
import { formatSiteDateTime } from "../../lib/nativeTime";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { useFocusVisibility } from "../../composables/useFocusVisibility";
import UiButton from "../../components/ui/UiButton.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { useFilterRailPreference } from "../../composables/useFilterRailPreference";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import ItemStatusFilter from "../../components/filters/ItemStatusFilter.vue";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import { removeGroupByField } from "../../lib/groupBy";
import { groupImpliedColumns } from "../../lib/groupColumns";
import { groupLabels } from "../../lib/reportContract";
import ReportTable from "../../components/ui/ReportTable.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import BrowseCard from "../../components/ui/BrowseCard.vue";
import BrowseLoadMore from "../../components/ui/BrowseLoadMore.vue";
import ItemCard from "../../components/ui/ItemCard.vue";
import CardFields from "../../components/ui/CardFields.vue";
import RowFieldsSheet from "../../components/ui/RowFieldsSheet.vue";
import ViewModeToggle from "../../components/ui/ViewModeToggle.vue";
import ColumnSettings from "../../components/ui/ColumnSettings.vue";
import BrowseSplitButton from "../../components/ui/BrowseSplitButton.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import FilterDisclosure from "../../components/ui/FilterDisclosure.vue";
import AsOfFilter from "../../components/ui/AsOfFilter.vue";
import Overlay from "../../components/ui/Overlay.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import FilterRailEdge from "../../components/ui/FilterRailEdge.vue";
import GroupTotals, { type GroupTotalMetric } from "../../components/ui/GroupTotals.vue";
import ItemImage from "../../components/ItemImage.vue";
import QuickExport from "../../components/QuickExport.vue";
import ScanPanel from "../scanner/ScanPanel.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import SortControl from "../../components/ui/SortControl.vue";
import DataTable from "../../components/ui/DataTable.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import BrowseRefreshNotice from "../../components/ui/BrowseRefreshNotice.vue";
import ForbiddenState from "../../components/ui/ForbiddenState.vue";
import {
	orderedVisibleColumns,
	type DataColumn,
	type DataTableEntry,
	type DataTableGroup,
	type DataTableRecord,
} from "../../lib/dataTable";
import { partitionCardColumns, ROW_FIELD_LIMIT, type CardRoles } from "../../lib/cardLayout";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { exportFields } from "../../lib/exportColumns";
import { useOptionalInventoryServices } from "../../services/contracts";
import { unitLabel } from "../../lib/units";
import UnitText from "../../components/ui/UnitText.vue";
import DetailPopover from "../../components/ui/DetailPopover.vue";
import { formatQuantity } from "../../lib/formatQuantity";

import type { StockItem } from "../../lib/stockPresentation";
import {
	stockGroupedCardSections,
	stockGroupedSelectionKeys,
	type useStockBrowseController,
} from "./useStockBrowseController";
import {
	inventoryColumnsForPage,
	stockCode,
	stockExportTableFor,
	stockExpiryLabel,
	stockIdentity,
	stockName,
	type StockRow,
} from "./stockColumns";
import StockCell from "./StockCell.vue";
import { stockStateLabels } from "../../lib/presentationLabels";
const props = withDefaults(
	defineProps<{
		controller: ReturnType<typeof useStockBrowseController>;
		active?: boolean;
		queryError?: string;
		hasArtwork?: (item: StockItem) => boolean;
	}>(),
	{ active: true },
);
const back = () => window.history.back();
const emit = defineEmits<{
	openExport: [query: import("../../lib/reportContract").ReportQuery];
}>();
const {
	appliedChips,
	atDefaults,
	reference,
	data,
	loadingMore,
	search,
	scope,
	view,
	viewOptions,
	sort,
	descending,
	selected,
	selecting,
	stockState,
	analysisDimension,
	query: quickReportQuery,
	groups: groupPages,
	setGroupBy,
	setItemStatus,
	asOfActive,
	setAsOf,
	metrics,
	rows,
	analysis,
	status,
	load,
	reset,
	openItem,
	expiryStatus,
	sortBy,
	toggle,
} = props.controller;
const { isMobile, isSurface } = useResponsiveLayout();
const desktopColumnsVisible = computed(() => !isMobile.value || isSurface("desktop"));
const inventoryRoot = ref<HTMLElement>();
const toolbar = ref<InstanceType<typeof BrowseToolbar>>();
const browseHeader = computed(() => toolbar.value?.$el as HTMLElement | undefined);
const scan = ref<InstanceType<typeof ScanPanel>>();
const sortDirection = computed({
	get: () => (descending.value ? "desc" : "asc"),
	set: (value: "asc" | "desc") => (descending.value = value === "desc"),
});
const sortFields = [
	{ value: "item_name", label: "物品名称", kind: "text" },
	{ value: "item_code", label: "物品编号", kind: "text" },
	{ value: "category", label: "类别", kind: "text" },
	{ value: "stock_uom", label: "库存单位", kind: "text" },
	{ value: "available", label: "可用数量", kind: "number" },
	{ value: "loaned", label: "借出数量", kind: "number" },
	{ value: "damaged", label: "损坏数量", kind: "number" },
] as const;
const wideScreen = ref(window.innerWidth >= 1440);
function updateWideScreen() {
	wideScreen.value = window.innerWidth >= 1440;
}
onMounted(() => window.addEventListener("resize", updateWideScreen));
onBeforeUnmount(() => window.removeEventListener("resize", updateWideScreen));
const inventoryColumns = computed<DataColumn[]>(() =>
	inventoryColumnsForPage(desktopColumnsVisible.value),
);
const tableRows = computed<DataTableRecord[]>(() =>
	rows.value.map((item) => ({
		kind: "record",
		id: item.code,
		value: item as unknown as Record<string, unknown>,
	})),
);
const browseTableRows = computed<DataTableEntry[]>(() =>
	quickReportQuery.value.groupBy.length ? groupPages.entries.value : tableRows.value,
);
// The DataTable owns grouped results (outside cards) and the table layout on every form factor.
const usesTable = computed(() =>
	quickReportQuery.value.groupBy.length ? view.value !== "card" : view.value === "table",
);
// 更多 opens every field of one row; the sheet's 打开 runs the same open as the row tap.
const detailsRow = ref<{ row: StockRow; open: () => void }>();
function showDetails(row: StockRow, open: () => void) {
	detailsRow.value = { row, open };
}
function openDetailsRow() {
	detailsRow.value?.open();
	detailsRow.value = undefined;
}
const groupRoot = computed(() => groupPages.pages.value["[[],null]"]);
const groupedCardSections = computed(() => {
	return stockGroupedCardSections(groupPages.entries.value);
});
function groupNumber(value: unknown) {
	const quantity = Number(value || 0);
	return `${quantity < 0 ? "−" : ""}${formatQuantity(Math.abs(quantity))}`;
}
function groupMetrics(group: DataTableGroup): GroupTotalMetric[] {
	const totals = Array.isArray(group.value?.unit_totals)
		? (group.value.unit_totals as Record<string, unknown>[])
		: [];
	return [
		["available", "可用"],
		["loaned", "借出"],
		["damaged", "损坏"],
		["stock_qty", "合计"],
	].map(([field, label]) => ({
		key: field,
		label,
		entries: totals.map((row) => ({
			uom: String(row.stock_uom || ""),
			qty: Number(row[field] || 0),
		})),
	}));
}
function groupUnitValues(group: DataTableGroup, field: string) {
	const totals = Array.isArray(group.value?.unit_totals)
		? (group.value.unit_totals as Record<string, unknown>[])
		: [];
	return totals.map((row) =>
		`${groupNumber(row[field])} ${unitLabel(String(row.stock_uom || ""))}`.trim(),
	);
}
function groupUnitPreview(group: DataTableGroup, field: string) {
	const values = groupUnitValues(group, field);
	return values.slice(0, 2).join("；");
}
function stockSelectionKey(row: StockRow) {
	return stockCode(row) || String(row.id || "");
}
function serialPreview(row: StockRow) {
	const locations = Array.isArray(row.locations)
		? (row.locations as Record<string, unknown>[])
		: [];
	const serials = [
		String(row.serial_nos || ""),
		...locations.map((location) => String(location.serial_nos || "")),
	]
		.flatMap((value) => value.split("、"))
		.map((value) => value.trim())
		.filter(Boolean);
	const sorted = [...new Set(serials)].sort();
	return {
		visible: sorted.slice(0, 2).join("、"),
		extra: Math.max(0, sorted.length - 2),
		title: sorted.join("、"),
	};
}
function openGroupedStock(row: StockRow) {
	props.controller.openItemCode(stockCode(row));
}
const services = useOptionalInventoryServices();
const serialForcedColumns = computed(() =>
	quickReportQuery.value.scope.tracking === "serial" ? ["serial_nos"] : [],
);
const tablePreferences = services
	? useColumnPreferences(
			"stock.summary",
			inventoryColumns,
			reference,
			services,
			serialForcedColumns,
		)
	: undefined;
// One field selection drives table columns, card fields and 列表 rows alike.
const stockVisibleColumns = computed(() =>
	orderedVisibleColumns(inventoryColumns.value, tablePreferences),
);
const stockCardRoles = computed<CardRoles>(() => {
	const visible = new Set(stockVisibleColumns.value.map((column) => String(column.id)));
	return {
		media: "image",
		title: "item_name",
		eyebrow: ["category", "item_code"],
		hero: "available",
		status: "expiry",
		omit: [
			// The hero quantity already shows the stock unit.
			...(visible.has("available") ? ["stock_uom"] : []),
			// The serial preview under the title lists the same numbers.
			...(quickReportQuery.value.scope.tracking === "serial" ? ["serial_nos"] : []),
		],
	};
});
const cardPartition = computed(() =>
	partitionCardColumns(stockVisibleColumns.value, stockCardRoles.value),
);
const rowPartition = computed(() =>
	partitionCardColumns(stockVisibleColumns.value, stockCardRoles.value, ROW_FIELD_LIMIT),
);
function cardEyebrow(partition: typeof cardPartition.value, id: string) {
	return partition.eyebrow.some((column) => String(column.id) === id);
}
function asStockRow(item: StockItem): StockRow {
	return item as unknown as StockRow;
}
function rowMeta(item: StockItem) {
	return [
		cardEyebrow(rowPartition.value, "item_code") ? item.code : "",
		cardEyebrow(rowPartition.value, "category") ? item.category || "未分类" : "",
	]
		.filter(Boolean)
		.join(" · ");
}
const stockExportVisible = computed(() => {
	const columns = inventoryColumns.value;
	return tablePreferences?.effectiveVisible.value.length
		? tablePreferences.effectiveVisible.value
		: columns
				.filter((column) => column.defaultVisible !== false || column.required)
				.map((column) => String(column.id));
});
const stockExportOrder = computed(() =>
	tablePreferences?.order.value.length
		? tablePreferences.order.value
		: inventoryColumns.value.map((column) => String(column.id)),
);
const stockExportTable = computed(() => stockExportTableFor(stockExportVisible.value));
const stockExport = ref<InstanceType<typeof QuickExport>>();
const stockExportColumns = computed(() =>
	exportFields(inventoryColumns.value, stockExportOrder.value, stockExportVisible.value),
);
function setSelected(code: string, checked: boolean) {
	const isSelected = selected.value.includes(code);
	if (checked !== isSelected) props.controller.toggle(code);
}
const allStockRowsSelected = computed(() => props.controller.allSelected(visibleStockKeys.value));
const visibleStockKeys = computed(() =>
	quickReportQuery.value.groupBy.length
		? stockGroupedSelectionKeys(groupPages.entries.value)
		: rows.value.map((item) => item.code),
);
function selectAllStockRows(event: Event) {
	const checked = (event.target as HTMLInputElement).checked;
	props.controller.setManySelected(visibleStockKeys.value, checked);
}

const results = ref<HTMLElement>();
useFocusVisibility(
	inventoryRoot,
	ref<HTMLElement>(),
	() => true,
	() => props.active !== false,
	browseHeader,
);
const analysisOpen = ref(false);
const {
	open: filtersOpen,
	toggle: toggleFilters,
	saveError: filtersSaveError,
	retry: retryFiltersSave,
} = useFilterRailPreference("stock.items", reference, true);
const filterSheetOpen = ref(false);
watch([() => props.active, isMobile], () => {
	scan.value?.finishScanning();
	analysisOpen.value = false;
});
function acceptBrowseScan(
	code: string,
	batch?: string,
	_context?: unknown,
	serial?: string,
	serialLocation?: { name: string; label: string; is_group: boolean },
) {
	if (!serial) {
		search.value = batch || code;
		return;
	}
	scope.value.item = code;
	scope.value.tracking = "serial";
	scope.value.warehouses = serialLocation ? [serialLocation.name] : [];
	search.value = serial;
	scan.value?.finishScanning();
}
function acceptBrowseLocation(name: string) {
	scope.value.warehouses = [name];
	scan.value?.finishScanning();
}
</script>
<template>
	<div ref="inventoryRoot" class="inventory-example">
		<p v-if="queryError" role="alert">{{ queryError }}</p>
		<BrowseToolbar
			ref="toolbar"
			class="inventory-browse-header"
			title="库存"
			:summary="
				data.snapshot
					? `库存 · ${data.total} 种${selected.length ? ' · 已选 ' + selected.length : ''}`
					: ''
			"
			v-model:search="search"
			search-label="搜索库存"
			:active="active"
			:filter-count="appliedChips.length"
			:sidebar-open="filtersOpen"
			:sidebar-save-error="filtersSaveError"
			:retry-sidebar-save="retryFiltersSave"
			sidebar-available
			scannable
			@scan="scan?.show()"
			@filter-open="filterSheetOpen = $event"
		>
			<template #chips="{ editFilter }">
				<BrowseChip
					v-for="(group, index) in quickReportQuery.groupBy"
					:key="`group:${group}`"
					:label="`分组：${groupLabels[group] || group}`"
					@edit="editFilter('groupBy')"
					@remove="
						setGroupBy(
							removeGroupByField(
								'inventory',
								quickReportQuery.view,
								quickReportQuery.groupBy,
								index,
							),
						)
					"
				/>
				<BrowseChip
					v-for="chip in appliedChips"
					:key="chip.key"
					:label="chip.label"
					@edit="editFilter(chip.field)"
					@remove="chip.remove()"
				/>
				<UiButton v-if="!atDefaults" variant="ghost" @click="controller.reset"
					>恢复默认</UiButton
				>
			</template>
			<template #filters>
				<div class="browse-filter-mega">
					<section>
						<h3>筛选</h3>
						<BrowseFilters
							v-model="scope"
							disclosure-mode
							:fields="['item', 'categories', 'tracking', 'warehouses']"
							:hierarchy-in-rail="filtersOpen && !isMobile"
							hide-activity
						/>
						<ItemStatusFilter
							:model-value="quickReportQuery.itemStatus"
							@update:model-value="setItemStatus"
						/>
						<FilterDisclosure
							label="截至"
							:summary="quickReportQuery.asOf || '现在'"
							field="asOf"
						>
							<AsOfFilter
								:model-value="quickReportQuery.asOf"
								:today="reference.siteDate"
								@update:model-value="setAsOf"
							/>
						</FilterDisclosure>
						<FilterDisclosure
							label="库存状态"
							:summary="stockStateLabels[quickReportQuery.stockState]"
							field="stockState"
						>
							<label class="form-field">
								<select v-model="stockState" aria-label="库存状态">
									<option
										v-for="(label, value) in stockStateLabels"
										:key="value"
										:value="value"
									>
										{{ label }}
									</option>
								</select>
							</label>
						</FilterDisclosure>
					</section>
					<section>
						<h3>分组</h3>
						<div data-filter-field="groupBy" tabindex="-1">
							<GroupByFilter
								:dataset="quickReportQuery.dataset"
								:view="quickReportQuery.view"
								:model-value="quickReportQuery.groupBy"
								@update:model-value="setGroupBy"
							/>
						</div>
					</section>
				</div>
			</template>
			<template #actions>
				<QuickExport
					ref="stockExport"
					:query="quickReportQuery"
					title="库存列表"
					:table="stockExportTable"
					:columns="stockExportColumns"
					:active="active"
					:show-trigger="false"
				/>
				<BrowseOverflowMenu>
					<UiButton
						v-if="isMobile && controller.selectionAvailable.value"
						icon="select"
						:aria-pressed="selecting"
						@click="
							selecting ? controller.exitSelection() : controller.enterSelection()
						"
						>{{ selecting ? "取消选择" : "选择" }}</UiButton
					>
					<UiButton icon="export" @click="stockExport?.open()">导出</UiButton>
				</BrowseOverflowMenu>
				<UiButton
					v-if="!isMobile && controller.selectionAvailable.value"
					icon="select"
					:aria-pressed="selecting"
					@click="selecting ? controller.exitSelection() : controller.enterSelection()"
					>{{ selecting ? "取消选择" : "选择" }}</UiButton
				>
				<BrowseSplitButton
					v-if="controller.actions.value.length > 0"
					label="新建物品"
					kind="Item"
					icon="box"
					:options="
						controller.actions.value
							.filter((item) => item.kind !== 'Item')
							.map((item) => ({
								kind: item.kind,
								label: item.name,
								icon: item.icon,
							}))
					"
					@select="controller.action"
				/>
			</template>
			<div class="inventory-context"><slot name="context" /></div>
			<slot name="context-actions" />
			<template #selection>
				<div
					v-if="selecting"
					class="selection-bar stock-selection-actions"
					role="region"
					aria-label="已选物品操作"
				>
					<label
						v-if="view === 'card' || (isMobile && view === 'list')"
						class="browse-select-visible"
					>
						<input
							type="checkbox"
							:checked="allStockRowsSelected"
							@change="selectAllStockRows"
						/>
						选择当前 {{ visibleStockKeys.length }} 项
					</label>
					<span role="status">已选择 {{ selected.length }} 项</span>
					<UiButton
						v-for="item in controller.selectedActions.value"
						:key="item.kind"
						:icon="item.icon"
						:disabled="data.stale"
						@click="controller.selectedAction(item.kind)"
						>{{ item.name }}</UiButton
					>
					<UiButton variant="ghost" @click="controller.exitSelection()">取消</UiButton>
				</div>
			</template>
		</BrowseToolbar>
		<section class="inventory-surface">
			<BrowseResultSummary
				v-if="data.snapshot"
				:label="`${data.total} 种物品`"
				:metrics="metrics"
				:loading="false"
			>
				<template #controls>
					<ViewModeToggle
						v-model="view"
						:ariaLabel="'库存显示方式'"
						:options="viewOptions"
					/>
					<!-- DataTable owns 显示字段 while it is mounted; cards and 列表 rows need their own. -->
					<ColumnSettings
						v-if="tablePreferences && !usesTable"
						:preferences="tablePreferences"
						:columns="inventoryColumns"
					/>
					<SortControl
						v-if="!usesTable && (isMobile || view === 'card')"
						v-model:field="sort"
						v-model:direction="sortDirection"
						:fields="sortFields"
						label="库存排序"
					/>
					<UiButton
						icon="report"
						:icon-only="isMobile"
						label="分析结果"
						:disabled="!data.snapshot"
						@click="analysisOpen = true"
						>分析结果</UiButton
					>
				</template>
			</BrowseResultSummary>
			<div v-if="asOfActive" class="notice-bar stock-as-of-notice" role="status">
				<InventoryIcon name="info" />
				<span>正在查看 {{ quickReportQuery.asOf }} 的历史库存，出入库操作已停用</span>
				<UiButton variant="ghost" @click="setAsOf('')">回到现在</UiButton>
			</div>
			<BrowseRefreshNotice :show="data.refreshFailed" :retry="() => load(false, true)" />
			<div class="inventory-body" :class="{ 'with-filters': filtersOpen && !isMobile }">
				<aside v-if="filtersOpen && !isMobile" class="browse-filter-rail">
					<div class="filter-rail-heading">
						<h3>筛选库存</h3>
						<FilterRailEdge
							:open="true"
							:active="scope.categories.length + scope.warehouses.length > 0"
							@toggle="toggleFilters"
						/>
					</div>
					<div class="browse-filter-dense">
						<BrowseFilters
							v-model="scope"
							:fields="['categories', 'warehouses']"
							hide-activity
						/>
					</div>
				</aside>
				<FilterRailEdge
					v-if="!filtersOpen && !isMobile"
					:open="false"
					:active="scope.categories.length + scope.warehouses.length > 0"
					@toggle="toggleFilters"
				/>
				<div
					ref="results"
					class="results-region surface stock-results-card"
					:class="{ 'is-stale': data.stale }"
					:aria-busy="status === 'loading' || status === 'refresh'"
				>
					<div
						v-if="status === 'loading' && usesTable"
						class="stock-table-initial-skeleton"
					>
						<DataTable
							sticky-header
							ariaLabel="库存物品"
							table-class="data-table"
							:columns="inventoryColumns"
							:rows="[]"
							:column-preferences="tablePreferences"
							:loading="true"
							:initialized="false"
						/>
					</div>
					<div
						v-else-if="status === 'loading'"
						:class="[
							'stock-grid-skeleton',
							isMobile && view === 'list'
								? 'stock-list stock-list-skeleton'
								: 'browse-card-grid stock-grid',
						]"
						role="status"
						aria-label="库存结果加载中"
					>
						<SkeletonBlock
							v-if="isMobile && view === 'list'"
							variant="stock-row"
							:rows="8"
						/>
						<template v-else>
							<SkeletonBlock v-for="row in 8" :key="row" variant="card" />
						</template>
					</div>
					<div v-else-if="status === 'error'" class="empty-panel">
						<ForbiddenState v-if="data.forbidden" @back="back" />
						<template v-else>
							<InventoryIcon name="warning" />
							<h3>暂时无法读取库存</h3>
							<p>筛选与选择已保留，请重试。</p>
							<UiButton @click="load(false, true)">重试</UiButton>
						</template>
					</div>
					<div
						v-else-if="
							!rows.length &&
							!(quickReportQuery.groupBy.length && groupRoot?.initialized)
						"
						class="empty-panel"
					>
						<InventoryIcon name="search" />
						<h3>没有找到匹配的物品</h3>
						<p>试试更短的关键词，或清除筛选。</p>
						<UiButton @click="reset">显示全部物品</UiButton>
					</div>
					<template v-else>
						<div
							v-if="quickReportQuery.groupBy.length && view === 'card'"
							class="stock-card-groups"
						>
							<section
								v-for="section in groupedCardSections"
								:key="section.group.id"
								class="stock-card-group"
								:class="{ 'is-nested': section.group.depth > 1 }"
							>
								<div class="stock-card-group-header">
									<button
										class="stock-card-group-heading"
										:aria-expanded="section.group.expanded"
										@click="groupPages.toggleGroup(section.group.id)"
									>
										<strong>{{ section.group.label }}</strong>
										<span>{{ section.group.count }} 项</span>
									</button>
									<GroupTotals
										class="stock-card-group-summary"
										:metrics="groupMetrics(section.group)"
									/>
								</div>
								<div v-if="section.group.error" class="stock-card-group-actions">
									<UiButton @click="groupPages.retry(section.group.id)"
										>重试</UiButton
									>
								</div>
								<div
									v-if="section.rows.length"
									class="browse-card-grid stock-grid"
								>
									<ItemCard
										v-for="entry in section.rows"
										:key="entry.id"
										:row-key="stockSelectionKey(entry.value)"
										:selecting="selecting"
										:selected="
											selected.includes(stockSelectionKey(entry.value))
										"
										:select-label="`选择${stockName(entry.value)}`"
										:name="stockName(entry.value)"
										:code="
											cardEyebrow(cardPartition, 'item_code')
												? stockCode(entry.value)
												: undefined
										"
										:category="
											cardEyebrow(cardPartition, 'category')
												? String(entry.value.category || '')
												: undefined
										"
										:image="stockIdentity(entry.value)"
										:media="Boolean(cardPartition.media)"
										:quantity="
											cardPartition.hero
												? Number(entry.value.available || 0)
												: undefined
										"
										:quantity-label="cardPartition.hero?.label"
										:unit="
											String(entry.value.uom || entry.value.stock_uom || '')
										"
										:status="
											stockExpiryLabel(entry.value, reference.siteDate) ||
											undefined
										"
										class="stock-card"
										@toggle="toggle(stockSelectionKey(entry.value))"
										@open="openGroupedStock(entry.value)"
									>
										<CardFields
											:fields="cardPartition.fields"
											:overflow="cardPartition.overflow"
											:row="entry.value"
											@more="
												showDetails(entry.value, () =>
													openGroupedStock(entry.value),
												)
											"
										>
											<template #cell="{ column, row }">
												<StockCell
													:column="column"
													:row="row"
													:reference="reference"
												/>
											</template>
										</CardFields>
										<small
											v-if="
												quickReportQuery.scope.tracking === 'serial' &&
												serialPreview(entry.value).title
											"
											class="stock-serial-preview"
											:title="serialPreview(entry.value).title"
										>
											{{ serialPreview(entry.value).visible }}
											<span v-if="serialPreview(entry.value).extra"
												>+{{ serialPreview(entry.value).extra }}</span
											>
										</small>
									</ItemCard>
								</div>
								<UiButton
									v-if="groupPages.hasMore(section.group.id)"
									:loading="Boolean(section.group.loading)"
									@click="groupPages.loadMore(section.group.id)"
									>加载更多此分组 ·
									{{ groupPages.progress(section.group.id).loaded }} /
									{{ groupPages.progress(section.group.id).total }}</UiButton
								>
							</section>
						</div>
						<div
							v-if="!quickReportQuery.groupBy.length && view === 'card'"
							class="browse-card-grid stock-grid"
							:class="{ refreshing: data.stale }"
							:inert="data.stale || undefined"
						>
							<ItemCard
								v-for="item in rows"
								:key="item.code"
								:row-key="item.code"
								:selecting="selecting"
								:selected="selected.includes(item.code)"
								:select-label="`选择${item.name}`"
								:name="item.name"
								:code="
									cardEyebrow(cardPartition, 'item_code') ? item.code : undefined
								"
								:category="
									cardEyebrow(cardPartition, 'category')
										? item.category
										: undefined
								"
								:image="item"
								:media="Boolean(cardPartition.media)"
								:quantity="cardPartition.hero ? item.available : undefined"
								:quantity-label="cardPartition.hero?.label"
								:unit="item.uom"
								:status="expiryStatus(item) || undefined"
								:status-tone="
									expiryStatus(item) === '已过期'
										? 'danger'
										: expiryStatus(item) === '未过期'
											? 'neutral'
											: 'warning'
								"
								class="stock-card"
								@toggle="toggle(item.code)"
								@open="openItem(item)"
							>
								<template #media>
									<ItemImage
										:has-artwork="!!hasArtwork?.(item)"
										frame
										:item="item"
										interaction="detail"
										@detail="!selecting && openItem(item)"
									>
										<template #artwork
											><slot name="artwork" :item="item"
										/></template>
									</ItemImage>
								</template>
								<template #flags>
									<span v-if="item.disabled" class="badge neutral">已停用</span>
								</template>
								<CardFields
									:fields="cardPartition.fields"
									:overflow="cardPartition.overflow"
									:row="asStockRow(item)"
									@more="showDetails(asStockRow(item), () => openItem(item))"
								>
									<template #cell="{ column, row }">
										<StockCell
											:column="column"
											:row="row"
											:reference="reference"
											:loading="status === 'refresh'"
											:initialized="Boolean(data.snapshot)"
											:stale="data.stale"
										/>
									</template>
								</CardFields>
								<small
									v-if="
										quickReportQuery.scope.tracking === 'serial' &&
										serialPreview(item).title
									"
									class="stock-serial-preview"
									:title="serialPreview(item).title"
								>
									{{ serialPreview(item).visible }}
									<span v-if="serialPreview(item).extra"
										>+{{ serialPreview(item).extra }}</span
									>
								</small>
							</ItemCard>
						</div>
						<div
							v-if="!quickReportQuery.groupBy.length && isMobile && view === 'list'"
							class="stock-list"
							:class="{ refreshing: data.stale }"
							:inert="data.stale || undefined"
						>
							<BrowseCard
								v-for="item in rows"
								:key="item.code"
								:row-key="item.code"
								:selecting="selecting"
								:selected="selected.includes(item.code)"
								:select-label="`选择${item.name}`"
								variant="row"
								:class="[
									'stock-list-row',
									{ 'is-text-only': !rowPartition.media },
								]"
								@toggle="toggle(item.code)"
								@open="openItem(item)"
							>
								<template v-if="rowPartition.media" #media>
									<div class="stock-list-image">
										<ItemImage
											:has-artwork="!!hasArtwork?.(item)"
											:item="item"
											:thumbnail-size="64"
										>
											<template #artwork
												><slot name="artwork" :item="item"
											/></template>
										</ItemImage>
									</div>
								</template>
								<template #default="{ activate }">
									<button class="stock-list-open" @click="activate">
										<span class="stock-list-identity">
											<strong class="stock-list-name" data-clamp>{{
												item.name
											}}</strong>
											<span v-if="item.disabled" class="badge neutral"
												>已停用</span
											>
											<span
												v-if="rowMeta(item)"
												class="stock-list-meta"
												data-clamp
												>{{ rowMeta(item) }}</span
											>
											<span
												v-if="expiryStatus(item)"
												class="badge"
												:class="
													expiryStatus(item) === '已过期'
														? 'danger'
														: expiryStatus(item) === '未过期'
															? 'success'
															: 'warning'
												"
												>{{ expiryStatus(item) }}</span
											>
											<small
												v-if="
													quickReportQuery.scope.tracking === 'serial' &&
													serialPreview(item).title
												"
												class="stock-serial-preview"
												:title="serialPreview(item).title"
											>
												{{ serialPreview(item).visible }}
												<span v-if="serialPreview(item).extra"
													>+{{ serialPreview(item).extra }}</span
												>
											</small>
										</span>
										<span v-if="rowPartition.hero" class="stock-list-quantity">
											<strong
												><UnitText :name="item.uom" :qty="item.available"
											/></strong>
										</span>
									</button>
									<CardFields
										variant="row"
										:fields="rowPartition.fields"
										:overflow="rowPartition.overflow"
										:row="asStockRow(item)"
										@more="showDetails(asStockRow(item), () => openItem(item))"
									>
										<template #cell="{ column, row }">
											<StockCell
												:column="column"
												:row="row"
												:reference="reference"
												:loading="status === 'refresh'"
												:initialized="Boolean(data.snapshot)"
												:stale="data.stale"
												compact
											/>
										</template>
									</CardFields>
								</template>
							</BrowseCard>
						</div>
						<DataTable
							sticky-header
							v-if="usesTable"
							data-browse-scroll="inventory-table"
							ariaLabel="库存物品"
							table-class="data-table"
							:columns="inventoryColumns"
							:rows="browseTableRows"
							:group-summary-columns="() => ['available', 'loaned', 'damaged']"
							:suppressed-columns="groupImpliedColumns(quickReportQuery.groupBy)"
							:column-preferences="tablePreferences"
							:row-key="stockSelectionKey"
							:selection-label="(row) => stockName(row)"
							empty-action="显示全部物品"
							@empty-action="reset"
							:sort-by="sort"
							:sort-direction="sortDirection"
							:selection-enabled="selecting"
							:selected-keys="selected"
							:has-more="
								quickReportQuery.groupBy.length
									? groupPages.hasMore()
									: data.next !== null
							"
							:loaded-count="
								quickReportQuery.groupBy.length
									? groupPages.progress().loaded
									: rows.length
							"
							:total-count="
								quickReportQuery.groupBy.length
									? groupPages.progress().total
									: data.total
							"
							:loading="
								data.loading ||
								Boolean(quickReportQuery.groupBy.length && groupRoot?.loading)
							"
							:initialized="Boolean(data.snapshot || groupRoot?.initialized)"
							:error="
								quickReportQuery.groupBy.length
									? groupRoot?.error || data.error
									: data.error
							"
							:loading-more="
								quickReportQuery.groupBy.length
									? Boolean(groupRoot?.loading && groupRoot.rows.length)
									: loadingMore
							"
							:stale="
								quickReportQuery.groupBy.length
									? Boolean(groupRoot?.stale)
									: data.stale
							"
							:retained="
								quickReportQuery.groupBy.length
									? Boolean(groupRoot?.rows.length && groupRoot?.stale)
									: Boolean(rows.length && data.stale)
							"
							:row-class="
								(row) =>
									selected.includes(stockSelectionKey(row)) ? 'selected' : ''
							"
							:row-attributes="
								(row) => ({ 'data-browse-row': stockSelectionKey(row) })
							"
							@sort="sortBy"
							@toggle-group="groupPages.toggleGroup"
							@select="setSelected"
							@select-visible="
								(keys, checked) => keys.forEach((key) => setSelected(key, checked))
							"
							@retry="quickReportQuery.groupBy.length ? groupPages.retry() : load()"
							@load-more="
								quickReportQuery.groupBy.length
									? groupPages.loadMore()
									: load(true)
							"
						>
							<template #cell="{ column, row }">
								<StockCell
									:column="column"
									:row="row"
									:reference="reference"
									:loading="status === 'refresh'"
									:initialized="Boolean(data.snapshot)"
									:stale="data.stale"
								/>
							</template>
							<template #group="{ group }">
								<div class="report-group-details">
									<GroupTotals :metrics="groupMetrics(group)" />
									<UiButton
										v-if="group.error"
										@click="groupPages.retry(group.id)"
										>重试</UiButton
									>
									<UiButton
										v-if="groupPages.hasMore(group.id)"
										:loading="group.loading"
										@click="groupPages.loadMore(group.id)"
										>加载更多此分组 ·
										{{ groupPages.progress(group.id).loaded }} /
										{{ groupPages.progress(group.id).total }}</UiButton
									>
								</div>
							</template>
							<template #group-label="{ group }">
								<span class="data-table-group-visual">
									<ItemImage
										v-if="group.value?.item_code || group.value?.code"
										:item="stockIdentity(group.value || {})"
									/>
								</span>
							</template>
							<template #group-column="{ group, column }">
								<span
									v-if="
										['available', 'loaned', 'damaged'].includes(
											String(column.id),
										) && group.value?.[String(column.id)] !== undefined
									"
									class="operation-unit-summary"
									:title="groupUnitValues(group, String(column.id)).join('；')"
									:aria-label="
										groupUnitValues(group, String(column.id)).join('；')
									"
								>
									{{ groupUnitPreview(group, String(column.id)) }}
									<DetailPopover
										v-if="groupUnitValues(group, String(column.id)).length > 2"
										:label="`完整数量：${groupUnitValues(group, String(column.id)).join('；')}`"
										trigger-class="operation-unit-more"
									>
										<template #trigger
											>+{{
												groupUnitValues(group, String(column.id)).length -
												2
											}}
											单位</template
										>
										<ul>
											<li
												v-for="value in groupUnitValues(
													group,
													String(column.id),
												)"
												:key="value"
											>
												{{ value }}
											</li>
										</ul>
									</DetailPopover>
								</span>
							</template>
						</DataTable>
					</template>
				</div>
			</div>
			<Overlay
				v-if="analysisOpen"
				title="分析当前结果"
				adaptive-creation
				@close="analysisOpen = false"
			>
				<label class="form-field"
					>分组<select v-model="analysisDimension">
						<option value="category">类别 / 单位</option>
						<option value="location">位置 / 单位</option>
					</select></label
				>
				<ReportTable
					sticky-header
					:preference-id="`inventory.analysis.${analysisDimension}`"
					:table="{
						id: 'stock-analysis',
						label: '完整筛选分组',
						columns: [
							analysisDimension === 'category' ? 'category' : 'warehouse',
							'stock_uom',
							'item_count',
							'available',
							'loaned',
							'damaged',
						],
						rows: analysis,
					}"
					:loading="data.loading"
					:initialized="!!data.snapshot"
					:error="data.error"
					:stale="data.stale"
					@retry="load(false, true)"
				/>
				<p class="muted">统计完整筛选结果；跨位置的物品数不可相加。</p>
			</Overlay>
			<RowFieldsSheet
				v-if="detailsRow"
				:title="stockName(detailsRow.row)"
				:columns="cardPartition.all"
				:row="detailsRow.row"
				@close="detailsRow = undefined"
				@open="openDetailsRow"
			>
				<template #cell="{ column, row }">
					<StockCell :column="column" :row="row" :reference="reference" />
				</template>
			</RowFieldsSheet>
			<BrowseLoadMore
				v-if="!usesTable && (isMobile || view === 'card')"
				:has-more="
					quickReportQuery.groupBy.length ? groupPages.hasMore() : data.next !== null
				"
				:loaded-count="
					quickReportQuery.groupBy.length ? groupPages.progress().loaded : rows.length
				"
				:total-count="
					quickReportQuery.groupBy.length ? groupPages.progress().total : data.total
				"
				:loading="loadingMore"
				:error="quickReportQuery.groupBy.length ? groupRoot?.error || '' : data.moreError"
				@load-more="quickReportQuery.groupBy.length ? groupPages.loadMore() : load(true)"
				@retry="quickReportQuery.groupBy.length ? groupPages.retry() : load(true, true)"
			/>
		</section>
		<ReturnToTop :active="active !== false" :hidden="isMobile && filterSheetOpen" />
		<ScanPanel
			ref="scan"
			hide-trigger
			auto-unique
			auto-camera
			@item="acceptBrowseScan"
			@location="acceptBrowseLocation"
		/>
	</div>
</template>
