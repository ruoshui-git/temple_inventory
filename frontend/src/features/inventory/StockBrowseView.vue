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
import { groupLabels } from "../../lib/reportContract";
import ReportTable from "../../components/ui/ReportTable.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import BrowseCard from "../../components/ui/BrowseCard.vue";
import BrowseLoadMore from "../../components/ui/BrowseLoadMore.vue";
import ItemCard from "../../components/ui/ItemCard.vue";
import ViewModeToggle from "../../components/ui/ViewModeToggle.vue";
import BrowseSplitButton from "../../components/ui/BrowseSplitButton.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import FilterDisclosure from "../../components/ui/FilterDisclosure.vue";
import AsOfFilter from "../../components/ui/AsOfFilter.vue";
import Overlay from "../../components/ui/Overlay.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import FilterRailEdge from "../../components/ui/FilterRailEdge.vue";
import { compactGroupSummary } from "../../lib/groupSummary";
import ItemImage from "../../components/ItemImage.vue";
import StockDetails from "../../components/StockDetails.vue";
import QuickExport from "../../components/QuickExport.vue";
import ScanPanel from "../scanner/ScanPanel.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import SortControl from "../../components/ui/SortControl.vue";
import DataTable from "../../components/ui/DataTable.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import BrowseRefreshNotice from "../../components/ui/BrowseRefreshNotice.vue";
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import type {
	DataColumn,
	DataTableEntry,
	DataTableGroup,
	DataTableRecord,
} from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { exportFields } from "../../lib/exportColumns";
import { useOptionalInventoryServices } from "../../services/contracts";
import { RouterLink } from "vue-router";
import { routeTarget } from "../../lib/routeRegistry";
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
import { inventoryColumnsForPage, stockExportTableFor } from "./stockColumns";
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
const groupRoot = computed(() => groupPages.pages.value["[[],null]"]);
const groupedCardSections = computed(() => {
	return stockGroupedCardSections(groupPages.entries.value);
});
function groupNumber(value: unknown) {
	const quantity = Number(value || 0);
	return `${quantity < 0 ? "−" : ""}${formatQuantity(Math.abs(quantity))}`;
}
function groupSummary(group: DataTableGroup) {
	const units = Array.isArray(group.value?.unit_totals)
		? (group.value.unit_totals as Record<string, unknown>[])
		: [];
	const quantity = ["available", "loaned", "damaged", "stock_qty"].flatMap((key) =>
		units.map(
			(row) =>
				`${key === "available" ? "可用" : key === "loaned" ? "借出" : key === "damaged" ? "损坏" : "合计"} ${groupNumber(row[key])} ${unitLabel(String(row.stock_uom || ""))}`,
		),
	);
	return quantity.join(" · ");
}
function groupSummaryDisplay(group: DataTableGroup) {
	return compactGroupSummary(groupSummary(group));
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
type StockTableRow = Record<string, unknown>;
function stockCode(row: StockTableRow) {
	return String(row.code || row.item_code || "");
}
function stockName(row: StockTableRow) {
	return String(row.name || row.item_name || stockCode(row));
}
function stockSelectionKey(row: StockTableRow) {
	return stockCode(row) || String(row.id || "");
}
function stockIdentity(row: StockTableRow) {
	return { code: stockCode(row), name: stockName(row), image: String(row.image || "") };
}
function serialPreview(row: StockTableRow) {
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
function openGroupedStock(row: StockTableRow) {
	props.controller.openItemCode(stockCode(row));
}
function isStockItemRow(row: StockTableRow): row is StockTableRow & StockItem {
	return Array.isArray(row.locations);
}
function stockLocationLabel(row: StockTableRow) {
	return (
		warehouseLabel(
			row.warehouse || row.warehouse_label,
			reference.warehouses,
			row.warehouse_label,
		) || "—"
	);
}
function stockLocationDetail(row: StockTableRow, field: "path" | "nativeName") {
	if (!isStockItemRow(row))
		return String(row[field === "path" ? "warehouse_path" : "warehouse_native_name"] || "");
	return row.locations
		.map((location) => location[field])
		.filter(Boolean)
		.join("；");
}
function stockComponentDetail(
	row: StockTableRow,
	field: "warehouse_label" | "batch_no" | "expiry_date" | "remaining_days" | "expiry_state",
) {
	const values = isStockItemRow(row)
		? row.locations.flatMap((location) => {
				if (field === "warehouse_label") return [location.label];
				return (location.batches || []).map((batch) => {
					if (field === "batch_no") return batch.id;
					if (field === "expiry_date") return batch.expiry;
					if (!batch.expiry) return "";
					if (field === "expiry_state")
						return batch.expiry < reference.siteDate ? "已过期" : "未过期";
					return String(
						Math.ceil(
							(Date.parse(`${batch.expiry}T00:00:00Z`) -
								Date.parse(`${reference.siteDate}T00:00:00Z`)) /
								86_400_000,
						),
					);
				});
			})
		: [row[field]];
	return [...new Set(values.map((value) => String(value || "")).filter(Boolean))].join("；");
}
function stockExpiryLabel(row: StockTableRow) {
	if (isStockItemRow(row)) return expiryStatus(row);
	const date = String(row.expiry_date || "");
	return date ? (date < reference.siteDate ? "已过期" : "未过期") : "无效期";
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
						v-if="isMobile"
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
					v-if="!isMobile"
					icon="select"
					:aria-pressed="selecting"
					@click="selecting ? controller.exitSelection() : controller.enterSelection()"
					>{{ selecting ? "取消选择" : "选择" }}</UiButton
				>
				<BrowseSplitButton
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
						v-if="view === 'card' || (isMobile && view === 'table')"
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
					<ViewModeToggle v-model="view" :ariaLabel="'库存显示方式'" />
					<SortControl
						v-if="isMobile || view === 'card'"
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
						v-if="
							status === 'loading' &&
							(quickReportQuery.groupBy.length || (!isMobile && view === 'table'))
						"
						class="stock-table-initial-skeleton"
					>
						<DataTable
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
							isMobile && view === 'table'
								? 'stock-list stock-list-skeleton'
								: 'browse-card-grid stock-grid',
						]"
						role="status"
						aria-label="库存结果加载中"
					>
						<SkeletonBlock
							v-if="isMobile && view === 'table'"
							variant="stock-row"
							:rows="8"
						/>
						<template v-else>
							<SkeletonBlock v-for="row in 8" :key="row" variant="card" />
						</template>
					</div>
					<div v-else-if="status === 'error'" class="empty-panel">
						<InventoryIcon name="warning" />
						<h3>暂时无法读取库存</h3>
						<p>筛选与选择已保留，请重试。</p>
						<UiButton @click="load(false, true)">重试</UiButton>
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
								<button
									class="stock-card-group-heading"
									:aria-expanded="section.group.expanded"
									@click="groupPages.toggleGroup(section.group.id)"
								>
									<strong>{{ section.group.label }}</strong>
									<span>{{ section.group.count }} 项</span>
									<span class="stock-card-group-summary">{{
										groupSummaryDisplay(section.group)
									}}</span>
								</button>
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
										:code="stockCode(entry.value)"
										:category="String(entry.value.category || '')"
										:image="stockIdentity(entry.value)"
										:quantity="Number(entry.value.available || 0)"
										quantity-label="可用库存"
										:unit="
											String(entry.value.uom || entry.value.stock_uom || '')
										"
										class="stock-card"
										@toggle="toggle(stockSelectionKey(entry.value))"
										@open="openGroupedStock(entry.value)"
									>
										<div class="stock-secondary">
											<span
												>总量
												{{
													Number(entry.value.available || 0) +
													Number(entry.value.loaned || 0) +
													Number(entry.value.damaged || 0)
												}}</span
											><span>借出 {{ entry.value.loaned || 0 }}</span
											><span>损坏 {{ entry.value.damaged || 0 }}</span>
										</div>
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
								:code="item.code"
								:category="item.category"
								:image="item"
								:quantity="item.available"
								quantity-label="可用库存"
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
								<div class="stock-secondary">
									<span
										>总量
										{{ item.available + item.loaned + item.damaged }}</span
									><span>借出 {{ item.loaned }}</span
									><span>损坏 {{ item.damaged }}</span>
								</div>
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
								<StockDetails
									:item="item"
									:loading="status === 'refresh'"
									:initialized="Boolean(data.snapshot)"
									:stale="data.stale"
								/>
							</ItemCard>
						</div>
						<div
							v-if="!quickReportQuery.groupBy.length && isMobile && view === 'table'"
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
								class="stock-list-row"
								@toggle="toggle(item.code)"
								@open="openItem(item)"
							>
								<template #media>
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
											<strong class="stock-list-name">{{
												item.name
											}}</strong>
											<span v-if="item.disabled" class="badge neutral"
												>已停用</span
											>
											<span class="stock-list-meta"
												>{{ item.code
												}}{{
													item.category ? ` · ${item.category}` : ""
												}}</span
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
										<span class="stock-list-quantity">
											<strong
												><UnitText :name="item.uom" :qty="item.available"
											/></strong>
											<span
												v-if="item.loaned || item.damaged"
												class="stock-list-status"
											>
												<span v-if="item.loaned"
													>借 {{ item.loaned }}</span
												>
												<span v-if="item.damaged"
													>损 {{ item.damaged }}</span
												>
											</span>
										</span>
									</button>
								</template>
							</BrowseCard>
						</div>
						<DataTable
							v-if="
								(quickReportQuery.groupBy.length && view === 'table') ||
								(!quickReportQuery.groupBy.length && !isMobile && view === 'table')
							"
							data-browse-scroll="inventory-table"
							ariaLabel="库存物品"
							table-class="data-table"
							:columns="inventoryColumns"
							:rows="browseTableRows"
							:group-summary-columns="() => ['available', 'loaned', 'damaged']"
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
								<div v-if="column.id === 'image'" class="table-item-image">
									<ItemImage :item="stockIdentity(row)"></ItemImage>
								</div>
								<RouterLink
									v-else-if="column.id === 'item_name'"
									class="item-name browse-row-link"
									:to="routeTarget('item-detail', { code: stockCode(row) })"
									:title="stockName(row)"
								>
									{{ stockName(row) }}
								</RouterLink>
								<span v-if="row.disabled" class="badge neutral">已停用</span>
								<template v-else-if="column.id === 'item_code'">{{
									stockCode(row)
								}}</template>
								<template v-else-if="column.id === 'stock_uom'"
									><UnitText :name="row.uom || row.stock_uom"
								/></template>
								<template v-else-if="column.id === 'category'">{{
									row.category || "未分类"
								}}</template>
								<template v-else-if="column.id === 'warehouse_label'">{{
									stockComponentDetail(row, "warehouse_label") || "—"
								}}</template>
								<template v-else-if="column.id === 'batch_no'">{{
									stockComponentDetail(row, "batch_no") || "—"
								}}</template>
								<StockDetails
									v-else-if="column.id === 'locations' && isStockItemRow(row)"
									:item="row"
									part="locations"
									:loading="status === 'refresh'"
									:initialized="Boolean(data.snapshot)"
									:stale="data.stale"
								/>
								<StockDetails
									v-else-if="column.id === 'batches' && isStockItemRow(row)"
									:item="row"
									part="batches"
									:loading="status === 'refresh'"
									:initialized="Boolean(data.snapshot)"
									:stale="data.stale"
								/>
								<template v-else-if="column.id === 'batches'">{{
									stockComponentDetail(row, "batch_no") || "—"
								}}</template>
								<template v-else-if="column.id === 'locations'"
									><span
										:title="
											warehousePath(
												row.warehouse || row.warehouse_label,
												reference.warehouses,
												row.warehouse_label,
											)
										"
										>{{ stockLocationLabel(row) }}</span
									></template
								>
								<template v-else-if="column.id === 'warehouse_path'">{{
									stockLocationDetail(row, "path") || "—"
								}}</template>
								<template v-else-if="column.id === 'warehouse_native_name'">{{
									stockLocationDetail(row, "nativeName") || "—"
								}}</template>
								<template v-else-if="column.id === 'available'">{{
									row.available
								}}</template>
								<template v-else-if="column.id === 'loaned'">{{
									row.loaned
								}}</template>
								<template v-else-if="column.id === 'damaged'">{{
									row.damaged
								}}</template>
								<template v-else-if="column.id === 'total'">{{
									row.stock_qty
								}}</template>
								<template v-else-if="column.id === 'expiry_date'">{{
									stockComponentDetail(row, "expiry_date") || "—"
								}}</template>
								<template v-else-if="column.id === 'remaining_days'">{{
									stockComponentDetail(row, "remaining_days") || "—"
								}}</template>
								<template v-else-if="column.id === 'expiry_state'">{{
									stockComponentDetail(row, "expiry_state") || "—"
								}}</template>
								<span
									v-else-if="column.id === 'expiry' && stockExpiryLabel(row)"
									class="badge"
									:class="
										stockExpiryLabel(row) === '未过期'
											? 'success'
											: stockExpiryLabel(row) === '已过期'
												? 'danger'
												: 'warning'
									"
									>{{ stockExpiryLabel(row) }}</span
								>
							</template>
							<template #group="{ group }">
								<div class="report-group-details">
									<span
										role="note"
										:title="groupSummary(group)"
										:aria-label="groupSummary(group)"
										>{{ groupSummaryDisplay(group) }}</span
									>
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
			<BrowseLoadMore
				v-if="isMobile || view === 'card'"
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
