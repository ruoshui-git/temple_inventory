<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import InventoryFilterPanel, {
	type ExpiryFilter,
	type InventoryFilterNode,
	type InventoryFilterState,
} from "./InventoryFilterPanel.vue";
import InventoryItemDetails from "./InventoryItemDetails.vue";
import {
	attentionBatchCount,
	batches,
	categories,
	daysFromFixtureDate,
	destinations,
	expiryStatus,
	items,
	matchesExpiry,
	photoOffsets,
	warehouses,
	type InventoryBatchRow,
	type InventoryItem,
} from "./fixtures";
import referenceImage from "../../../../docs/ui/explorations/inventory-redesign-reference-desktop.png";

type InventoryPage = "list" | "expiry";
type ItemSortKey = "default" | "name" | "code" | "available" | "total" | "loaned" | "damaged";
type BatchSortKey = "default" | "name" | "expiry" | "quantity";

const props = withDefaults(
	defineProps<{
		mobile?: boolean;
		initiallyScrolled?: boolean;
		initialPage?: InventoryPage;
		initialSearch?: string;
		initialView?: "card" | "table";
	}>(),
	{
		mobile: false,
		initiallyScrolled: false,
		initialPage: "list",
		initialSearch: "",
		initialView: undefined,
	},
);

const page = ref<InventoryPage>(props.initialPage);
const inventoryExpanded = ref(true);
const search = ref(props.initialSearch);
const selectedWarehouses = ref<string[]>(props.initiallyScrolled ? ["hall"] : []);
const selectedCategories = ref<string[]>([]);
const listInStock = ref(true);
const listExpiry = ref<ExpiryFilter>("all");
const expiryInStock = ref(true);
const batchExpiry = ref<ExpiryFilter>("attention");
const itemSort = ref<ItemSortKey>("default");
const itemSortDirection = ref<"asc" | "desc">("asc");
const batchSort = ref<BatchSortKey>("expiry");
const batchSortDirection = ref<"asc" | "desc">("asc");
const listView = ref<"card" | "table">(props.initialView || (props.mobile ? "card" : "table"));
const batchView = ref<"card" | "table">(props.initialView || (props.mobile ? "card" : "table"));
const compact = ref(props.initiallyScrolled);
const filterOpen = ref(false);
const limit = ref(props.initiallyScrolled ? 36 : 20);
const results = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
const filterDialog = ref<HTMLDialogElement>();
const previewDialog = ref<HTMLDialogElement>();
const previewTitle = ref("");
const previewPath = ref("");
const selectedItem = ref<InventoryItem>();
const scanValue = ref("");
const scanError = ref("");
let observer: IntersectionObserver | undefined;

const preferenceKey = (target: InventoryPage) =>
	`ti:exploration:inventory:${target}:${props.mobile ? "mobile" : "desktop"}:${props.initiallyScrolled ? "scrolled" : "initial"}`;
const warehouseLabel = (name: string) => warehousePresentation(name, warehouses).breadcrumb;
const categoryMap = new Map(
	categories.map((node) => [
		node.name,
		{
			name: node.name,
			label: node.item_group_name,
			parent: node.parent_item_group,
			isGroup: Boolean(node.is_group),
		},
	]),
);
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

function matchesWarehouse(item: InventoryItem, selected: string) {
	return item.locations.some((location) => {
		let node = warehouses.find((row) => row.name === location);
		while (node) {
			if (node.name === selected) return true;
			node = warehouses.find((row) => row.name === node?.parent_warehouse);
		}
		return false;
	});
}
function matchesCategory(category: string, selected: string) {
	let node = categoryMap.get(category);
	while (node) {
		if (node.name === selected) return true;
		node = node.parent ? categoryMap.get(node.parent) : undefined;
	}
	return false;
}
function matchesShared(item: InventoryItem) {
	return (
		(!selectedCategories.value.length ||
			selectedCategories.value.some((name) => matchesCategory(item.category, name))) &&
		(!selectedWarehouses.value.length ||
			selectedWarehouses.value.some((name) => matchesWarehouse(item, name)))
	);
}
function matchesItemSearch(item: InventoryItem, query: string) {
	return `${item.code} ${item.name} ${item.subtitle}`.toLocaleLowerCase().includes(query);
}
function matchesItemExpiry(item: InventoryItem, filter: ExpiryFilter) {
	if (filter === "all") return true;
	if (filter === "none")
		return !item.batches.length || item.batches.some((batch) => !batch.expiry);
	return item.batches.some((batch) => matchesExpiry(batch.expiry, filter));
}

const filteredItems = computed(() => {
	const query = search.value.trim().toLocaleLowerCase();
	const found = items.filter(
		(item) =>
			(!query || matchesItemSearch(item, query)) &&
			(!listInStock.value || item.total > 0) &&
			matchesShared(item) &&
			matchesItemExpiry(item, listExpiry.value),
	);
	if (itemSort.value !== "default") {
		const key = itemSort.value;
		const direction = itemSortDirection.value === "asc" ? 1 : -1;
		found.sort((a, b) => {
			if (key === "name" || key === "code")
				return direction * a[key].localeCompare(b[key], "zh-CN");
			return direction * (a[key] - b[key]);
		});
	}
	return found;
});

const filteredBatches = computed(() => {
	const query = search.value.trim().toLocaleLowerCase();
	const found = batches.filter(
		(batch) =>
			(!query ||
				matchesItemSearch(batch.item, query) ||
				batch.code.toLocaleLowerCase().includes(query)) &&
			(!expiryInStock.value || batch.quantity > 0) &&
			matchesShared(batch.item) &&
			matchesExpiry(batch.expiry, batchExpiry.value),
	);
	if (batchSort.value !== "default") {
		const key = batchSort.value;
		const direction = batchSortDirection.value === "asc" ? 1 : -1;
		found.sort((a, b) => {
			if (key === "name") return direction * a.item.name.localeCompare(b.item.name, "zh-CN");
			if (key === "expiry")
				return (
					direction * (a.expiry || "9999-12-31").localeCompare(b.expiry || "9999-12-31")
				);
			return direction * (a.quantity - b.quantity);
		});
	}
	return found;
});

const currentResults = computed(() =>
	page.value === "list" ? filteredItems.value : filteredBatches.value,
);
const shownItems = computed(() => filteredItems.value.slice(0, limit.value));
const storyCardRows = computed<InventoryCardRow[]>(() =>
	shownItems.value.map((item) => {
		const status = expiryStatus(item);
		return {
			item_code: item.code,
			item_name: item.name,
			item_group: item.category,
			image: cardImage(item),
			description: item.subtitle,
			available_stock: item.available,
			total_stock: item.total,
			on_loan_qty: item.loaned,
			damaged_qty: item.damaged,
			stock_uom: item.uom,
			warehouse_stock: Object.fromEntries(item.locations.map((location) => [location, 1])),
			has_batch_no: Boolean(item.batches.length),
			batch_count: item.batches.length,
			nearest_expiry_date: status?.date || null,
			nearest_expiry_days: daysFromFixtureDate(status?.date),
		};
	}),
);
const shownBatches = computed(() => filteredBatches.value.slice(0, limit.value));
const currentView = computed(() => (page.value === "list" ? listView.value : batchView.value));
const currentTitle = computed(() => (page.value === "list" ? "库存列表" : "效期批次"));
const currentUnit = computed(() => (page.value === "list" ? "件物品" : "个批次"));

const panelFilters = computed<InventoryFilterState>({
	get: () => ({
		warehouses: selectedWarehouses.value,
		categories: selectedCategories.value,
		inStock: page.value === "list" ? listInStock.value : expiryInStock.value,
		expiry: page.value === "list" ? listExpiry.value : batchExpiry.value,
	}),
	set: (value) => {
		selectedWarehouses.value = value.warehouses;
		selectedCategories.value = value.categories;
		if (page.value === "list") {
			listInStock.value = value.inStock;
			listExpiry.value = value.expiry;
		} else {
			expiryInStock.value = value.inStock;
			batchExpiry.value = value.expiry;
		}
	},
});

const warehouseNodes = computed<InventoryFilterNode[]>(() =>
	warehouses.map((node) => ({
		name: node.name,
		label: node.local_label || node.warehouse_name || node.name,
		parent: node.parent_warehouse,
		isGroup: Boolean(node.is_group),
		count: items.filter((item) => matchesWarehouse(item, node.name)).length,
	})),
);
const categoryNodes = computed<InventoryFilterNode[]>(() =>
	categories.map((node) => ({
		name: node.name,
		label: node.item_group_name,
		parent: node.parent_item_group,
		isGroup: Boolean(node.is_group),
		count: items.filter((item) => matchesCategory(item.category, node.name)).length,
	})),
);
const expiryLabels: Record<ExpiryFilter, string> = {
	attention: "效期：需关注",
	all: "",
	expired: "效期：已过期",
	"30": "效期：30 天内",
	"90": "效期：90 天内",
	"180": "效期：180 天内",
	none: "效期：无效期",
};
const activeCount = computed(
	() =>
		panelFilters.value.warehouses.length +
		panelFilters.value.categories.length +
		Number(panelFilters.value.inStock) +
		Number(panelFilters.value.expiry !== "all"),
);
const chips = computed(() => [
	...selectedWarehouses.value.map((value) => ({
		key: "warehouse",
		value,
		label: warehouseLabel(value),
	})),
	...selectedCategories.value.map((value) => ({
		key: "category",
		value,
		label: categoryMap.get(value)?.label || value,
	})),
	...(panelFilters.value.inStock ? [{ key: "stock", value: "", label: "有库存" }] : []),
	...(panelFilters.value.expiry !== "all"
		? [{ key: "expiry", value: "", label: expiryLabels[panelFilters.value.expiry] }]
		: []),
]);
const metrics = computed(() =>
	(
		[
			{ key: "available", label: "可用", icon: "box" },
			{ key: "total", label: "总计", icon: "box" },
			{ key: "loaned", label: "借出", icon: "loan" },
			{ key: "damaged", label: "损坏", icon: "warning" },
		] as const
	).map((metric) => {
		const totals = new Map<string, number>();
		for (const item of filteredItems.value)
			totals.set(item.uom, (totals.get(item.uom) || 0) + item[metric.key]);
		return {
			...metric,
			overall: [...totals.values()].reduce((sum, quantity) => sum + quantity, 0),
			totals: [...totals].map(([uom, qty]) => ({ uom, qty })),
		};
	}),
);

function toggleInventoryNavigation() {
	if (inventoryExpanded.value) {
		inventoryExpanded.value = false;
		return;
	}
	setPage("list");
}
function setPage(value: InventoryPage) {
	page.value = value;
	inventoryExpanded.value = true;
	filterOpen.value = false;
	filterDialog.value?.close();
	limit.value = 20;
	compact.value = false;
	results.value?.scrollTo({ top: 0 });
}
function openFilters() {
	if (props.mobile) filterDialog.value?.showModal();
	else filterOpen.value = !filterOpen.value;
}
function clearFilters() {
	search.value = "";
	panelFilters.value = { warehouses: [], categories: [], inStock: false, expiry: "all" };
}
function removeChip(key: string, value: string) {
	if (key === "warehouse")
		selectedWarehouses.value = selectedWarehouses.value.filter((name) => name !== value);
	if (key === "category")
		selectedCategories.value = selectedCategories.value.filter((name) => name !== value);
	if (key === "stock") panelFilters.value = { ...panelFilters.value, inStock: false };
	if (key === "expiry") panelFilters.value = { ...panelFilters.value, expiry: "all" };
}
function setView(value: "card" | "table") {
	if (page.value === "list") listView.value = value;
	else batchView.value = value;
	try {
		localStorage.setItem(preferenceKey(page.value), value);
	} catch {
		/* Optional storage. */
	}
}
function toggleItemSort(key: Exclude<ItemSortKey, "default">) {
	if (itemSort.value === key)
		itemSortDirection.value = itemSortDirection.value === "asc" ? "desc" : "asc";
	else {
		itemSort.value = key;
		itemSortDirection.value = key === "name" || key === "code" ? "asc" : "desc";
	}
}
function toggleBatchSort(key: Exclude<BatchSortKey, "default">) {
	if (batchSort.value === key)
		batchSortDirection.value = batchSortDirection.value === "asc" ? "desc" : "asc";
	else {
		batchSort.value = key;
		batchSortDirection.value = key === "quantity" ? "desc" : "asc";
	}
}
function sortIndicator(key: string) {
	const active = page.value === "list" ? itemSort.value === key : batchSort.value === key;
	if (!active) return "↕";
	return (page.value === "list" ? itemSortDirection.value : batchSortDirection.value) === "asc"
		? "↑"
		: "↓";
}
function sortLabel(label: string, key: string) {
	const active = page.value === "list" ? itemSort.value === key : batchSort.value === key;
	const direction = page.value === "list" ? itemSortDirection.value : batchSortDirection.value;
	return active ? `按${label}${direction === "asc" ? "降序" : "升序"}排序` : `按${label}排序`;
}
function preview(title: string, path = "", item?: InventoryItem) {
	previewTitle.value = title;
	previewPath.value = path;
	selectedItem.value = item;
	scanValue.value = search.value;
	scanError.value = "";
	previewDialog.value?.showModal();
}
function submitScan() {
	const value = scanValue.value.trim().toLowerCase();
	const batch = batches.find((row) => row.code.toLowerCase() === value);
	const item = batch?.item || items.find((row) => row.code.toLowerCase() === value);
	if (!item) {
		scanError.value = "样例中未找到该编码，请试用 ITM-000161。";
		return;
	}
	if (batch) {
		setPage("expiry");
		search.value = batch.code;
	}
	previewTitle.value = item.name;
	selectedItem.value = item;
	previewPath.value = `/item/${item.code}`;
}
function onScroll() {
	compact.value = (results.value?.scrollTop || 0) > 80;
}
function thumbnail(item: InventoryItem) {
	return item.photo === null
		? {}
		: {
				backgroundImage: `url(${referenceImage})`,
				backgroundPosition: `-398px -${photoOffsets[item.photo]}px`,
			};
}
function cardImage(item: InventoryItem) {
	return item.photo === null ? undefined : cardImages[item.photo];
}
function expiryText(batch: InventoryBatchRow) {
	const days = daysFromFixtureDate(batch.expiry);
	if (days === null) return "无效期";
	if (days < 0) return `已过期 ${Math.abs(days)} 天`;
	if (days === 0) return "今天到期";
	return `${days} 天后`;
}

watch(
	[
		search,
		selectedWarehouses,
		selectedCategories,
		listInStock,
		listExpiry,
		expiryInStock,
		batchExpiry,
		itemSort,
		itemSortDirection,
		batchSort,
		batchSortDirection,
	],
	() => {
		limit.value = 20;
		results.value?.scrollTo({ top: 0 });
		compact.value = false;
	},
	{ deep: true },
);
onMounted(async () => {
	try {
		for (const target of ["list", "expiry"] as InventoryPage[]) {
			if (target === props.initialPage && props.initialView) continue;
			const saved = localStorage.getItem(preferenceKey(target));
			if (saved === "card" || saved === "table") {
				if (target === "list") listView.value = saved;
				else batchView.value = saved;
			}
		}
	} catch {
		/* Optional storage. */
	}
	await nextTick();
	if (props.initiallyScrolled && results.value)
		results.value.scrollTop = props.mobile ? 800 : 560;
	observer = new IntersectionObserver(
		(entries) => {
			if (entries.some((entry) => entry.isIntersecting))
				limit.value = Math.min(limit.value + 16, currentResults.value.length);
		},
		{ root: results.value, rootMargin: "180px" },
	);
	if (sentinel.value) observer.observe(sentinel.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
	<div class="inventory-exploration" :class="{ 'mobile-frame': mobile }">
		<div class="exploration-layout" :class="{ compact, 'filters-open': filterOpen }">
			<aside class="exploration-sidebar">
				<div class="exploration-brand">
					<span><ExplorationIcon name="box" /></span><b>寺院物资</b>
				</div>
				<nav aria-label="主导航" class="module-navigation">
					<button
						class="module-parent active"
						aria-current="page"
						:aria-expanded="inventoryExpanded"
						@click="toggleInventoryNavigation"
					>
						<ExplorationIcon name="box" /><span>库存</span
						><span
							class="module-chevron"
							:class="{ expanded: inventoryExpanded }"
							aria-hidden="true"
						></span>
					</button>
					<div v-if="inventoryExpanded" class="module-children">
						<button
							class="module-child"
							:aria-current="page === 'list' ? 'page' : undefined"
							@click="setPage('list')"
						>
							库存列表
						</button>
						<button
							class="module-child"
							:aria-current="page === 'expiry' ? 'page' : undefined"
							@click="setPage('expiry')"
						>
							效期批次 <span class="nav-badge">{{ attentionBatchCount }}</span>
						</button>
					</div>
					<a
						v-for="destination in destinations.slice(1)"
						:key="destination.path"
						:href="destination.path"
						@click.prevent="preview(destination.label, destination.path)"
						><ExplorationIcon :name="destination.icon" />{{ destination.label }}</a
					>
				</nav>
				<div class="sidebar-user">
					<span>林</span>
					<div>林管理员<small>物资管理</small></div>
				</div>
			</aside>

			<aside
				v-if="filterOpen"
				id="inventory-filter-panel"
				class="desktop-filter-sidebar"
				aria-label="筛选库存"
			>
				<div class="filter-sidebar-heading">
					<div>
						<small>缩小{{ currentTitle }}范围</small>
						<h2>筛选</h2>
					</div>
					<button aria-label="关闭筛选" @click="filterOpen = false">×</button>
				</div>
				<InventoryFilterPanel
					v-model="panelFilters"
					:warehouses="warehouseNodes"
					:categories="categoryNodes"
					:expiry-primary="page === 'expiry'"
				/>
			</aside>

			<main class="exploration-main">
				<header class="exploration-header">
					<div class="heading-line">
						<h1>{{ currentTitle }}</h1>
						<span class="heading-count"
							>{{ currentResults.length }} {{ currentUnit }}</span
						>
						<div class="heading-actions">
							<button @click="preview('入库', '/new/Receive')">↓ 入库</button
							><button @click="preview('出库', '/new/Issue')">↑ 出库</button
							><button @click="preview('转移', '/new/Transfer')">⇄ 转移</button
							><button
								class="export-action"
								@click="
									preview(
										'快捷导出',
										page === 'list' ? '/inventory/export' : '/expiry/export',
									)
								"
							>
								<ExplorationIcon name="download" />导出</button
							><button class="accent" @click="preview('新建物品', '/items/new')">
								＋ 新建物品
							</button>
						</div>
						<button
							class="mobile-notifications"
							aria-label="通知，1 条未读"
							@click="preview('通知')"
						>
							<ExplorationIcon name="notice" /><span aria-hidden="true"></span>
						</button>
						<button
							class="mobile-actions"
							aria-label="物品操作"
							@click="preview('物品操作')"
						>
							<ExplorationIcon name="more" />
						</button>
					</div>
					<nav class="mobile-module-tabs" aria-label="库存页面">
						<button
							:aria-current="page === 'list' ? 'page' : undefined"
							@click="setPage('list')"
						>
							库存列表
						</button>
						<button
							:aria-current="page === 'expiry' ? 'page' : undefined"
							@click="setPage('expiry')"
						>
							效期批次 <span>{{ attentionBatchCount }}</span>
						</button>
					</nav>
					<div class="exploration-toolbar">
						<b class="compact-identity">{{ currentTitle }}</b>
						<label class="search-field"
							><ExplorationIcon name="search" /><input
								v-model="search"
								type="search"
								:aria-label="
									page === 'list' ? '搜索物品或条码' : '搜索物品、批次或条码'
								"
								:placeholder="
									page === 'list' ? '搜索物品或条码' : '搜索物品、批次或条码'
								"
						/></label>
						<button
							class="scan-action"
							aria-label="扫描条码"
							@click="preview('扫描条码')"
						>
							<ExplorationIcon name="scan" /><span>扫码</span>
						</button>
						<button
							class="filter-action"
							:aria-label="`筛选，${activeCount} 项已启用`"
							:aria-expanded="props.mobile ? undefined : filterOpen"
							:aria-controls="props.mobile ? undefined : 'inventory-filter-panel'"
							@click="openFilters"
						>
							<ExplorationIcon name="filter" /><span>筛选</span
							><b v-if="activeCount">{{ activeCount }}</b>
						</button>
					</div>
					<section
						v-if="page === 'list' && !compact"
						class="compact-summary"
						aria-label="全部筛选结果的数量汇总"
					>
						<div
							v-for="metric in metrics"
							:key="metric.key"
							class="summary-metric"
							:class="metric.key"
						>
							<ExplorationIcon :name="metric.icon" />
							<div>
								<div class="summary-heading">
									<span>{{ metric.label }}</span>
									<b
										v-if="metric.totals.length > 1"
										:aria-label="`跨单位合计 ${metric.overall.toLocaleString('zh-CN')}`"
										>{{ metric.overall.toLocaleString("zh-CN") }}</b
									>
								</div>
								<div class="summary-values">
									<span v-for="quantity in metric.totals" :key="quantity.uom"
										><b>{{ quantity.qty.toLocaleString("zh-CN") }}</b
										><small>{{ quantity.uom }}</small></span
									><span v-if="!metric.totals.length">—</span>
								</div>
							</div>
						</div>
					</section>
					<div class="filter-strip">
						<div class="chip-scroll">
							<button
								v-for="chip in chips"
								:key="chip.key + chip.value"
								:aria-label="`移除筛选：${chip.label}`"
								@click="removeChip(chip.key, chip.value)"
							>
								{{ chip.label }} <span aria-hidden="true">×</span>
							</button>
							<span v-if="!chips.length" class="no-filters"
								>全部仓库 · 全部类别 · 全部状态</span
							>
						</div>
						<button
							v-if="chips.length || search"
							class="clear-filters"
							@click="clearFilters"
						>
							清空全部
						</button>
					</div>
					<div class="result-controls">
						<span class="result-count" aria-live="polite"
							>共 {{ currentResults.length }} {{ currentUnit }}</span
						>
						<div
							class="view-switch"
							role="group"
							:aria-label="`${currentTitle}显示方式`"
						>
							<button
								:aria-pressed="currentView === 'table'"
								aria-label="表格"
								@click="setView('table')"
							>
								<ExplorationIcon name="table" /><span>表格</span>
							</button>
							<button
								:aria-pressed="currentView === 'card'"
								aria-label="卡片"
								@click="setView('card')"
							>
								<ExplorationIcon name="card" /><span>卡片</span>
							</button>
						</div>
					</div>
				</header>

				<div
					ref="results"
					class="exploration-results"
					tabindex="0"
					:aria-label="`${currentTitle}结果，可滚动`"
					@scroll.passive="onScroll"
				>
					<template v-if="page === 'list'">
						<table v-if="listView === 'table'" class="dense-table item-table">
							<thead>
								<tr>
									<th
										:aria-sort="
											itemSort === 'name'
												? itemSortDirection === 'asc'
													? 'ascending'
													: 'descending'
												: 'none'
										"
									>
										<button
											class="sort-header"
											:aria-label="sortLabel('物品', 'name')"
											@click="toggleItemSort('name')"
										>
											物品
											<span aria-hidden="true">{{
												sortIndicator("name")
											}}</span>
										</button>
									</th>
									<th
										:aria-sort="
											itemSort === 'code'
												? itemSortDirection === 'asc'
													? 'ascending'
													: 'descending'
												: 'none'
										"
									>
										<button
											class="sort-header"
											:aria-label="sortLabel('物品编码', 'code')"
											@click="toggleItemSort('code')"
										>
											物品编码 / 类别
											<span aria-hidden="true">{{
												sortIndicator("code")
											}}</span>
										</button>
									</th>
									<th
										class="numeric"
										:aria-sort="
											itemSort === 'available'
												? itemSortDirection === 'asc'
													? 'ascending'
													: 'descending'
												: 'none'
										"
									>
										<button
											class="sort-header"
											:aria-label="sortLabel('可用数量', 'available')"
											@click="toggleItemSort('available')"
										>
											可用数量
											<span aria-hidden="true">{{
												sortIndicator("available")
											}}</span>
										</button>
									</th>
									<th
										class="numeric"
										:aria-sort="
											itemSort === 'total'
												? itemSortDirection === 'asc'
													? 'ascending'
													: 'descending'
												: 'none'
										"
									>
										<button
											class="sort-header"
											:aria-label="sortLabel('总计', 'total')"
											@click="toggleItemSort('total')"
										>
											总计
											<span aria-hidden="true">{{
												sortIndicator("total")
											}}</span>
										</button>
									</th>
									<th
										class="numeric"
										:aria-sort="
											itemSort === 'loaned'
												? itemSortDirection === 'asc'
													? 'ascending'
													: 'descending'
												: 'none'
										"
									>
										<button
											class="sort-header"
											:aria-label="sortLabel('借出', 'loaned')"
											@click="toggleItemSort('loaned')"
										>
											借出
											<span aria-hidden="true">{{
												sortIndicator("loaned")
											}}</span>
										</button>
									</th>
									<th
										class="numeric"
										:aria-sort="
											itemSort === 'damaged'
												? itemSortDirection === 'asc'
													? 'ascending'
													: 'descending'
												: 'none'
										"
									>
										<button
											class="sort-header"
											:aria-label="sortLabel('损坏', 'damaged')"
											@click="toggleItemSort('damaged')"
										>
											损坏
											<span aria-hidden="true">{{
												sortIndicator("damaged")
											}}</span>
										</button>
									</th>
									<th>库位 / 批次信息</th>
									<th><span class="sr-only">查看</span></th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="item in shownItems" :key="item.code">
									<td>
										<div class="item-identity">
											<span
												class="item-photo"
												:style="thumbnail(item)"
												role="img"
												:aria-label="
													item.photo === null ? '暂无图片' : item.name
												"
												><ExplorationIcon
													v-if="item.photo === null"
													name="box" /></span
											><button
												class="item-link"
												@click="
													preview(item.name, `/item/${item.code}`, item)
												"
											>
												<b>{{ item.name }}</b
												><small>{{ item.subtitle }}</small>
											</button>
										</div>
									</td>
									<td class="item-code">
										{{ item.code }}<small>{{ item.category }}</small>
									</td>
									<td class="numeric available">
										<b>{{ item.available.toLocaleString("zh-CN") }}</b
										><small>{{ item.uom }}</small>
									</td>
									<td class="numeric">
										{{ item.total.toLocaleString("zh-CN") }}
										<small>{{ item.uom }}</small>
									</td>
									<td class="numeric" :class="{ loaned: item.loaned }">
										{{ item.loaned }} <small>{{ item.uom }}</small>
									</td>
									<td class="numeric" :class="{ damaged: item.damaged }">
										{{ item.damaged }} <small>{{ item.uom }}</small>
									</td>
									<td><InventoryItemDetails :item="item" /></td>
									<td>
										<button
											class="row-open"
											:aria-label="`查看 ${item.name}`"
											@click="preview(item.name, `/item/${item.code}`, item)"
										>
											›
										</button>
									</td>
								</tr>
							</tbody>
						</table>
						<InventoryCardGrid
							v-else
							:rows="storyCardRows"
							:warehouse-label="warehouseLabel"
							@activate="
								(row) => {
									const item = shownItems.find(
										(candidate) => candidate.code === row.item_code,
									);
									if (item) preview(item.name, `/item/${item.code}`, item);
								}
							"
						/>
					</template>

					<template v-else>
						<table v-if="batchView === 'table'" class="dense-table batch-table">
							<thead>
								<tr>
									<th
										:aria-sort="
											batchSort === 'name'
												? batchSortDirection === 'asc'
													? 'ascending'
													: 'descending'
												: 'none'
										"
									>
										<button
											class="sort-header"
											:aria-label="sortLabel('物品', 'name')"
											@click="toggleBatchSort('name')"
										>
											物品
											<span aria-hidden="true">{{
												sortIndicator("name")
											}}</span>
										</button>
									</th>
									<th>批次</th>
									<th>类别</th>
									<th
										:aria-sort="
											batchSort === 'expiry'
												? batchSortDirection === 'asc'
													? 'ascending'
													: 'descending'
												: 'none'
										"
									>
										<button
											class="sort-header"
											:aria-label="sortLabel('效期', 'expiry')"
											@click="toggleBatchSort('expiry')"
										>
											效期
											<span aria-hidden="true">{{
												sortIndicator("expiry")
											}}</span>
										</button>
									</th>
									<th
										class="numeric"
										:aria-sort="
											batchSort === 'quantity'
												? batchSortDirection === 'asc'
													? 'ascending'
													: 'descending'
												: 'none'
										"
									>
										<button
											class="sort-header"
											:aria-label="sortLabel('数量', 'quantity')"
											@click="toggleBatchSort('quantity')"
										>
											数量
											<span aria-hidden="true">{{
												sortIndicator("quantity")
											}}</span>
										</button>
									</th>
									<th>仓库 / 位置</th>
									<th><span class="sr-only">查看</span></th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="batch in shownBatches"
									:key="batch.code"
									:class="{
										'expired-row':
											(daysFromFixtureDate(batch.expiry) ?? 0) < 0,
									}"
								>
									<td>
										<div class="item-identity">
											<span
												class="item-photo"
												:style="thumbnail(batch.item)"
												role="img"
												:aria-label="batch.item.name"
												><ExplorationIcon
													v-if="batch.item.photo === null"
													name="box" /></span
											><button
												class="item-link"
												@click="
													preview(
														batch.item.name,
														`/item/${batch.item.code}`,
														batch.item,
													)
												"
											>
												<b>{{ batch.item.name }}</b
												><small>{{ batch.item.code }}</small>
											</button>
										</div>
									</td>
									<td class="batch-code">{{ batch.code }}</td>
									<td>{{ batch.item.category }}</td>
									<td>
										<b
											:class="{
												damaged:
													(daysFromFixtureDate(batch.expiry) ?? 0) < 0,
												loaned:
													(daysFromFixtureDate(batch.expiry) ?? 9999) <=
														30 &&
													(daysFromFixtureDate(batch.expiry) ?? -1) >= 0,
											}"
											>{{ batch.expiry || "无效期" }}</b
										><small class="expiry-relative">{{
											expiryText(batch)
										}}</small>
									</td>
									<td class="numeric available">
										<b>{{ batch.quantity.toLocaleString("zh-CN") }}</b
										><small>{{ batch.item.uom }}</small>
									</td>
									<td>
										<span
											v-for="location in batch.item.locations"
											:key="location"
											class="batch-location"
											>{{ warehouseLabel(location) }}</span
										>
									</td>
									<td>
										<button
											class="row-open"
											:aria-label="`查看批次 ${batch.code}`"
											@click="
												preview(
													batch.item.name,
													`/item/${batch.item.code}?batch=${batch.code}`,
													batch.item,
												)
											"
										>
											›
										</button>
									</td>
								</tr>
							</tbody>
						</table>
						<div
							v-else
							class="inventory-card-grid batch-card-grid"
							role="list"
							aria-label="效期批次卡片"
						>
							<article
								v-for="batch in shownBatches"
								:key="batch.code"
								class="inventory-visual-card batch-visual-card"
								role="listitem"
							>
								<button
									class="inventory-card-image"
									:aria-label="`查看 ${batch.item.name}，批次 ${batch.code}`"
									@click="
										preview(
											batch.item.name,
											`/item/${batch.item.code}?batch=${batch.code}`,
											batch.item,
										)
									"
								>
									<img
										v-if="cardImage(batch.item)"
										:src="cardImage(batch.item)"
										:alt="batch.item.name"
										loading="lazy"
										decoding="async"
									/>
									<span v-else class="inventory-card-placeholder">
										<ExplorationIcon name="box" /><small>暂无图片</small>
									</span>
								</button>
								<div class="inventory-card-body">
									<div class="inventory-card-primary">
										<button
											class="inventory-card-name"
											@click="
												preview(
													batch.item.name,
													`/item/${batch.item.code}?batch=${batch.code}`,
													batch.item,
												)
											"
										>
											{{ batch.item.name }}
										</button>
										<div class="inventory-card-available batch-card-available">
											<small>批次数量</small>
											<span
												><strong>{{
													batch.quantity.toLocaleString("zh-CN")
												}}</strong
												><small>{{ batch.item.uom }}</small></span
											>
										</div>
									</div>
									<p class="inventory-card-code">
										{{ batch.item.code }} · {{ batch.item.category }}
									</p>
									<div class="batch-card-chips">
										<span>批次 {{ batch.code }}</span>
										<span>{{ batch.item.locations.length }} 个库位</span>
										<span
											class="batch-expiry-chip"
											:class="{
												expired:
													(daysFromFixtureDate(batch.expiry) ?? 0) < 0,
												attention:
													(daysFromFixtureDate(batch.expiry) ?? 9999) <=
														30 &&
													(daysFromFixtureDate(batch.expiry) ?? -1) >= 0,
											}"
											>{{ expiryText(batch) }}</span
										>
									</div>
									<p class="inventory-card-expiry batch-card-expiry">
										{{ batch.expiry ? `效期 ${batch.expiry}` : "无效期" }}
									</p>
								</div>
							</article>
						</div>
					</template>

					<div v-if="!currentResults.length" class="exploration-empty">
						<ExplorationIcon name="search" />
						<h2>暂无符合条件的{{ currentUnit }}</h2>
						<p>试试其他名称、编码或筛选条件。</p>
						<button @click="clearFilters">清空全部筛选</button>
					</div>
					<div ref="sentinel" class="scroll-sentinel" role="status">
						{{
							(page === "list" ? shownItems.length : shownBatches.length) <
							currentResults.length
								? `已显示 ${page === "list" ? shownItems.length : shownBatches.length} / ${currentResults.length} ${currentUnit} · 向下滚动继续浏览`
								: `已显示全部 ${currentResults.length} ${currentUnit}`
						}}
					</div>
				</div>

				<nav class="exploration-bottom-nav" aria-label="移动主导航">
					<a
						v-for="destination in destinations"
						:key="destination.path"
						:href="destination.path"
						:aria-current="destination.path === '/' ? 'page' : undefined"
						@click.prevent="
							destination.path === '/'
								? setPage('list')
								: preview(destination.label, destination.path)
						"
						><ExplorationIcon :name="destination.icon" /><span>{{
							destination.label
						}}</span></a
					>
				</nav>
			</main>

			<dialog
				ref="filterDialog"
				class="exploration-dialog filter-dialog"
				@click="$event.target === filterDialog && filterDialog?.close()"
			>
				<div class="dialog-heading">
					<h2>筛选{{ currentTitle }}</h2>
					<button aria-label="关闭筛选" @click="filterDialog?.close()">×</button>
				</div>
				<InventoryFilterPanel
					v-model="panelFilters"
					:warehouses="warehouseNodes"
					:categories="categoryNodes"
					:expiry-primary="page === 'expiry'"
				/>
				<div class="dialog-footer">
					<button @click="clearFilters">清空全部</button
					><button class="accent" @click="filterDialog?.close()">
						查看 {{ currentResults.length }} {{ currentUnit }}
					</button>
				</div>
			</dialog>

			<dialog
				ref="previewDialog"
				class="exploration-dialog"
				@click="$event.target === previewDialog && previewDialog?.close()"
			>
				<div class="dialog-heading">
					<h2>{{ previewTitle }}</h2>
					<button aria-label="关闭预览" @click="previewDialog?.close()">×</button>
				</div>
				<template v-if="previewTitle === '扫描条码'"
					><div class="scan-placeholder">
						<ExplorationIcon name="scan" />
						<p>扫码交互预览</p>
					</div>
					<p>使用样例物品或批次编码模拟扫描结果，也可手动输入。</p>
					<form @submit.prevent="submitScan">
						<label
							>物品或批次编码<input
								v-model="scanValue"
								placeholder="ITM-000161"
								autofocus
						/></label>
						<p v-if="scanError" role="alert">{{ scanError }}</p>
						<button class="accent">查询样例</button>
					</form></template
				>
				<template v-else-if="selectedItem"
					><p>{{ selectedItem.code }} · {{ selectedItem.category }}</p>
					<p class="available">
						可用
						<b
							>{{ selectedItem.available.toLocaleString("zh-CN") }}
							{{ selectedItem.uom }}</b
						>
					</p>
					<p>
						总计 {{ selectedItem.total }} · 借出 {{ selectedItem.loaned }} · 损坏
						{{ selectedItem.damaged }} {{ selectedItem.uom }}
					</p>
					<h3>仓库 / 位置</h3>
					<p v-for="location in selectedItem.locations" :key="location">
						{{ warehouseLabel(location) }}
					</p>
					<h3 v-if="selectedItem.batches.length">批次</h3>
					<p v-for="batch in selectedItem.batches" :key="batch.code">
						{{ batch.code }} · {{ batch.quantity }} {{ selectedItem.uom }}<br />{{
							batch.expiry || "无效期"
						}}
					</p></template
				>
				<template v-else-if="previewTitle === '物品操作'"
					><div class="dialog-operations">
						<button
							v-for="action in [
								{ label: '入库', path: '/new/Receive' },
								{ label: '出库', path: '/new/Issue' },
								{ label: '转移', path: '/new/Transfer' },
								{ label: '新建物品', path: '/items/new' },
							]"
							:key="action.path"
							@click="
								previewTitle = action.label;
								previewPath = action.path;
							"
						>
							{{ action.label }}
						</button>
					</div></template
				>
				<template v-else
					><p>此入口沿用现有应用的「{{ previewTitle }}」功能。</p>
					<p>本次仅预览库存布局，未连接操作流程。</p></template
				>
				<small class="preview-note"
					>Storybook 静态预览<span v-if="previewPath"> · {{ previewPath }}</span></small
				>
			</dialog>
		</div>
	</div>
</template>
<style scoped src="./inventory-redesign.css"></style>
