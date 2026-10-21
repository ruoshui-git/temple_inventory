<script setup lang="ts">
import { siteDateTime } from "../../lib/nativeTime";
import { computed, ref, watch } from "vue";
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
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import Overlay from "../../components/ui/Overlay.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import ItemImage from "../../components/ItemImage.vue";
import StockDetails from "../../components/StockDetails.vue";
import QuickExport from "../../components/QuickExport.vue";
import Scanner from "../../components/Scanner.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import SortControl from "../../components/ui/SortControl.vue";
import DataTable from "../../components/ui/DataTable.vue";
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
	clear,
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
	{ value: "item_name", label: "物品名称" },
	{ value: "item_code", label: "物品编号" },
	{ value: "category", label: "类别" },
	{ value: "stock_uom", label: "库存单位" },
	{ value: "available", label: "可用数量" },
	{ value: "loaned", label: "借出数量" },
	{ value: "damaged", label: "损坏数量" },
];
const inventoryColumns: DataColumn[] = [
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
	{ id: "category", label: "类别", defaultVisible: true, sortable: true, minWidth: "130px" },
	{ id: "locations", label: "位置与批次", defaultVisible: true, minWidth: "210px" },
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
];
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
		.map(
			(key) =>
				`${key === "available" ? "可用" : key === "loaned" ? "借出" : "损坏"} ${row[key]}${row.stock_uom ? ` ${row.stock_uom}` : ""}`,
		);
	return quantity.join(" · ");
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
	const location = String(row.warehouse_label || row.warehouse || "");
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
	? useColumnPreferences(
			"stock.summary",
			computed(() => inventoryColumns),
			reference,
			services,
		)
	: undefined;
function setSelected(code: string, checked: boolean) {
	const isSelected = selected.value.includes(code);
	if (checked !== isSelected) props.controller.toggle(code);
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
			:summary="`库存 · ${data.snapshot ? data.total + ' 种' : '读取中'}${selected.length ? ' · 已选 ' + selected.length : ''}`"
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
			@sidebar="toggleFilters"
		>
			<template #subtitle
				><p class="muted">查看库存、找到位置，让下一次取用更从容。</p></template
			>
			<template #chips="{ editFilter }">
				<BrowseChip
					v-for="(group, index) in quickReportQuery.groupBy"
					:key="`group:${group}`"
					:label="`分组：${groupLabels[group] || group}`"
					@edit="editFilter()"
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
				<UiButton v-if="appliedChips.length || search" variant="ghost" @click="clear"
					>清空筛选</UiButton
				>
			</template>
			<template #filters>
				<div class="browse-filter-mega">
					<section>
						<h3>筛选</h3>
						<BrowseFilters
							v-model="scope"
							:fields="['item', 'categories', 'warehouses']"
							:hierarchy-in-rail="filtersOpen && !isMobile"
							hide-activity
						/><label class="preview-choice-label preview-check"
							><input type="checkbox" v-model="inStockOnly" />仅有库存</label
						>
					</section>
					<section>
						<h3>分组</h3>
						<GroupByFilter
							:dataset="quickReportQuery.dataset"
							:view="quickReportQuery.view"
							:model-value="quickReportQuery.groupBy"
							@update:model-value="setGroupBy"
						/>
					</section>
				</div>
			</template>
			<template #actions>
				<QuickExport
					:query="quickReportQuery"
					:active="active"
					@open-full="emit('openExport', $event)"
				/>
				<UiButton
					v-for="item in controller.actions.value"
					:key="item.kind"
					:icon="item.icon"
					variant="primary"
					@click="controller.action(item.name)"
					>{{ item.name }}</UiButton
				>
			</template>
			<div class="inventory-context"><slot name="context" /></div>
			<div class="result-tools">
				<div v-if="!isMobile" class="segmented" aria-label="库存显示方式">
					<button :aria-pressed="view === 'card'" @click="view = 'card'">
						<InventoryIcon name="card" />卡片
					</button>
					<button :aria-pressed="view === 'table'" @click="view = 'table'">
						<InventoryIcon name="table" />列表
					</button>
				</div>
				<SortControl
					v-model:field="sort"
					v-model:direction="sortDirection"
					:fields="sortFields"
					label="库存排序"
				/>
				<UiButton :disabled="!data.snapshot" @click="analysisOpen = true"
					>分析结果</UiButton
				>
			</div>
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
		<section class="surface inventory-surface">
			<p v-if="data.snapshot" class="browse-result-count">
				筛选结果：{{ data.total }} 种物品
			</p>
			<details v-if="data.snapshot" class="browse-summary-details">
				<summary>
					数量分析：{{
						metrics
							.slice(0, 2)
							.flatMap((metric) =>
								metric.quantities
									.slice(0, 1)
									.map(
										(quantity) =>
											`${metric.label} ${quantity.qty} ${quantity.uom}`,
									),
							)
							.join(" · ")
					}}
					· 查看完整分析
				</summary>
				<QuantitySummary :metrics="metrics" :loading="status === 'refresh'" />
			</details>
			<div class="inventory-body" :class="{ 'with-filters': filtersOpen && !isMobile }">
				<aside v-if="filtersOpen && !isMobile" class="browse-filter-rail">
					<h3>筛选库存</h3>
					<div class="browse-filter-dense">
						<BrowseFilters
							v-model="scope"
							:fields="['categories', 'warehouses']"
							hide-activity
						/>
					</div>
				</aside>
				<div
					ref="results"
					class="results-region"
					:aria-busy="status === 'loading' || status === 'refresh'"
				>
					<div v-if="status === 'loading'" class="empty-panel" role="status">
						<span class="spinner" />正在加载库存…
						<div class="skeleton" />
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
						<p v-if="status === 'refresh'" class="notice-bar" role="status">
							<span class="spinner" />正在更新，已有结果仍然保留。
						</p>
						<div
							v-if="isMobile || view === 'card'"
							class="stock-grid"
							:class="{ refreshing: status === 'refresh' }"
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

									<StockDetails :item="item" />
								</div>
							</article>
						</div>
						<DataTable
							data-browse-scroll="inventory-table"
							ariaLabel="库存物品"
							table-class="preview-table"
							:columns="inventoryColumns"
							:rows="browseTableRows"
							:column-preferences="tablePreferences"
							:row-key="stockSelectionKey"
							:selection-label="(row) => stockName(row)"
							:sort-by="sort"
							:sort-direction="sortDirection"
							selection-enabled
							:selected-keys="selected"
							:has-more="
								quickReportQuery.groupBy.length
									? groupPages.hasMore()
									: data.next !== null
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
									: data.loading && rows.length > 0
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
								/>
								<template v-else-if="column.id === 'locations'">{{
									stockLocationLabel(row)
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
									{{ groupSummary(group) }}
									<UiButton
										v-if="group.error"
										@click="groupPages.retry(group.id)"
										>重试</UiButton
									>
									<UiButton
										v-if="groupPages.hasMore(group.id)"
										:loading="group.loading"
										@click="groupPages.loadMore(group.id)"
										>加载更多此分组</UiButton
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
					@retry="load(false, true)"
				/>
				<p class="muted">统计完整筛选结果；跨位置的物品数不可相加。</p>
			</Overlay>
			<footer class="result-footer">
				<span v-if="data.stale" role="status">上次结果 · 尚未更新</span>
				<span v-if="data.error || data.moreError" role="alert"
					>{{ data.error || data.moreError }}
					<UiButton @click="load(!!data.moreError, true)">重试加载</UiButton></span
				>
				<UiButton
					v-else-if="data.next !== null && (isMobile || view === 'card')"
					:loading="data.loading"
					@click="load(true)"
					>加载更多</UiButton
				>
			</footer>
		</section>
		<ReturnToTop :active="active !== false" :hidden="isMobile && filtersOpen" />
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
