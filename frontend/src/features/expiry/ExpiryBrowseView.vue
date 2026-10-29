<script setup lang="ts">
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { useFilterRailPreference } from "../../composables/useFilterRailPreference";
import { nextTableSort } from "../../composables/useArrayTableSort";
import { formatExpiryDuration } from "../../lib/expiryDuration";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, ref, watch } from "vue";
import type { ExpiryBrowse } from "./useExpiryBrowse";
import { type ReportQuery, type ReportRow } from "../../lib/reportContract";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import UiButton from "../../components/ui/UiButton.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import { removeGroupByField } from "../../lib/groupBy";
import { groupLabels } from "../../lib/reportContract";
import Overlay from "../../components/ui/Overlay.vue";
import ExpiryBrowseFilters from "./ExpiryBrowseFilters.vue";
import ItemImage from "../../components/ItemImage.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import QuickExport from "../../components/QuickExport.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import SortControl from "../../components/ui/SortControl.vue";
import ScanPanel from "../scanner/ScanPanel.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import FilterRailEdge from "../../components/ui/FilterRailEdge.vue";
import DataTable from "../../components/ui/DataTable.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import type {
	DataColumn,
	DataTableEntry,
	DataTableGroup,
	DataTableRecord,
} from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { exportFields } from "../../lib/exportColumns";
import { useOptionalInventoryServices } from "../../services/contracts";
import { unitLabel } from "../../lib/units";
import UnitText from "../../components/ui/UnitText.vue";
const props = withDefaults(defineProps<{ controller: ExpiryBrowse; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	item: [code: string];
	openBatch: [name: string];
	newOperation: [kind: string];
	openExport: [query: ReportQuery];
}>();
const c = props.controller,
	{ query, scope, routeError, result, reference, chips, metrics, dimension, analysis } = c;
const { isMobile } = useResponsiveLayout();
function clearExpiryFilters() {
	c.reset();
}
const {
	open: filterOpen,
	toggle: toggleFilter,
	saveError: filterSaveError,
	retry: retryFilterSave,
} = useFilterRailPreference("stock.expiry", reference, true);
const analysisOpen = ref(false);
const filterSheetOpen = ref(false);
const scan = ref<InstanceType<typeof ScanPanel>>();
watch([() => props.active, isMobile], () => {
	analysisOpen.value = false;
});
const choices = [
	["period", "全部", "all"],
	["expired", "已过期", "expired"],
	["unexpired", "未过期", "unexpired"],
	["undated", "无效期", "undated"],
] as const;
function expiryKey(event: KeyboardEvent) {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	const index = choices.findIndex(([key]) => key === query.value.expiryWindow);
	const next =
		event.key === "Home"
			? 0
			: event.key === "End"
				? choices.length - 1
				: (index + (event.key === "ArrowRight" ? 1 : -1) + choices.length) %
					choices.length;
	query.value.expiryWindow = choices[next]![0];
	requestAnimationFrame(() =>
		document
			.querySelector<HTMLElement>(`[data-expiry-choice="${choices[next]![0]}"]`)
			?.focus(),
	);
}
function expiryIcon(key: string) {
	return (
		(
			{
				period: "calendar",
				expired: "warning",
				unexpired: "select",
				undated: "cancel",
			} as Record<string, string>
		)[key] || "calendar"
	);
}
function expiryStatus(row: ReportRow) {
	if (!row.expiry_date) return { label: "无效期", tone: "is-neutral" };
	if (String(row.expiry_date) < reference.siteDate)
		return { label: "已过期", tone: "is-danger" };
	if (typeof row.remaining_days === "number" && row.remaining_days <= 30)
		return { label: "即将到期", tone: "is-warning" };
	return { label: "未过期", tone: "is-success" };
}
function expiryCount(facet: string) {
	return result.facets[facet] ?? "…";
}
function expiryRemaining(days: number) {
	return days < 0 ? `过期${Math.abs(days)}天` : days === 0 ? "今天到期" : `剩${days}天`;
}
const analysisTable = computed(() => ({
	id: "expiry-analysis",
	label: "分析当前结果",
	columns: [
		dimension.value,
		"stock_uom",
		"item_count",
		"allocation_count",
		"available",
		"loaned",
		"damaged",
	],
	rows: analysis.value?.rows || [],
}));
const expiryColumns: DataColumn[] = [
	{ id: "image", label: "图片", defaultVisible: true },
	{
		id: "item_name",
		label: "物品名称",
		required: true,
		defaultVisible: true,
		sortable: true,
	},
	{
		id: "item_code",
		label: "物品编号",
		defaultVisible: true,
		sortable: true,
	},
	{ id: "category", label: "类别", defaultVisible: true, sortable: true },
	{
		id: "batch_no",
		label: "批次编号",
		required: true,
		defaultVisible: true,
		sortable: true,
	},
	{ id: "expiry_date", label: "效期", defaultVisible: true, sortable: true },
	{
		id: "remaining_days",
		label: "剩余时间",
		defaultVisible: true,
		sortable: true,
	},
	{
		id: "stock_qty",
		label: "库存数量",
		defaultVisible: true,
		sortable: true,
		align: "end",
	},
	{ id: "stock_uom", label: "库存单位", defaultVisible: true, sortable: true },
	{ id: "warehouse", label: "位置", defaultVisible: true, sortable: true },
	{ id: "warehouse_path", label: "完整位置", defaultVisible: false },
	{ id: "warehouse_native_name", label: "ERPNext 库位", defaultVisible: false },
];
const expiryRows = computed<DataTableRecord[]>(() =>
	result.rows.map((row) => ({ kind: "record", id: String(row.id), value: row })),
);
const displayedRows = computed<DataTableEntry[]>(() =>
	query.value.groupBy.length ? c.groups.entries.value : expiryRows.value,
);
const groupRoot = computed(() => c.groups.pages.value["[[],null]"]);
function groupSummary(group: DataTableGroup) {
	const row = group.value || {};
	const quantities = [
		["available", "可用"],
		["loaned", "借出"],
		["damaged", "损坏"],
		["stock_qty", "库存数量"],
	] as const;
	return [
		...quantities.flatMap(([key, label]) =>
			row[key] === undefined
				? []
				: [
						`${label} ${row[key]}${row.stock_uom ? ` ${unitLabel(String(row.stock_uom))}` : ""}`,
					],
		),
	].join(" · ");
}
const services = useOptionalInventoryServices();
const tablePreferences =
	services && !routeError.value
		? useColumnPreferences(
				"expiry.batches",
				computed(() => expiryColumns),
				reference,
				services,
			)
		: undefined;
const expiryExportMap: Record<string, string[]> = {
	image: ["image_file"],
	item_name: ["item_name"],
	item_code: ["item_code"],
	category: ["category"],
	batch_no: ["batch_no"],
	expiry_date: ["expiry_date", "expiry_state"],
	remaining_days: ["remaining_days"],
	stock_qty: ["stock_qty"],
	stock_uom: ["stock_uom"],
	warehouse: ["warehouse"],
	warehouse_path: ["warehouse_path"],
	warehouse_native_name: ["warehouse_native_name"],
};
const expiryExportVisible = computed(() =>
	tablePreferences?.visible.value.length
		? tablePreferences.visible.value
		: expiryColumns
				.filter((column) => column.defaultVisible !== false || column.required)
				.map((column) => String(column.id)),
);
const expiryExportOrder = computed(() =>
	tablePreferences?.order.value.length
		? tablePreferences.order.value
		: expiryColumns.map((column) => String(column.id)),
);
const expiryExportColumns = computed(() =>
	exportFields(expiryExportMap, expiryExportOrder.value, expiryExportVisible.value),
);
const tableSortBy = computed(() => query.value.sortBy);
function openItem(row: ReportRow) {
	if (!result.stale) emit("item", String(row.item_code));
}
function openBatch(row: ReportRow) {
	if (!result.stale) emit("openBatch", String(row.batch_no));
}
function sortBy(field: ReportQuery["sortBy"]) {
	const next = nextTableSort(field, query.value.sortBy, query.value.sort);
	query.value.sortBy = next.field;
	query.value.sort = next.direction;
}
function headerSort(column: string) {
	if (
		[
			"item_name",
			"item_code",
			"category",
			"stock_uom",
			"warehouse",
			"batch_no",
			"expiry_date",
			"remaining_days",
			"stock_qty",
			"identity",
		].includes(column)
	)
		sortBy(column);
}
function sortState(field: string) {
	return query.value.sortBy === field
		? query.value.sort === "asc"
			? "ascending"
			: "descending"
		: "none";
}
const sortFields = [
	{ value: "expiry_date", label: "到期日", kind: "expiry" },
	{ value: "item_name", label: "物品名称", kind: "text" },
	{ value: "batch_no", label: "批次编号", kind: "text" },
	{ value: "stock_qty", label: "库存数量", kind: "number" },
	{ value: "item_code", label: "物品编号", kind: "text" },
	{ value: "category", label: "类别", kind: "text" },
	{ value: "stock_uom", label: "库存单位", kind: "text" },
	{ value: "warehouse", label: "位置", kind: "text" },
	{ value: "remaining_days", label: "剩余时间", kind: "expiry" },
] as const;
function sortGlyph(field: ReportQuery["sortBy"]) {
	return query.value.sortBy === field ? (query.value.sort === "asc" ? "↑" : "↓") : "↕";
}
</script>
<template>
	<section class="browse-page">
		<ReturnToTop :active="active" :hidden="isMobile && filterSheetOpen" />
		<BrowseToolbar
			title="效期批次"
			:summary="result.initialized ? `效期批次 · ${result.batchCount} 个批次` : ''"
			v-model:search="query.search"
			search-label="搜索物品、批次或位置"
			:active="active"
			:sidebar-open="filterOpen"
			:sidebar-save-error="filterSaveError"
			:retry-sidebar-save="retryFilterSave"
			@filter-open="filterSheetOpen = $event"
			sidebar-available
			:filter-count="c.scopeChips.value.length + chips.filter((chip) => !chip.fixed).length"
			scannable
			@scan="scan?.show()"
		>
			<template #persistent>
				<nav
					v-if="!isMobile"
					class="browse-view-switch expiry-window-switch"
					role="tablist"
					aria-label="效期范围"
					@keydown="expiryKey"
				>
					<button
						v-for="[key, label, facet] in choices"
						:key="key"
						role="tab"
						:data-expiry-choice="key"
						:aria-selected="query.expiryWindow === key"
						:tabindex="query.expiryWindow === key ? 0 : -1"
						aria-controls="expiry-results-panel"
						@click="query.expiryWindow = key"
					>
						<InventoryIcon :name="expiryIcon(key)" aria-hidden="true" />
						{{ label }} <small>{{ expiryCount(facet) }}</small>
					</button>
				</nav>
			</template>
			<template #actions>
				<BrowseOverflowMenu>
					<QuickExport
						v-if="!routeError"
						:query="query"
						title="效期批次"
						table="batches"
						:columns="expiryExportColumns"
						:active="active"
					/>
					<UiButton
						v-if="reference.operations.Receive"
						@click="emit('newOperation', 'Receive')"
						>入库</UiButton
					>
				</BrowseOverflowMenu>
			</template>
			<template #filters>
				<div class="browse-filter-mega">
					<section>
						<h3>筛选</h3>
						<ExpiryBrowseFilters
							:controller="c"
							disclosure-mode
							:hierarchy-in-rail="filterOpen && !isMobile"
						/>
					</section>
					<section>
						<h3>分组</h3>
						<div data-filter-field="groupBy" tabindex="-1">
							<GroupByFilter
								v-model="query.groupBy"
								:dataset="query.dataset"
								:view="query.view"
							/>
						</div>
					</section>
				</div>
			</template>
			<p v-if="routeError" role="alert">{{ routeError }}</p>
			<template #chips="{ editFilter }">
				<nav
					v-if="isMobile"
					class="browse-view-switch browse-expiry-window-switch"
					role="tablist"
					aria-label="效期筛选"
					@keydown="expiryKey"
				>
					<button
						v-for="[key, label, facet] in choices"
						:key="key"
						role="tab"
						:data-expiry-choice="key"
						:aria-selected="query.expiryWindow === key"
						:tabindex="query.expiryWindow === key ? 0 : -1"
						aria-controls="expiry-results-panel"
						@click="query.expiryWindow = key"
					>
						<InventoryIcon :name="expiryIcon(key)" aria-hidden="true" />
						<span>{{ label }}</span
						><small>{{ expiryCount(facet) }}</small>
					</button>
				</nav>
				<BrowseChip
					v-for="(group, index) in query.groupBy"
					:key="`group:${group}`"
					:label="`分组：${groupLabels[group] || group}`"
					@edit="editFilter('groupBy')"
					@remove="
						query.groupBy = removeGroupByField(
							query.dataset,
							query.view,
							query.groupBy,
							index,
						)
					"
				/>
				<BrowseChip
					v-for="chip in c.scopeChips.value"
					:key="chip.key"
					:label="chip.label"
					@edit="editFilter(chip.field)"
					@remove="c.removeScope(chip.field)"
				/>
				<BrowseChip
					v-for="chip in chips"
					:key="chip.key"
					:label="chip.summary || chip.label"
					:removable="!chip.fixed"
					@edit="editFilter(chip.field)"
					@remove="Object.assign(query, chip.reset)"
				/>
				<UiButton
					v-if="query.groupBy.length || c.scopeChips.value.length || chips.length"
					variant="ghost"
					@click="c.reset"
					>清除全部</UiButton
				>
			</template>
		</BrowseToolbar>
		<ScanPanel
			ref="scan"
			hide-trigger
			@item="(code, batch) => (query.search = batch || code)"
			@location="(name) => (scope.warehouses = [name])"
		/>
		<SkeletonBlock
			v-if="isMobile && result.loading && !result.initialized"
			variant="list"
			:rows="5"
		/>
		<p v-if="isMobile && result.error" role="alert">
			{{ result.error }} <UiButton @click="c.retry">重试</UiButton>
		</p>

		<section
			v-if="result.initialized"
			class="activity-summary"
			aria-label="当前效期汇总"
			aria-live="polite"
		>
			<BrowseResultSummary
				:label="`${result.batchCount} 个批次 · ${result.itemCount} 种物品 · ${result.total} 条存放明细`"
				:metrics="metrics"
				:loading="result.loading || result.stale"
			>
				<template #controls>
					<SortControl
						v-if="isMobile"
						v-model:field="query.sortBy"
						v-model:direction="query.sort"
						:fields="sortFields"
						label="效期排序"
					/>
					<details
						v-if="isMobile && query.expiryWindow.startsWith('next_')"
						class="browse-info-popover"
					>
						<summary aria-label="效期范围说明" title="效期范围说明">i</summary>
						<p>今日至未来 {{ query.expiryWindow.slice(5) }} 天到期，包含端点。</p>
					</details>
					<UiButton
						icon="report"
						:icon-only="isMobile"
						label="分析结果"
						@click="analysisOpen = true"
						>分析结果</UiButton
					>
				</template>
			</BrowseResultSummary>
		</section>
		<p v-if="!isMobile && query.expiryWindow.startsWith('next_')" class="browse-note">
			今日至未来 {{ query.expiryWindow.slice(5) }} 天到期，包含端点。
		</p>
		<div class="browse-body">
			<aside v-if="filterOpen && !isMobile" class="browse-filter-rail browse-filter-rail">
				<div class="filter-rail-heading">
					<h3>筛选批次</h3>
					<FilterRailEdge
						:open="true"
						:active="scope.categories.length + scope.warehouses.length > 0"
						@toggle="toggleFilter"
					/>
				</div>
				<BrowseFilters
					v-model="scope"
					:fields="['categories', 'warehouses']"
					hide-activity
				/>
			</aside>
			<FilterRailEdge
				v-if="!filterOpen && !isMobile"
				:open="false"
				:active="scope.categories.length + scope.warehouses.length > 0"
				@toggle="toggleFilter"
			/>
			<div id="expiry-results-panel" role="tabpanel" class="browse-results">
				<div v-if="isMobile && !query.groupBy.length" class="expiry-mobile">
					<article
						v-for="row in result.rows"
						:key="String(row.id)"
						:data-browse-row="String(row.id)"
						class="browse-card expiry-phone-card"
					>
						<div class="expiry-phone-identity">
							<div class="browse-group-thumbnail">
								<ItemImage :item="c.item(row)" />
							</div>
							<button
								class="browse-row-link"
								:disabled="result.stale"
								@click="openItem(row)"
							>
								<strong>{{ row.item_name }}</strong
								><small>{{ row.category }}</small>
							</button>
						</div>
						<button
							class="browse-row-link expiry-phone-batch"
							:aria-label="`查看批次 ${row.batch_no}`"
							:disabled="result.stale"
							@click="openBatch(row)"
						>
							批次 {{ row.batch_no }}
						</button>
						<div class="expiry-phone-meta">
							<span>{{ row.expiry_date || "无效期" }}</span>
							<span
								><UnitText :name="row.stock_uom" :qty="Number(row.stock_qty || 0)"
							/></span>
							<span
								class="browse-badge"
								:class="expiryStatus(row as unknown as ReportRow).tone"
							>
								{{ expiryStatus(row as unknown as ReportRow).label }}
							</span>
							<small
								v-if="typeof row.remaining_days === 'number'"
								:title="formatExpiryDuration(row.remaining_days)"
								>{{ expiryRemaining(row.remaining_days) }}</small
							>
						</div>
					</article>
				</div>
				<!-- Phones show ungrouped results as cards; grouped results stay tabular. -->
				<DataTable
					v-if="!isMobile || query.groupBy.length"
					data-browse-scroll="expiry-table"
					ariaLabel="效期批次"
					table-class="browse-table"
					:columns="expiryColumns"
					:rows="displayedRows"
					:column-preferences="tablePreferences"
					:sort-by="tableSortBy"
					:sort-direction="query.sort"
					:loading="
						result.loading || Boolean(query.groupBy.length && groupRoot?.loading)
					"
					:initialized="Boolean(result.initialized || groupRoot?.initialized)"
					:error="query.groupBy.length ? groupRoot?.error || result.error : result.error"
					:stale="query.groupBy.length ? Boolean(groupRoot?.stale) : result.stale"
					:retained="
						Boolean(
							query.groupBy.length
								? groupRoot?.rows.length && groupRoot.loading && groupRoot.stale
								: result.rows.length && result.loading && result.stale,
						)
					"
					:has-more="query.groupBy.length ? c.groups.hasMore() : result.next !== null"
					:loaded-count="
						query.groupBy.length ? c.groups.progress().loaded : result.rows.length
					"
					:total-count="query.groupBy.length ? c.groups.progress().total : result.total"
					:loading-more="
						query.groupBy.length
							? Boolean(groupRoot?.loading && groupRoot.rows.length)
							: result.loading && result.rows.length > 0
					"
					empty-text="没有符合条件的批次"
					empty-action="清空筛选"
					@empty-action="clearExpiryFilters"
					:row-attributes="(row) => ({ 'data-browse-row': String(row.id) })"
					@sort="headerSort"
					@toggle-group="c.groups.toggleGroup"
					@retry="query.groupBy.length ? c.groups.retry() : c.retry()"
					@load-more="query.groupBy.length ? c.groups.loadMore() : c.load(true)"
				>
					<template #cell="{ column, row }">
						<div v-if="column.id === 'image'" class="expiry-item-identity">
							<ItemImage :item="c.item(row as unknown as ReportRow)" />
						</div>
						<button
							v-else-if="column.id === 'item_name'"
							class="browse-row-link"
							:disabled="result.stale"
							@click="openItem(row as unknown as ReportRow)"
						>
							<strong>{{ row.item_name }}</strong>
						</button>
						<template v-else-if="column.id === 'item_code'">{{
							row.item_code
						}}</template>
						<template v-else-if="column.id === 'category'">{{
							row.category || "未分类"
						}}</template>
						<button
							v-else-if="column.id === 'batch_no'"
							class="browse-row-link"
							:aria-label="`打开批次资料：${row.batch_no}`"
							:disabled="result.stale"
							@click="openBatch(row as unknown as ReportRow)"
						>
							{{ row.batch_no }}
						</button>
						<span
							v-else-if="column.id === 'expiry_date'"
							class="browse-badge"
							:class="
								!row.expiry_date
									? 'is-neutral'
									: String(row.expiry_date) < reference.siteDate
										? 'is-danger'
										: 'is-success'
							"
							>{{ row.expiry_date || "无效期" }}</span
						>
						<template v-else-if="column.id === 'remaining_days'">
							<span
								v-if="typeof row.remaining_days === 'number'"
								:title="formatExpiryDuration(row.remaining_days)"
								>{{ expiryRemaining(row.remaining_days) }}</span
							>
						</template>
						<template v-else-if="column.id === 'stock_qty'"
							>{{ row.stock_qty
							}}<span v-if="Number(row.loaned) > 0" class="browse-badge is-warning"
								>借出</span
							><span
								v-else-if="Number(row.damaged) > 0"
								class="browse-badge is-danger"
								>损坏</span
							></template
						>
						<template v-else-if="column.id === 'stock_uom'"
							><UnitText :name="row.stock_uom"
						/></template>
						<template v-else-if="column.id === 'warehouse'">{{
							warehouseLabel(
								String(row.warehouse || ""),
								reference.warehouses,
								String(row.warehouse_label || ""),
							)
						}}</template>
						<template v-else-if="column.id === 'warehouse_path'">{{
							row.warehouse_path || "—"
						}}</template>
						<template v-else-if="column.id === 'warehouse_native_name'">{{
							row.warehouse_native_name || "—"
						}}</template>
					</template>
					<template #group="{ group }">
						<div class="report-group-details">
							{{ groupSummary(group) }}
							<UiButton v-if="group.error" @click="c.groups.retry(group.id)"
								>重试</UiButton
							>
							<UiButton
								v-if="c.groups.hasMore(group.id)"
								:loading="group.loading"
								@click="c.groups.loadMore(group.id)"
								>加载更多此分组 · {{ c.groups.progress(group.id).loaded }} /
								{{ c.groups.progress(group.id).total }}</UiButton
							>
						</div>
					</template>
					<template #group-column="{ group, column }">
						<span v-if="column.id === 'image'" class="table-item-image">
							<ItemImage
								v-if="group.value?.item_code"
								:item="c.item(group.value as unknown as ReportRow)"
							/>
						</span>
						<span
							v-if="
								['available', 'loaned', 'damaged', 'stock_qty'].includes(
									String(column.id),
								) && group.value?.[String(column.id)] !== undefined
							"
						>
							{{ group.value[String(column.id)] }}
							{{ unitLabel(String(group.value.stock_uom || "")) }}
						</span>
						<span v-else-if="column.id === 'stock_uom'"
							><UnitText :name="group.value?.stock_uom"
						/></span>
					</template>
				</DataTable>
				<p
					v-if="
						isMobile &&
						result.initialized &&
						!result.loading &&
						!result.error &&
						!result.rows.length
					"
				>
					没有符合条件的批次
				</p>
				<UiButton
					v-if="isMobile && result.next !== null"
					:loading="result.loading"
					@click="c.load(true)"
					>加载更多 · {{ result.rows.length }} / {{ result.total }}</UiButton
				>

				<Overlay
					v-if="analysisOpen"
					title="分析当前结果"
					adaptive-creation
					@close="analysisOpen = false"
				>
					<label class="form-field"
						>分析维度<select v-model="dimension">
							<option value="category">类别</option>
							<option value="warehouse">位置</option>
						</select></label
					>
					<ReportTable
						v-if="analysis"
						:preference-id="`expiry.analysis.${dimension}`"
						:table="analysisTable"
						:total="analysis.matched_count"
						:loading="analysis.loading"
						:initialized="result.initialized"
						:error="analysis.error"
						@load-more="c.moreAnalysis"
						@retry="c.moreAnalysis"
					/>
				</Overlay>
			</div>
		</div>
	</section>
</template>

<style scoped>
@media (max-width: 1023px) {
	.expiry-phone-card {
		display: grid;
		gap: 6px;
		padding: 10px;
	}
	.expiry-phone-identity {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr);
		align-items: center;
		gap: 9px;
	}
	.expiry-phone-identity .browse-group-thumbnail {
		grid-row: 1 / span 2;
		width: 40px;
		height: 40px;
	}
	.expiry-phone-identity > .browse-row-link {
		grid-column: 2;
		min-height: 0;
		padding: 0;
	}
	.expiry-phone-identity > .browse-row-link strong {
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.expiry-phone-identity > .browse-row-link small {
		display: block;
		color: var(--p-muted);
	}
	.expiry-phone-batch {
		justify-self: start;
		min-height: 32px;
		padding: 0;
		font-size: 0.84rem;
	}
	.expiry-phone-meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 10px;
		font-size: 0.84rem;
	}
	.expiry-phone-meta small {
		color: var(--p-muted);
	}
}
</style>
