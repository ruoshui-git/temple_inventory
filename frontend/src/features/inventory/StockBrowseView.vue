<script setup lang="ts">
import { siteDateTime } from "../../lib/nativeTime";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { useFocusVisibility } from "../../composables/useFocusVisibility";
import UiButton from "../../components/ui/UiButton.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { useFilterRailPreference } from "../../composables/useFilterRailPreference";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import { removeGroupByField } from "../../lib/groupBy";
import { groupLabels } from "../../lib/reportContract";
import ReportTable from "../../components/ui/ReportTable.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import BrowseSplitButton from "../../components/ui/BrowseSplitButton.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import Overlay from "../../components/ui/Overlay.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import FilterRailEdge from "../../components/ui/FilterRailEdge.vue";
import { compactGroupSummary } from "../../lib/groupSummary";
import ItemImage from "../../components/ItemImage.vue";
import StockDetails from "../../components/StockDetails.vue";
import QuickExport from "../../components/QuickExport.vue";
import Scanner from "../../components/Scanner.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import SortControl from "../../components/ui/SortControl.vue";
import DataTable from "../../components/ui/DataTable.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import type {
	DataColumn,
	DataTableEntry,
	DataTableGroup,
	DataTableRecord,
} from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { useOptionalInventoryServices } from "../../services/contracts";

import type { StockItem } from "../../lib/stockPresentation";
import type { useStockBrowseController } from "./useStockBrowseController";
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
	reference,
	data,
	loadingMore,
	search,
	scope,
	view,
	sort,
	descending,
	selected,
	inStockOnly,
	analysisDimension,
	query: quickReportQuery,
	groups: groupPages,
	setGroupBy,
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
const { isMobile } = useResponsiveLayout();
const inventoryRoot = ref<HTMLElement>();
const toolbar = ref<InstanceType<typeof BrowseToolbar>>();
const browseHeader = computed(() => toolbar.value?.$el as HTMLElement | undefined);
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
const inventoryColumns = computed<DataColumn[]>(() => [
	{
		id: "image",
		label: "图片",
		defaultVisible: true,
		minWidth: "72px",
	},
	{
		id: "item_name",
		label: "物品名称",
		defaultVisible: true,
		required: true,
		sortable: true,
		minWidth: "230px",
	},
	{
		id: "item_code",
		label: "物品编号",
		defaultVisible: true,
		sortable: true,
		minWidth: "130px",
	},
	{
		id: "category",
		label: "类别",
		defaultVisible: wideScreen.value,
		sortable: true,
		minWidth: "130px",
	},
	{ id: "locations", label: "位置与批次", defaultVisible: wideScreen.value, minWidth: "210px" },
	{
		id: "stock_uom",
		label: "库存单位",
		defaultVisible: true,
		sortable: true,
		minWidth: "100px",
	},
	{
		id: "available",
		label: "可用数量",
		defaultVisible: true,
		sortable: true,
		align: "end",
		minWidth: "120px",
	},
	{
		id: "loaned",
		label: "借出",
		defaultVisible: true,
		sortable: true,
		align: "end",
		minWidth: "100px",
	},
	{
		id: "damaged",
		label: "损坏",
		defaultVisible: true,
		sortable: true,
		align: "end",
		minWidth: "100px",
	},
	{ id: "expiry", label: "效期", defaultVisible: true, minWidth: "110px" },
	{ id: "actions", label: "操作", defaultVisible: true, minWidth: "140px" },
]);
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
function groupSummary(group: DataTableGroup) {
	const row = group.value || {};
	const quantity = ["available", "loaned", "damaged"]
		.filter((key) => row[key] !== undefined)
		.sort((a, b) => Number(row[b]) - Number(row[a]))
		.map(
			(key) =>
				`${key === "available" ? "可用" : key === "loaned" ? "借出" : "损坏"} ${row[key]}${row.stock_uom ? ` ${row.stock_uom}` : ""}`,
		);
	return quantity.join(" · ");
}
function groupSummaryDisplay(group: DataTableGroup) {
	return compactGroupSummary(groupSummary(group));
}
type StockTableRow = Record<string, unknown>;
function stockCode(row: StockTableRow) {
	return String(row.code || row.item_code || "");
}
function stockName(row: StockTableRow) {
	return String(row.name || row.item_name || stockCode(row));
}
function stockUnit(row: StockTableRow) {
	return String(row.uom || row.stock_uom || "");
}
function stockSelectionKey(row: StockTableRow) {
	return stockCode(row) || String(row.id || "");
}
function stockIdentity(row: StockTableRow) {
	return { code: stockCode(row), name: stockName(row), image: String(row.image || "") };
}
function isStockItemRow(row: StockTableRow): row is StockTableRow & StockItem {
	return Array.isArray(row.locations);
}
function stockLocationLabel(row: StockTableRow) {
	const location = warehouseLabel(
		row.warehouse || row.warehouse_label,
		reference.warehouses,
		row.warehouse_label,
	);
	const batch = String(row.batch_no || "");
	return [location, batch].filter(Boolean).join(" · ") || "—";
}
function stockExpiryLabel(row: StockTableRow) {
	if (isStockItemRow(row)) return expiryStatus(row);
	const date = String(row.expiry_date || "");
	return date ? (date < reference.siteDate ? "已过期" : "未过期") : "无效期";
}
const services = useOptionalInventoryServices();
const tablePreferences = services
	? useColumnPreferences("stock.summary", inventoryColumns, reference, services)
	: undefined;
function setSelected(code: string, checked: boolean) {
	const isSelected = selected.value.includes(code);
	if (checked !== isSelected) props.controller.toggle(code);
}
function stockRowAction(row: StockTableRow, kind: string) {
	if (!isStockItemRow(row)) return;
	props.controller.rowAction(kind, row);
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
const scanOpen = ref(false);
const filterSheetOpen = ref(false);
watch([() => props.active, isMobile], () => {
	scanOpen.value = false;
	analysisOpen.value = false;
});
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
			@scan="scanOpen = true"
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
				<UiButton v-if="appliedChips.length" variant="ghost" @click="controller.reset"
					>清除全部</UiButton
				>
			</template>
			<template #filters>
				<div class="browse-filter-mega">
					<section>
						<h3>筛选</h3>
						<BrowseFilters
							v-model="scope"
							disclosure-mode
							:fields="['item', 'categories', 'warehouses']"
							:hierarchy-in-rail="filtersOpen && !isMobile"
							hide-activity
						/>
						<details class="browse-filter-disclosure" data-filter-field="includeZero">
							<summary class="ti-disclosure">
								<DisclosureIcon variant="inline" />
								库存状态
								<small>{{ inStockOnly ? "仅有库存" : "包括零库存" }}</small>
							</summary>
							<label class="preview-choice-label preview-check"
								><input type="checkbox" v-model="inStockOnly" />仅有库存</label
							>
						</details>
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
				<BrowseOverflowMenu>
					<QuickExport
						:query="quickReportQuery"
						:active="active"
						@open-full="emit('openExport', $event)"
					/>
				</BrowseOverflowMenu>
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
					v-if="selected.length"
					class="selection-bar stock-selection-actions"
					role="region"
					aria-label="已选物品操作"
				>
					<span role="status">已选择 {{ selected.length }} 项物品</span>
					<UiButton
						v-for="item in controller.selectedActions.value"
						:key="item.kind"
						:icon="item.icon"
						@click="controller.selectedAction(item.kind)"
						>{{ item.name }}</UiButton
					>
					<UiButton variant="ghost" @click="selected = []">取消选择</UiButton>
				</div>
			</template>
		</BrowseToolbar>
		<section class="inventory-surface">
			<BrowseResultSummary
				v-if="data.snapshot"
				:label="`${data.total} 种物品`"
				:metrics="metrics"
				:loading="status === 'refresh'"
			>
				<template #controls>
					<div class="segmented stock-view-icons" aria-label="库存显示方式">
						<button
							:aria-label="'卡片视图'"
							:title="'卡片'"
							:aria-pressed="view === 'card'"
							@click="view = 'card'"
						>
							<InventoryIcon name="card" /><span>卡片</span>
						</button>
						<button
							:aria-label="'列表视图'"
							:title="'列表'"
							:aria-pressed="view === 'table'"
							@click="view = 'table'"
						>
							<InventoryIcon name="table" /><span>列表</span>
						</button>
					</div>
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
							table-class="preview-table"
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
								: 'stock-grid',
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
						<p
							v-if="
								status === 'refresh' &&
								!quickReportQuery.groupBy.length &&
								(isMobile || view === 'card')
							"
							class="notice-bar"
							role="status"
						>
							<span class="sr-only" role="status">库存结果刷新中…</span>
						</p>
						<div
							v-if="!quickReportQuery.groupBy.length && view === 'card'"
							class="stock-grid"
							:class="{ refreshing: data.stale }"
							:inert="data.stale || undefined"
						>
							<article
								v-for="item in rows"
								:data-browse-row="item.code"
								:key="item.code"
								class="stock-card"
								:class="{ selected: selected.includes(item.code) }"
							>
								<div class="stock-card-image">
									<ItemImage
										:has-artwork="!!hasArtwork?.(item)"
										frame
										:item="item"
										interaction="detail"
										@detail="openItem(item)"
										><template #artwork
											><slot
												name="artwork"
												:item="item" /></template></ItemImage
									><label class="card-checkbox"
										><input
											type="checkbox"
											:checked="selected.includes(item.code)"
											:aria-label="`选择${item.name}`"
											@change="toggle(item.code)" /></label
									><span
										v-if="expiryStatus(item)"
										class="badge art-badge"
										:class="
											expiryStatus(item) === '未过期'
												? 'neutral'
												: expiryStatus(item) === '已过期'
													? 'danger'
													: 'warning'
										"
										>{{ expiryStatus(item) }}</span
									>
								</div>
								<div class="stock-card-content">
									<span class="eyebrow"
										>{{ item.category ? `${item.category} · ` : ""
										}}{{ item.code }}</span
									><button class="item-name" @click="openItem(item)">
										{{ item.name }}
									</button>
									<div class="stock-number">
										<span
											><strong>{{ item.available }}</strong>
											{{ item.uom }}</span
										><small>可用库存</small>
									</div>
									<div class="stock-secondary">
										<span
											>总量
											{{ item.available + item.loaned + item.damaged }}</span
										><span>借出 {{ item.loaned }}</span
										><span>损坏 {{ item.damaged }}</span>
									</div>

									<StockDetails
										:item="item"
										:loading="status === 'refresh'"
										:initialized="Boolean(data.snapshot)"
										:stale="data.stale"
									/>
								</div>
							</article>
						</div>
						<div
							v-if="!quickReportQuery.groupBy.length && isMobile && view === 'table'"
							class="stock-list"
							:class="{ refreshing: data.stale }"
							:inert="data.stale || undefined"
						>
							<article
								v-for="item in rows"
								:key="item.code"
								:data-browse-row="item.code"
								class="stock-list-row"
								:class="{ selected: selected.includes(item.code) }"
							>
								<div class="stock-list-image" @click.stop>
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
								<button class="stock-list-open" @click="openItem(item)">
									<span class="stock-list-identity">
										<strong class="stock-list-name">{{ item.name }}</strong>
										<span class="stock-list-meta"
											>{{ item.code
											}}{{
												item.category ? ` · ${item.category}` : ""
											}}</span
										>
									</span>
									<span class="stock-list-quantity">
										<strong>{{ item.available }} {{ item.uom }}</strong>
										<span
											v-if="item.loaned || item.damaged"
											class="stock-list-status"
										>
											<span v-if="item.loaned">借 {{ item.loaned }}</span>
											<span v-if="item.damaged">损 {{ item.damaged }}</span>
										</span>
									</span>
								</button>
								<label class="stock-list-checkbox" @click.stop>
									<input
										type="checkbox"
										:checked="selected.includes(item.code)"
										:aria-label="`选择${item.name}`"
										@change="toggle(item.code)"
									/>
								</label>
							</article>
						</div>
						<DataTable
							v-if="
								quickReportQuery.groupBy.length || (!isMobile && view === 'table')
							"
							data-browse-scroll="inventory-table"
							ariaLabel="库存物品"
							table-class="preview-table"
							:columns="inventoryColumns"
							:rows="browseTableRows"
							:column-preferences="tablePreferences"
							:row-key="stockSelectionKey"
							:selection-label="(row) => stockName(row)"
							empty-action="显示全部物品"
							@empty-action="reset"
							:sort-by="sort"
							:sort-direction="sortDirection"
							selection-enabled
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
								<div
									v-if="column.id === 'actions' && isStockItemRow(row)"
									class="browse-row-actions stock-row-actions"
								>
									<UiButton
										variant="ghost"
										@click="props.controller.openItemCode(stockCode(row))"
										>打开</UiButton
									>
									<UiButton
										v-if="reference.operations.Issue && isStockItemRow(row)"
										variant="ghost"
										@click="stockRowAction(row, 'Issue')"
										>出库</UiButton
									>
								</div>
								<div v-if="column.id === 'image'" class="table-item-image">
									<ItemImage :item="stockIdentity(row)"></ItemImage>
								</div>
								<button
									v-else-if="column.id === 'item_name'"
									class="item-name"
									@click="props.controller.openItemCode(stockCode(row))"
								>
									{{ stockName(row) }}
								</button>
								<template v-else-if="column.id === 'item_code'">{{
									stockCode(row)
								}}</template>
								<template v-else-if="column.id === 'stock_uom'">{{
									stockUnit(row)
								}}</template>
								<template v-else-if="column.id === 'category'">{{
									row.category || "未分类"
								}}</template>
								<StockDetails
									v-else-if="column.id === 'locations' && isStockItemRow(row)"
									:item="row"
									:loading="status === 'refresh'"
									:initialized="Boolean(data.snapshot)"
									:stale="data.stale"
								/>
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
								<template v-else-if="column.id === 'available'">{{
									row.available
								}}</template>
								<template v-else-if="column.id === 'loaned'">{{
									row.loaned
								}}</template>
								<template v-else-if="column.id === 'damaged'">{{
									row.damaged
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
							<template #group-column="{ group, column }">
								<span v-if="column.id === 'image'" class="table-item-image">
									<ItemImage
										v-if="group.value?.item_code || group.value?.code"
										:item="stockIdentity(group.value || {})"
									/>
								</span>
								<span
									v-if="
										['available', 'loaned', 'damaged'].includes(
											String(column.id),
										) && group.value?.[String(column.id)] !== undefined
									"
								>
									{{ group.value[String(column.id)] }}
									{{ group.value.stock_uom || "" }}
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
				<label class="preview-field"
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
			<footer class="result-footer">
				<span v-if="data.stale && status !== 'refresh'" role="status"
					>上次结果 · 尚未更新</span
				>
				<span v-if="data.error || data.moreError" role="alert"
					>{{ data.error || data.moreError }}
					<UiButton @click="load(!!data.moreError, true)">重试加载</UiButton></span
				>
				<UiButton
					v-else-if="
						data.next !== null &&
						!quickReportQuery.groupBy.length &&
						(isMobile || view === 'card')
					"
					:loading="loadingMore"
					@click="load(true)"
					>加载更多 · {{ rows.length }} / {{ data.total }}</UiButton
				>
			</footer>
		</section>
		<ReturnToTop :active="active !== false" :hidden="isMobile && filterSheetOpen" />
		<Scanner
			v-if="scanOpen"
			presentation="modal"
			@close="scanOpen = false"
			@scan="
				(value) => {
					search = value;
					scanOpen = false;
				}
			"
		/>
	</div>
</template>
