<script setup lang="ts">
import { computed, ref } from "vue";
import ActiveFilterChips, { type FilterChip } from "../../components/ActiveFilterChips.vue";
import InventoryCardGrid from "../../components/InventoryCardGrid.vue";
import type { InventoryCardRow } from "../../lib/inventoryTypes";
import { warehousePresentation } from "../../lib/warehousePresenter";
import cardBatteries from "./assets/card-batteries.png";
import cardCamera from "./assets/card-camera.png";
import cardGarbageBags from "./assets/card-garbage-bags.png";
import cardHeatMat from "./assets/card-heat-mat.png";
import cardInhaler from "./assets/card-inhaler.png";
import cardMask from "./assets/card-mask.png";
import cardThermos from "./assets/card-thermos.png";
import cardTissues from "./assets/card-tissues.png";
import cardTray from "./assets/card-tray.png";
import ExplorationIcon from "./ExplorationIcon.vue";
import {
	batches,
	categories,
	daysFromFixtureDate,
	destinations,
	expiryStatus,
	items,
	warehouses,
	type InventoryBatchRow,
	type InventoryItem,
} from "./fixtures";
import InventoryFilterPanel, {
	type ExpiryFilter,
	type InventoryFilterNode,
	type InventoryFilterState,
} from "./InventoryFilterPanel.vue";
import MobileExpiryList from "./MobileExpiryList.vue";
import MobileInventoryList from "./MobileInventoryList.vue";
import MobileInventorySummary, { type MobileSummaryMetric } from "./MobileInventorySummary.vue";
import "./mobile-inventory-redesign.css";

type MobilePage = "inventory" | "expiry";
type InventoryView = "card" | "list";
type ExpiryCategory = "all" | "soon" | "expired";

const props = withDefaults(
	defineProps<{
		initialPage?: MobilePage;
		initialView?: InventoryView;
		initialSummaryKey?: string;
		initialExpiryCategory?: ExpiryCategory;
		initialActiveFilters?: boolean;
		initiallyScrolled?: boolean;
	}>(),
	{
		initialPage: "inventory",
		initialView: "card",
		initialSummaryKey: "",
		initialExpiryCategory: "all",
		initialActiveFilters: false,
		initiallyScrolled: false,
	},
);

const page = ref<MobilePage>(props.initialPage);
const view = ref<InventoryView>(props.initialView);
const expandedSummary = ref(props.initialSummaryKey);
const expiryCategory = ref<ExpiryCategory>(props.initialExpiryCategory);
const search = ref("");
const filterOpen = ref(false);
const previewTitle = ref("");
const selectedWarehouses = ref<string[]>(props.initialActiveFilters ? ["hall"] : []);
const selectedCategories = ref<string[]>(props.initialActiveFilters ? ["医疗防护"] : []);
const inStock = ref(true);

const cardImages: Partial<Record<number, string>> = {
	0: cardInhaler,
	1: cardCamera,
	2: cardMask,
	3: cardTray,
	4: cardHeatMat,
	6: cardBatteries,
	7: cardThermos,
	9: cardGarbageBags,
	14: cardTissues,
};
const imageFor = (item: InventoryItem) =>
	item.photo == null ? undefined : cardImages[item.photo];
const warehouseLabel = (name: string) => warehousePresentation(name, warehouses).breadcrumb;
const locationFor = (item: InventoryItem) => warehouseLabel(item.locations[0] || "root");

const warehouseNodes = computed<InventoryFilterNode[]>(() =>
	warehouses.map((node) => ({
		name: node.name,
		label: node.local_label || node.warehouse_name || node.name,
		parent: node.parent_warehouse,
		isGroup: Boolean(node.is_group),
		count: items.filter((item) => item.locations.includes(node.name)).length,
	})),
);
const categoryNodes = computed<InventoryFilterNode[]>(() =>
	categories.map((node) => ({
		name: node.name,
		label: node.item_group_name,
		parent: node.parent_item_group,
		isGroup: Boolean(node.is_group),
		count: items.filter((item) => item.category === node.name).length,
	})),
);
const panelFilters = computed<InventoryFilterState>({
	get: () => ({
		warehouses: selectedWarehouses.value,
		categories: selectedCategories.value,
		inStock: inStock.value,
		expiry: "all" as ExpiryFilter,
	}),
	set: (value) => {
		selectedWarehouses.value = value.warehouses;
		selectedCategories.value = value.categories;
		inStock.value = value.inStock;
	},
});

function itemMatchesWarehouse(item: InventoryItem, selected: string) {
	return item.locations.some((location) => {
		let node = warehouses.find((row) => row.name === location);
		while (node) {
			if (node.name === selected) return true;
			node = warehouses.find((row) => row.name === node?.parent_warehouse);
		}
		return false;
	});
}
function matchesShared(item: InventoryItem) {
	const query = search.value.trim().toLocaleLowerCase();
	return (
		(!query || `${item.name} ${item.code}`.toLocaleLowerCase().includes(query)) &&
		(!inStock.value || item.total > 0) &&
		(!selectedWarehouses.value.length ||
			selectedWarehouses.value.some((name) => itemMatchesWarehouse(item, name))) &&
		(!selectedCategories.value.length || selectedCategories.value.includes(item.category))
	);
}

const inventoryResults = computed(() => items.slice(0, 48).filter(matchesShared));
const cardRows = computed<InventoryCardRow[]>(() =>
	inventoryResults.value.slice(0, props.initiallyScrolled ? 18 : 10).map((item) => {
		const status = expiryStatus(item);
		return {
			item_code: item.code,
			item_name: item.name,
			item_group: item.category,
			stock_uom: item.uom,
			image: imageFor(item),
			description: item.subtitle,
			available_stock: item.available,
			total_stock: item.total,
			on_loan_qty: item.loaned,
			damaged_qty: item.damaged,
			warehouse_stock: Object.fromEntries(item.locations.map((location) => [location, 1])),
			has_batch_no: Boolean(item.batches.length),
			batch_count: item.batches.length,
			nearest_expiry_date: status?.date || null,
			nearest_expiry_days: daysFromFixtureDate(status?.date),
		};
	}),
);

const datedBatches = computed(() =>
	batches.filter((batch) => batch.expiry && matchesShared(batch.item)),
);
const expiryResults = computed(() =>
	datedBatches.value.filter((batch) => {
		const days = daysFromFixtureDate(batch.expiry);
		if (expiryCategory.value === "soon") return days != null && days >= 0 && days <= 30;
		if (expiryCategory.value === "expired") return days != null && days < 0;
		return true;
	}),
);

const inventoryMetrics: MobileSummaryMetric[] = [
	{
		key: "available",
		label: "可用",
		overall: 42288,
		tone: "available",
		details: [
			{ label: "Nos", value: 4791, uom: "Nos" },
			{ label: "包", value: 36567, uom: "包" },
			{ label: "瓶", value: 930, uom: "瓶" },
		],
	},
	{
		key: "total",
		label: "总计",
		overall: 42843,
		tone: "total",
		details: [
			{ label: "Nos", value: 5002, uom: "Nos" },
			{ label: "包", value: 36811, uom: "包" },
			{ label: "瓶", value: 1030, uom: "瓶" },
		],
	},
	{
		key: "loaned",
		label: "借出",
		overall: 369,
		tone: "warning",
		details: [{ label: "Nos", value: 369, uom: "Nos" }],
	},
	{
		key: "damaged",
		label: "损坏",
		overall: 186,
		tone: "danger",
		details: [{ label: "Nos", value: 186, uom: "Nos" }],
	},
];
const soonCount = computed(
	() =>
		datedBatches.value.filter((batch) => {
			const days = daysFromFixtureDate(batch.expiry);
			return days != null && days >= 0 && days <= 30;
		}).length,
);
const expiredCount = computed(
	() =>
		datedBatches.value.filter((batch) => (daysFromFixtureDate(batch.expiry) ?? 0) < 0).length,
);
const expiryMetrics = computed<MobileSummaryMetric[]>(() => [
	{
		key: "soon",
		label: "即将到期",
		overall: soonCount.value,
		tone: "warning",
		details: [
			{
				label: "7 天内",
				value: datedBatches.value.filter((batch) => {
					const days = daysFromFixtureDate(batch.expiry);
					return days != null && days >= 0 && days <= 7;
				}).length,
			},
			{
				label: "8–30 天内",
				value: datedBatches.value.filter((batch) => {
					const days = daysFromFixtureDate(batch.expiry);
					return days != null && days >= 8 && days <= 30;
				}).length,
			},
		],
	},
	{
		key: "expired",
		label: "已过期",
		overall: expiredCount.value,
		tone: "danger",
		details: [{ label: "已过期批次", value: expiredCount.value }],
	},
]);

const chips = computed<FilterChip[]>(() => [
	...(inStock.value ? [{ key: "inStock", label: "有库存" }] : []),
	...selectedWarehouses.value.map((value) => ({
		key: "warehouse",
		value,
		label: warehouseLabel(value),
	})),
	...selectedCategories.value.map((value) => ({ key: "category", value, label: value })),
]);
const activeCount = computed(() => chips.value.length);
const currentCount = computed(() =>
	page.value === "inventory" ? inventoryResults.value.length : expiryResults.value.length,
);
const currentUnit = computed(() => (page.value === "inventory" ? "件物品" : "个批次"));

function selectSummary(key: string) {
	expandedSummary.value = expandedSummary.value === key ? "" : key;
}
function removeChip(chip: FilterChip) {
	if (chip.key === "inStock") inStock.value = false;
	if (chip.key === "warehouse")
		selectedWarehouses.value = selectedWarehouses.value.filter(
			(value) => value !== chip.value,
		);
	if (chip.key === "category")
		selectedCategories.value = selectedCategories.value.filter(
			(value) => value !== chip.value,
		);
}
function clearFilters() {
	selectedWarehouses.value = [];
	selectedCategories.value = [];
	inStock.value = false;
}
function setPage(value: MobilePage) {
	page.value = value;
	expandedSummary.value = "";
}
function preview(title: string) {
	previewTitle.value = title;
}
</script>

<template>
	<div class="mobile-inventory-exploration" :class="{ compact: initiallyScrolled }">
		<main>
			<header class="mobile-browse-header">
				<div v-if="!initiallyScrolled" class="mobile-title-row">
					<div>
						<h1>{{ page === "inventory" ? "库存列表" : "效期批次" }}</h1>
						<span>{{ currentCount }} {{ currentUnit }}</span>
					</div>
					<button type="button" aria-label="通知，1 条未读" @click="preview('通知')">
						<ExplorationIcon name="notice" />
					</button>
					<button type="button" aria-label="更多操作" @click="preview('更多操作')">
						<ExplorationIcon name="more" />
					</button>
				</div>
				<nav v-if="!initiallyScrolled" class="mobile-subnav" aria-label="库存页面">
					<button
						type="button"
						:aria-current="page === 'inventory' ? 'page' : undefined"
						@click="setPage('inventory')"
					>
						库存列表
					</button>
					<button
						type="button"
						:aria-current="page === 'expiry' ? 'page' : undefined"
						@click="setPage('expiry')"
					>
						效期批次 <span>{{ datedBatches.length }}</span>
					</button>
				</nav>
				<div class="mobile-search-actions" aria-label="浏览工具">
					<b v-if="initiallyScrolled" class="compact-page-title">{{
						page === "inventory" ? "库存列表" : "效期批次"
					}}</b>
					<label
						><ExplorationIcon name="search" /><input
							v-model="search"
							type="search"
							:aria-label="
								page === 'inventory' ? '搜索物品或条码' : '搜索物品或批次号'
							"
							:placeholder="
								page === 'inventory' ? '搜索物品或条码' : '搜索物品或批次号'
							"
					/></label>
					<button
						type="button"
						class="mobile-scan"
						aria-label="扫码"
						@click="preview('扫码')"
					>
						<ExplorationIcon name="scan" /><span>扫码</span>
					</button>
					<button
						type="button"
						class="mobile-filter"
						:aria-label="`筛选，${activeCount} 项已启用`"
						@click="filterOpen = true"
					>
						<ExplorationIcon name="filter" /><span>筛选</span
						><b v-if="activeCount">{{ activeCount }}</b>
					</button>
				</div>

				<MobileInventorySummary
					v-if="!initiallyScrolled && page === 'inventory'"
					:metrics="inventoryMetrics"
					:expanded-key="expandedSummary"
					@select="selectSummary"
				/>
				<MobileInventorySummary
					v-if="!initiallyScrolled && page === 'expiry'"
					:metrics="expiryMetrics"
					:expanded-key="expandedSummary"
					@select="selectSummary"
				/>

				<div
					v-if="page === 'expiry' && !initiallyScrolled"
					class="expiry-quick-filters"
					role="group"
					aria-label="效期状态"
				>
					<button
						v-for="option in [
							{ key: 'all', label: '全部', count: datedBatches.length },
							{ key: 'soon', label: '即将到期', count: soonCount },
							{ key: 'expired', label: '已过期', count: expiredCount },
						]"
						:key="option.key"
						type="button"
						:aria-pressed="expiryCategory === option.key"
						@click="expiryCategory = option.key as ExpiryCategory"
					>
						{{ option.label }} <span>{{ option.count }}</span>
					</button>
				</div>

				<ActiveFilterChips
					:chips="chips"
					:show-clear="false"
					@remove="removeChip"
					@clear="clearFilters"
				/>
				<div class="mobile-result-controls">
					<span aria-live="polite">共 {{ currentCount }} {{ currentUnit }}</span>
					<div v-if="page === 'inventory'" role="group" aria-label="库存显示方式">
						<button
							type="button"
							aria-label="列表"
							:aria-pressed="view === 'list'"
							@click="view = 'list'"
						>
							<ExplorationIcon name="table" />
						</button>
						<button
							type="button"
							aria-label="卡片"
							:aria-pressed="view === 'card'"
							@click="view = 'card'"
						>
							<ExplorationIcon name="card" />
						</button>
					</div>
				</div>
			</header>

			<section
				class="mobile-results"
				:aria-label="page === 'inventory' ? '库存结果' : '效期批次结果'"
			>
				<InventoryCardGrid
					v-if="page === 'inventory' && view === 'card'"
					:rows="cardRows"
					compact-mobile
					:warehouse-label="warehouseLabel"
					@activate="(row) => preview(row.item_name)"
				/>
				<MobileInventoryList
					v-else-if="page === 'inventory'"
					:rows="cardRows"
					@activate="(row) => preview(row.item_name)"
				/>
				<MobileExpiryList
					v-else
					:rows="expiryResults"
					:image-for="imageFor"
					:location-for="locationFor"
					@activate="
						(row: InventoryBatchRow) => preview(`${row.item.name} · ${row.code}`)
					"
				/>
			</section>
		</main>

		<nav class="mobile-bottom-nav" aria-label="移动主导航">
			<a
				v-for="destination in destinations"
				:key="destination.path"
				:href="destination.path"
				:aria-current="destination.path === '/' ? 'page' : undefined"
				@click.prevent="preview(destination.label)"
				><ExplorationIcon :name="destination.icon" />{{ destination.label }}</a
			>
		</nav>

		<dialog v-if="filterOpen" open class="mobile-filter-dialog" aria-modal="true">
			<div class="mobile-dialog-heading">
				<div>
					<small>库存浏览</small>
					<h2>筛选</h2>
				</div>
				<button type="button" aria-label="关闭筛选" @click="filterOpen = false">×</button>
			</div>
			<InventoryFilterPanel
				v-model="panelFilters"
				:warehouses="warehouseNodes"
				:categories="categoryNodes"
				:expiry-primary="page === 'expiry'"
			/>
			<div class="mobile-filter-footer">
				<button type="button" @click="clearFilters">清空全部</button
				><button type="button" class="apply" @click="filterOpen = false">
					查看 {{ currentCount }} 条结果
				</button>
			</div>
		</dialog>

		<dialog v-if="previewTitle" open class="mobile-preview-dialog">
			<h2>{{ previewTitle }}</h2>
			<p>Storybook 静态预览，不会调用生产接口。</p>
			<button type="button" @click="previewTitle = ''">关闭</button>
		</dialog>
	</div>
</template>
