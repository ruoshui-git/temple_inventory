<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../lib/api";
import { warehousePresentation } from "../lib/warehousePresenter";
import type { InventoryCardRow } from "../lib/inventoryTypes";
import ItemImagePreview from "../components/ItemImagePreview.vue";
import SortableDataTable, { type SortState } from "../components/SortableDataTable.vue";
import Scanner from "../components/Scanner.vue";
import ActiveFilterChips from "../components/ActiveFilterChips.vue";
import MobileInventoryList from "../components/MobileInventoryList.vue";
import MobileInventorySummary, {
	type MobileSummaryMetric,
} from "../components/MobileInventorySummary.vue";
import OverflowActionMenu from "../components/OverflowActionMenu.vue";
import ResponsiveFilterPanel from "../components/ResponsiveFilterPanel.vue";
import QuantitySummary from "../components/QuantitySummary.vue";
import InventoryCardGrid from "../components/InventoryCardGrid.vue";
import ExportDialog from "../components/ExportDialog.vue";
import DetailPopover from "../components/DetailPopover.vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import InventoryFilterPanel, {
	type InventoryFilterNode,
	type InventoryFilterState,
} from "../components/InventoryFilterPanel.vue";
import { hydrateFilterQuery, serializeFilterQuery } from "../composables/filters";
import { toast } from "../lib/toast";

const route = useRoute(),
	router = useRouter();
const boot = ref<any>(),
	rows = ref<InventoryCardRow[]>([]),
	total = ref(0),
	overall = ref<number | null>(null),
	facetCounts = ref<any>({ warehouses: {}, item_groups: {} }),
	quantityTotals = ref<Record<string, Array<{ uom: string; qty: number }>>>({});
const error = ref(""),
	loading = ref(false),
	loadingMore = ref(false),
	desktopFilterOpen = ref(false),
	filterOpen = ref(false),
	exportOpen = ref(false);
const compact = ref(false);
const expandedSummary = ref("");
const selection = ref(false),
	selected = ref<string[]>([]),
	scanner = ref(false),
	scanBusy = ref(false),
	unknownBarcodePrompt = ref("");
const resultsScroll = ref<HTMLElement>(),
	mobileResultsScroll = ref<HTMLElement>(),
	sentinel = ref<HTMLElement>();
const mobileSentinel = ref<HTMLElement>();
const filterPanel = ref<InstanceType<typeof ResponsiveFilterPanel> | null>(null);
const start = ref(0);
const filters = ref({
	search: "",
	warehouses: [] as string[],
	item_groups: [] as string[],
	in_stock: true,
	expiry_window: "all",
	expiry_days: "30",
	expiry_from_days: "-30",
	expiry_to_days: "30",
});
const defaultSort: SortState = { sort_by: "item_name", sort_order: "asc" };
const sort = ref<SortState>({ ...defaultSort });
const view = ref<"card" | "table">("card");
const viewStorageKey = "temple_inventory.inventory.view";
const itemGroupRoot = "All Item Groups";
const summaryMetrics = computed(() =>
	[
		["available_stock", "可用"],
		["total_stock", "总计"],
		["on_loan_qty", "借出"],
		["damaged_qty", "损坏"],
	].map(([key, label], index) => ({
		key,
		label,
		icon: ["box", "total", "loan", "warning"][index],
		tone: ["available", "total", "loaned", "damaged"][index],
		quantities: quantityTotals.value[key] || [],
	})),
);
const sortColumns = computed(() => [
	{ key: "item_name", label: "物品", sortable: true, initialOrder: "asc" as const },
	{ key: "item_code", label: "物品编码 / 类别", sortable: true, initialOrder: "asc" as const },
	{ key: "available_stock", label: "可用数量", sortable: true, initialOrder: "desc" as const },
	{ key: "total_stock", label: "总计", sortable: true, initialOrder: "desc" as const },
	{ key: "on_loan_qty", label: "借出", sortable: true, initialOrder: "desc" as const },
	{ key: "damaged_qty", label: "损坏", sortable: true, initialOrder: "desc" as const },
	{ key: "details", label: "库位 / 批次信息" },
	{ key: "open", label: "" },
	...(selection.value ? [{ key: "selection", label: "选择" }] : []),
]);
const pageTitle = "库存列表";
const activeFilterCount = computed(
	() =>
		filters.value.warehouses.length +
		filters.value.item_groups.length +
		Number(Boolean(filters.value.search)) +
		Number(!filters.value.in_stock) +
		Number(filters.value.expiry_window !== "all"),
);
const exportFilters = computed(() => ({
	...filters.value,
	...sort.value,
	warehouses: filters.value.warehouses,
	item_groups: filters.value.item_groups,
}));
const inventoryTabQuery = computed(() => ({
	search: filters.value.search || undefined,
	warehouses: filters.value.warehouses.length ? filters.value.warehouses : undefined,
	item_groups: filters.value.item_groups.length ? filters.value.item_groups : undefined,
}));
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {});
const primaryActions = computed(() =>
	["Receive", "Issue", "Transfer"].filter((kind) => operationCaps.value[kind]),
);
const overflowActions = computed(() => [
	...(boot.value?.capabilities?.Item ? [{ kind: "CreateItem", label: "新建物品" }] : []),
	...primaryActions.value.map((kind) => ({
		kind,
		label: ({ Receive: "入库", Issue: "出库", Transfer: "转移" } as any)[kind],
	})),
	{ kind: "Export", label: "导出" },
]);
const mobileInventoryMetrics = computed<MobileSummaryMetric[]>(() =>
	summaryMetrics.value.map((metric) => ({
		key: metric.key,
		label: metric.label,
		overall: (metric.quantities || []).reduce((total, row) => total + Number(row.qty || 0), 0),
		tone: (metric.tone === "loaned"
			? "warning"
			: metric.tone === "damaged"
				? "danger"
				: metric.tone) as MobileSummaryMetric["tone"],
		details: (metric.quantities || []).map((row) => ({
			label: row.uom,
			value: Number(row.qty || 0),
			uom: row.uom,
		})),
	})),
);
const warehouseRows = computed(() => boot.value?.physical_tree || []);
const warehouseNodes = computed<InventoryFilterNode[]>(() =>
	warehouseRows.value.map((row: any) => ({
		name: row.name,
		label: row.local_label || row.warehouse_name || row.name,
		parent: row.parent_warehouse,
		isGroup: Boolean(row.is_group),
		count: facetCounts.value.warehouses?.[row.name],
	})),
);
const categoryNodes = computed<InventoryFilterNode[]>(() =>
	(boot.value?.item_groups || [])
		.filter((row: any) => row.name !== itemGroupRoot)
		.map((row: any) => ({
			name: row.name,
			label: row.item_group_name || row.name,
			parent: row.parent_item_group === itemGroupRoot ? undefined : row.parent_item_group,
			isGroup: Boolean(row.is_group),
			count: facetCounts.value.item_groups?.[row.name],
		})),
);
const panelFilters = computed<InventoryFilterState>({
	get: () => ({
		warehouses: filters.value.warehouses,
		categories: filters.value.item_groups,
		inStock: filters.value.in_stock,
		expiry: filters.value.expiry_window as InventoryFilterState["expiry"],
		expiryDays: filters.value.expiry_days,
		expiryFromDays: filters.value.expiry_from_days,
		expiryToDays: filters.value.expiry_to_days,
	}),
	set: (value) => {
		filters.value = {
			...filters.value,
			warehouses: value.warehouses,
			item_groups: value.categories,
			in_stock: value.inStock,
			expiry_window: value.expiry,
			expiry_days: value.expiryDays || "30",
			expiry_from_days: value.expiryFromDays || "",
			expiry_to_days: value.expiryToDays || "",
		};
	},
});
const customError = computed(() => {
	if (filters.value.expiry_window !== "custom") return "";
	const from = Number(filters.value.expiry_from_days),
		to = Number(filters.value.expiry_to_days);
	if (!Number.isInteger(from) || !Number.isInteger(to)) return "请输入完整的整数范围";
	if (from < -3650 || to > 3650 || from > to) return "范围须为 -3650 至 3650，且起始不大于结束";
	return "";
});
const warehouseText = (name: string) =>
	warehousePresentation(name, warehouseRows.value).breadcrumb;
const categoryText = (name: string) =>
	boot.value?.item_groups?.find((row: any) => row.name === name)?.item_group_name || name;
const chips = computed(() => [
	...filters.value.warehouses.map((value) => ({
		key: "warehouses",
		value,
		label: warehouseText(value),
	})),
	...filters.value.item_groups.map((value) => ({
		key: "item_groups",
		value,
		label: categoryText(value),
	})),
	...(filters.value.search ? [{ key: "search", label: `搜索：${filters.value.search}` }] : []),
	...(!filters.value.in_stock ? [{ key: "in_stock", label: "包含零库存" }] : []),
	...(filters.value.expiry_window !== "all"
		? [
				{
					key: "expiry_window",
					label:
						filters.value.expiry_window === "none" ? "效期：无效期" : "效期：已筛选",
				},
			]
		: []),
]);
let controller: AbortController | undefined,
	observer: IntersectionObserver | undefined,
	timer: ReturnType<typeof setTimeout> | undefined,
	mediaQuery: MediaQueryList | undefined;
let sequence = 0,
	syncingRoute = false;
const sortQuery = () =>
	JSON.stringify(sort.value) === JSON.stringify(defaultSort)
		? { sort_by: undefined, sort_order: undefined }
		: { sort_by: sort.value.sort_by, sort_order: sort.value.sort_order };
async function load(append = false) {
	if (customError.value) return;
	controller?.abort();
	controller = new AbortController();
	const current = ++sequence;
	append ? (loadingMore.value = true) : (loading.value = true);
	error.value = "";
	try {
		const data = await api(
			"inventory",
			{
				...filters.value,
				in_stock: filters.value.in_stock ? 1 : 0,
				expiry_window:
					filters.value.expiry_window === "all" ? "" : filters.value.expiry_window,
				expiry_from_days:
					filters.value.expiry_window === "custom"
						? filters.value.expiry_from_days
						: undefined,
				expiry_to_days:
					filters.value.expiry_window === "custom"
						? filters.value.expiry_to_days
						: undefined,
				warehouses: filters.value.warehouses.length ? filters.value.warehouses : undefined,
				item_groups: filters.value.item_groups.length
					? filters.value.item_groups
					: undefined,
				start: append ? rows.value.length : 0,
				page_length: 25,
				...sort.value,
			},
			controller.signal,
		);
		if (current !== sequence) return;
		const incoming: InventoryCardRow[] = data.results || [];
		rows.value = append
			? [
					...rows.value,
					...incoming.filter(
						(row) => !rows.value.some((old) => old.item_code === row.item_code),
					),
				]
			: incoming;
		total.value = Number(data.total || 0);
		overall.value = data.overall_total ?? null;
		facetCounts.value = data.facets || facetCounts.value;
		quantityTotals.value = data.quantity_totals || {};
	} catch (cause: any) {
		if (cause?.name !== "AbortError" && current === sequence) {
			error.value = cause.message;
			if (!append) quantityTotals.value = {};
		}
	} finally {
		if (current === sequence) {
			loading.value = false;
			loadingMore.value = false;
		}
	}
}
function scheduleLoad() {
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => void load(), 280);
}
function removeChip(chip: any) {
	if (chip.key === "warehouses" || chip.key === "item_groups")
		(filters.value as any)[chip.key] = (filters.value as any)[chip.key].filter(
			(value: string) => value !== chip.value,
		);
	else if (chip.key === "in_stock") filters.value.in_stock = true;
	else if (chip.key === "expiry_window") filters.value.expiry_window = "all";
	else filters.value.search = "";
}
function clearFilters() {
	filters.value = {
		search: "",
		warehouses: [],
		item_groups: [],
		in_stock: true,
		expiry_window: "all",
		expiry_days: "30",
		expiry_from_days: "-30",
		expiry_to_days: "30",
	};
}
function operation(kind: string) {
	if (kind === "Export") {
		exportOpen.value = true;
		return;
	}
	void router.push(kind === "CreateItem" ? "/items/new" : `/new/${kind}`);
}
function selectedOperation(kind: string) {
	if (!selected.value.length) return operation(kind);
	sessionStorage.setItem(`ti-seed:${kind}`, JSON.stringify({ items: selected.value }));
	operation(kind);
}
function toggle(code: string) {
	selected.value = selected.value.includes(code)
		? selected.value.filter((value) => value !== code)
		: [...selected.value, code];
}
function toggleSelection() {
	if (
		selection.value &&
		selected.value.length &&
		!window.confirm(`将放弃已选的 ${selected.value.length} 项物品，确定继续吗？`)
	)
		return;
	selection.value = !selection.value;
	if (!selection.value) selected.value = [];
}
function applySort(value: SortState) {
	sort.value = value;
	start.value = 0;
}
function setView(value: "card" | "table") {
	view.value = value;
	try {
		localStorage.setItem(viewStorageKey, value);
	} catch {
		// Storage is optional; the in-memory choice still applies.
	}
}
function toggleSortOrder() {
	sort.value = { ...sort.value, sort_order: sort.value.sort_order === "asc" ? "desc" : "asc" };
}
function openFilters(event: Event) {
	if (window.matchMedia("(min-width: 1024px)").matches)
		desktopFilterOpen.value = !desktopFilterOpen.value;
	else filterPanel.value?.openPanel(event);
}
function setupObserver() {
	observer?.disconnect();
	observer = new IntersectionObserver(
		(entries) => {
			if (
				entries.some((entry) => entry.isIntersecting) &&
				rows.value.length < total.value &&
				!loadingMore.value &&
				!loading.value
			)
				void load(true);
		},
		{
			root: mediaQuery?.matches ? resultsScroll.value : mobileResultsScroll.value,
			rootMargin: "240px",
		},
	);
	const target = mediaQuery?.matches ? sentinel.value : mobileSentinel.value;
	if (target) observer.observe(target);
}
async function scan(value: string) {
	if (scanBusy.value) return;
	scanBusy.value = true;
	try {
		const result = await api("scan", { value });
		scanner.value = false;
		if (result.item_code) await router.push(`/item/${encodeURIComponent(result.item_code)}`);
		else unknownBarcodePrompt.value = value;
	} catch (cause: any) {
		error.value = cause.message || "条码查询失败";
	} finally {
		scanBusy.value = false;
	}
}
async function createUnknownItem() {
	const value = unknownBarcodePrompt.value;
	unknownBarcodePrompt.value = "";
	sessionStorage.setItem("ti-unknown-barcode", value);
	await router.push("/items/new");
}
function dismissUnknownItem() {
	unknownBarcodePrompt.value = "";
	toast("未找到该条码对应的物品", "warning");
}
function hydrateInventoryFilters(query: Record<string, unknown>) {
	const hydrated = hydrateFilterQuery(query, filters.value) as typeof filters.value;
	hydrated.item_groups = hydrated.item_groups.filter((value) => value !== itemGroupRoot);
	hydrated.in_stock =
		String(query.mode || "") === "catalog"
			? false
			: !["0", "false"].includes(String(query.in_stock ?? "1"));
	const requestedWindow = String(query.expiry_window || "all");
	hydrated.expiry_window = [
		"all",
		"overdue",
		"overdue_within",
		"overdue_beyond",
		"remaining_within",
		"remaining_beyond",
		"none",
		"custom",
	].includes(requestedWindow)
		? requestedWindow
		: "all";
	const requestedDays = String(query.expiry_days || "30");
	hydrated.expiry_days =
		/^\d+$/.test(requestedDays) && Number(requestedDays) >= 1 && Number(requestedDays) <= 3650
			? requestedDays
			: "30";
	return hydrated;
}
function onResultsScroll(event?: Event) {
	const scrollingElement = event?.currentTarget as HTMLElement | null;
	const scrollTop = scrollingElement?.scrollTop ?? activeResultsScroll()?.scrollTop ?? 0;
	compact.value = scrollTop > 80;
}
function activeResultsScroll() {
	return mediaQuery?.matches
		? resultsScroll.value
		: mobileResultsScroll.value || resultsScroll.value;
}
async function initializeInventory() {
	error.value = "";
	try {
		if (!boot.value) {
			boot.value = await api("bootstrap");
			window.dispatchEvent(new CustomEvent("ti:refresh-shell"));
		}
		await load();
	} catch (cause: any) {
		error.value = cause.message;
	}
}
function handleViewportChange() {
	setupObserver();
	onResultsScroll();
}
watch(
	[filters, sort],
	() => {
		if (!boot.value) return;
		resultsScroll.value?.scrollTo({ top: 0 });
		if (!syncingRoute) {
			syncingRoute = true;
			void router
				.replace({
					query: {
						...route.query,
						mode: undefined,
						...serializeFilterQuery({
							...filters.value,
							in_stock: filters.value.in_stock ? undefined : 0,
							expiry_window:
								filters.value.expiry_window === "all"
									? undefined
									: filters.value.expiry_window,
						}),
						...sortQuery(),
					},
				})
				.finally(() => {
					syncingRoute = false;
				});
		}
		scheduleLoad();
	},
	{ deep: true },
);
watch(
	() => route.query,
	(query) => {
		const next = hydrateInventoryFilters(query as Record<string, unknown>);
		if (JSON.stringify(next) !== JSON.stringify(filters.value)) filters.value = next;
		const sortBy = String(query.sort_by || defaultSort.sort_by),
			sortOrder = String(query.sort_order || defaultSort.sort_order);
		if (
			[
				"item_name",
				"item_code",
				"available_stock",
				"total_stock",
				"on_loan_qty",
				"damaged_qty",
			].includes(sortBy) &&
			["asc", "desc"].includes(sortOrder) &&
			(sort.value.sort_by !== sortBy || sort.value.sort_order !== sortOrder)
		)
			sort.value = { sort_by: sortBy, sort_order: sortOrder as "asc" | "desc" };
	},
	{ deep: true },
);
onMounted(async () => {
	try {
		const savedView = localStorage.getItem(viewStorageKey);
		if (savedView === "card" || savedView === "table") view.value = savedView;
	} catch {
		view.value = "card";
	}
	filters.value = hydrateInventoryFilters(route.query as Record<string, unknown>);
	const sortBy = String(route.query.sort_by || defaultSort.sort_by),
		sortOrder = String(route.query.sort_order || defaultSort.sort_order);
	if (
		[
			"item_name",
			"item_code",
			"available_stock",
			"total_stock",
			"on_loan_qty",
			"damaged_qty",
		].includes(sortBy) &&
		["asc", "desc"].includes(sortOrder)
	)
		sort.value = { sort_by: sortBy, sort_order: sortOrder as "asc" | "desc" };
	await initializeInventory();
	await nextTick();
	if (typeof window.matchMedia === "function") {
		mediaQuery = window.matchMedia("(min-width: 1024px)");
		mediaQuery.addEventListener("change", handleViewportChange);
	}
	const saved = Number(sessionStorage.getItem("ti:inventory-results-scroll") || 0);
	activeResultsScroll()?.scrollTo({ top: saved });
	compact.value = saved > 80;
	setupObserver();
});
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
	sessionStorage.setItem(
		"ti:inventory-results-scroll",
		String(activeResultsScroll()?.scrollTop || 0),
	);
	controller?.abort();
	observer?.disconnect();
	mediaQuery?.removeEventListener("change", handleViewportChange);
});
</script>
<template>
	<section class="inventory-destination viewport-list-root inventory-desktop-page">
		<div class="mobile-inventory-page" :class="{ compact }">
			<header class="mobile-browse-header">
				<div class="mobile-title-row">
					<div>
						<h1>{{ pageTitle }}</h1>
						<span>{{ total }} 件物品</span>
					</div>
					<OverflowActionMenu :actions="overflowActions" @select="operation" />
				</div>
				<nav class="mobile-subnav" aria-label="库存页面">
					<RouterLink :to="{ path: '/', query: inventoryTabQuery }" aria-current="page"
						>库存列表</RouterLink
					>
					<RouterLink :to="{ path: '/expiry', query: inventoryTabQuery }"
						>效期批次 <span>{{ facetCounts.expiry?.all || 0 }}</span></RouterLink
					>
				</nav>
				<div class="mobile-search-actions" aria-label="浏览工具">
					<b class="compact-page-title">{{ pageTitle }}</b>
					<label
						><span aria-hidden="true">⌕</span
						><input
							v-model="filters.search"
							type="search"
							placeholder="搜索物品或条码"
							aria-label="搜索物品或条码"
					/></label>
					<button
						type="button"
						class="mobile-scan"
						aria-label="扫码"
						@click="scanner = true"
					>
						<InventoryIcon name="scan" /><span>扫码</span>
					</button>
					<button
						type="button"
						class="mobile-filter"
						:aria-label="`筛选，${activeFilterCount} 项已启用`"
						@click="openFilters($event)"
					>
						<InventoryIcon name="filter" /><span>筛选</span
						><b v-if="activeFilterCount">{{ activeFilterCount }}</b>
					</button>
				</div>
				<MobileInventorySummary
					:metrics="mobileInventoryMetrics"
					:expanded-key="expandedSummary"
					@select="expandedSummary = expandedSummary === $event ? '' : $event"
				/>
				<ActiveFilterChips
					:chips="chips"
					:show-clear="false"
					@remove="removeChip"
					@clear="clearFilters"
				/>
				<div class="mobile-result-controls">
					<span aria-live="polite">共 {{ total }} 件物品</span>
					<div role="group" aria-label="库存显示方式">
						<button
							type="button"
							aria-label="列表"
							:aria-pressed="view === 'table'"
							@click="setView('table')"
						>
							<InventoryIcon name="table" />
						</button>
						<button
							type="button"
							aria-label="卡片"
							:aria-pressed="view === 'card'"
							@click="setView('card')"
						>
							<InventoryIcon name="card" />
						</button>
					</div>
				</div>
			</header>
			<section
				ref="mobileResultsScroll"
				class="mobile-results"
				aria-label="库存结果"
				@scroll.passive="onResultsScroll"
			>
				<InventoryCardGrid
					v-if="view === 'card'"
					:rows="rows"
					:loading="loading"
					:loading-more="loadingMore"
					:error="error"
					compact-mobile
					:warehouse-label="warehouseText"
					@activate="
						(item) => router.push(`/item/${encodeURIComponent(item.item_code)}`)
					"
				>
					<template #error
						>{{ error }}
						<button type="button" @click="initializeInventory">重试</button></template
					>
				</InventoryCardGrid>
				<MobileInventoryList
					v-else
					:rows="rows"
					:loading="loading"
					:loading-more="loadingMore"
					:error="error"
					@retry="initializeInventory"
					@activate="
						(item) => router.push(`/item/${encodeURIComponent(item.item_code)}`)
					"
				/>
				<div ref="mobileSentinel" aria-hidden="true"></div>
			</section>
		</div>
		<div
			class="list-layout desktop-list-layout"
			:class="{ 'filters-open': desktopFilterOpen }"
		>
			<ResponsiveFilterPanel ref="filterPanel" v-model:open="filterOpen">
				<InventoryFilterPanel
					v-model="panelFilters"
					:warehouses="warehouseNodes"
					:categories="categoryNodes"
					:expiry-counts="facetCounts.expiry"
					:custom-error="customError"
				/>
			</ResponsiveFilterPanel>
			<div class="results-column" :class="{ compact }">
				<div class="results-chrome">
					<div class="inventory-heading">
						<div class="inventory-title">
							<h1>{{ pageTitle }}</h1>
							<span>{{ total }} 件物品</span>
						</div>
						<div class="inventory-heading-actions">
							<button
								v-if="operationCaps.Receive"
								type="button"
								@click="operation('Receive')"
							>
								↓ 入库
							</button>
							<button
								v-if="operationCaps.Issue"
								type="button"
								@click="operation('Issue')"
							>
								↑ 出库
							</button>
							<button
								v-if="operationCaps.Transfer"
								type="button"
								@click="operation('Transfer')"
							>
								⇄ 转移
							</button>
							<button type="button" @click="exportOpen = true">导出</button>
							<button
								v-if="boot?.capabilities?.Item"
								type="button"
								class="primary"
								@click="operation('CreateItem')"
							>
								＋ 新建物品
							</button>
						</div>
					</div>
					<div class="result-toolbar">
						<b class="compact-identity">{{ pageTitle }}</b>
						<label class="inventory-search"
							><span aria-hidden="true">⌕</span
							><input
								v-model="filters.search"
								type="search"
								placeholder="搜索物品或条码"
								aria-label="搜索物品或条码"
						/></label>
						<button
							class="toolbar-action"
							aria-label="扫描条码"
							@click="scanner = true"
						>
							<InventoryIcon name="scan" /><span>扫码</span>
						</button>
						<button
							type="button"
							class="inventory-filter-button"
							:class="{ active: desktopFilterOpen || filterOpen }"
							:aria-expanded="desktopFilterOpen || filterOpen"
							@click="openFilters($event)"
						>
							<InventoryIcon name="filter" />
							<span>筛选</span
							><b v-if="activeFilterCount">{{ activeFilterCount }}</b></button
						><button class="toolbar-action" @click="toggleSelection">
							<InventoryIcon name="select" /><span>{{
								selection ? "完成" : "选择"
							}}</span>
						</button>
						<div
							class="inventory-view-controls"
							role="group"
							aria-label="库存显示方式"
						>
							<button
								type="button"
								:aria-pressed="view === 'card'"
								@click="setView('card')"
							>
								<InventoryIcon name="card" /><span>卡片</span>
							</button>
							<button
								type="button"
								:aria-pressed="view === 'table'"
								@click="setView('table')"
							>
								<InventoryIcon name="table" /><span>表格</span>
							</button>
						</div>
					</div>
					<QuantitySummary
						v-if="!compact"
						:metrics="summaryMetrics"
						:loading="loading"
					/>
					<div class="inventory-filter-strip">
						<ActiveFilterChips
							:chips="chips"
							@remove="removeChip"
							@clear="clearFilters"
						/>
						<span v-if="!chips.length" class="no-filters"
							>全部仓库 · 全部类别 · 全部状态</span
						>
						<span class="inventory-result-count" aria-live="polite"
							>已加载 {{ rows.length }} · 筛选结果 {{ total }} · 全部
							{{ overall ?? total }}</span
						>
						<label v-if="view === 'card'" class="inventory-sort"
							>排序
							<select
								:value="sort.sort_by"
								@change="
									applySort({
										sort_by: ($event.target as HTMLSelectElement).value,
										sort_order: sort.sort_order,
									})
								"
							>
								<option value="item_name">物品名称</option>
								<option value="item_code">物品编码</option>
								<option value="available_stock">可用</option>
								<option value="total_stock">总计</option>
								<option value="on_loan_qty">借出</option>
								<option value="damaged_qty">损坏</option>
							</select>
						</label>
						<button
							v-if="view === 'card'"
							type="button"
							class="sort-direction"
							:aria-label="
								sort.sort_order === 'asc'
									? '当前升序，切换为降序'
									: '当前降序，切换为升序'
							"
							@click="toggleSortOrder"
						>
							{{ sort.sort_order === "asc" ? "升序 ↑" : "降序 ↓" }}
						</button>
					</div>
				</div>
				<div ref="resultsScroll" class="results-scroll" @scroll.passive="onResultsScroll">
					<div class="inventory-results">
						<InventoryCardGrid
							v-if="view === 'card'"
							:rows="rows"
							:loading="loading"
							:loading-more="loadingMore"
							:error="error"
							:selection-mode="selection"
							:selected-keys="selected"
							:warehouse-label="warehouseText"
							@activate="
								(item) =>
									router.push(`/item/${encodeURIComponent(item.item_code)}`)
							"
							@toggle="(item) => toggle(item.item_code)"
						>
							<template #error
								>{{ error }}
								<button type="button" @click="initializeInventory">
									重试
								</button></template
							>
						</InventoryCardGrid>
						<SortableDataTable
							v-else
							:rows="rows"
							:columns="sortColumns"
							row-key="item_code"
							:sort="sort"
							:loading="loading"
							:loading-more="loadingMore"
							:error="error"
							empty-message="暂无符合条件的物品"
							:selection-mode="selection"
							:selected-keys="selected"
							@sort="applySort"
							@activate="
								(item) =>
									router.push(`/item/${encodeURIComponent(item.item_code)}`)
							"
							@toggle="(item) => toggle(item.item_code)"
						>
							<template #error
								>{{ error }}
								<button type="button" @click="initializeInventory">
									重试
								</button></template
							>
							<template #cell-item_name="{ row }"
								><div class="primary-cell">
									<span data-row-control
										><ItemImagePreview
											:src="row.image || undefined"
											:alt="row.item_name" /></span
									><RouterLink
										data-row-action
										:to="`/item/${encodeURIComponent(row.item_code)}`"
										><b class="primary-text">{{ row.item_name }}</b
										><small v-if="row.description" class="secondary-text">{{
											String(row.description).replace(/<[^>]*>/g, " ")
										}}</small></RouterLink
									>
								</div></template
							>
							<template #cell-item_code="{ row }"
								><span class="item-code-cell"
									>{{ row.item_code }}<small>{{ row.item_group }}</small></span
								></template
							>
							<template #cell-available_stock="{ row }"
								><span class="quantity available-quantity"
									><b>{{ row.available_stock }} {{ row.stock_uom }}</b></span
								></template
							>
							<template #cell-total_stock="{ row }"
								><span class="quantity"
									>{{ row.total_stock }} {{ row.stock_uom }}</span
								></template
							>
							<template #cell-on_loan_qty="{ row }"
								><span class="quantity"
									>{{ row.on_loan_qty }} {{ row.stock_uom }}</span
								></template
							>
							<template #cell-damaged_qty="{ row }"
								><span class="quantity"
									>{{ row.damaged_qty }} {{ row.stock_uom }}</span
								></template
							>
							<template #cell-details="{ row }">
								<div class="table-details" data-row-control>
									<DetailPopover
										v-if="Object.keys(row.warehouse_stock || {}).length"
										:label="`${row.item_name}的仓库位置`"
										:trigger-text="`${Object.keys(row.warehouse_stock || {}).length} 个库位`"
									>
										<p v-for="(qty, name) in row.warehouse_stock" :key="name">
											{{ warehouseText(String(name)) }}：{{ qty }}
											{{ row.stock_uom }}
										</p>
									</DetailPopover>
									<DetailPopover
										v-if="row.has_batch_no && row.batches?.length"
										:label="`${row.item_name}的批次信息`"
										:trigger-text="`${row.batch_count ?? row.batches.length} 批次`"
									>
										<p v-for="batch in row.batches" :key="batch.batch_no">
											批次 {{ batch.batch_no }} · 数量 {{ batch.qty }}
											{{ row.stock_uom }} ·
											{{ batch.expiry_date || "无效期" }}
										</p>
									</DetailPopover>
									<span v-else-if="row.has_batch_no" class="table-batch-count"
										>{{ row.batch_count ?? "—" }} 批次</span
									>
								</div>
							</template>
							<template #cell-open><InventoryIcon name="open" /></template>
							<template #cell-selection="{ row }"
								><input
									data-row-control
									type="checkbox"
									:checked="selected.includes(row.item_code)"
									:aria-label="`选择 ${row.item_name}`"
									@change="toggle(row.item_code)"
							/></template>
							<template #mobile-row="{ row }"
								><article class="item-card result-card" tabindex="0">
									<span data-row-control
										><ItemImagePreview
											:src="row.image || undefined"
											:alt="row.item_name" /></span
									><RouterLink
										data-row-action
										:to="`/item/${encodeURIComponent(row.item_code)}`"
										><b>{{ row.item_name }}</b
										><small>{{ row.item_code }} · {{ row.item_group }}</small
										><strong class="available-quantity"
											>可用 {{ row.available_stock }}
											{{ row.stock_uom }}</strong
										><small
											>总计 {{ row.total_stock }} {{ row.stock_uom }}</small
										></RouterLink
									><input
										v-if="selection"
										data-row-control
										type="checkbox"
										:checked="selected.includes(row.item_code)"
										:aria-label="`选择 ${row.item_name}`"
										@change="toggle(row.item_code)"
									/></article
							></template>
						</SortableDataTable>
					</div>
					<div ref="sentinel" aria-hidden="true"></div>
				</div>
			</div>
		</div>
		<div
			v-if="selection && selected.length"
			class="context-action-bar"
			role="toolbar"
			aria-label="已选物品操作"
		>
			<span>已选 {{ selected.length }} 项</span
			><template v-for="kind in ['Receive', 'Issue', 'Transfer', 'Loan']" :key="kind"
				><button v-if="operationCaps[kind]" type="button" @click="selectedOperation(kind)">
					{{
						(
							{
								Receive: "入库",
								Issue: "出库",
								Transfer: "转移",
								Loan: "借出",
							} as any
						)[kind]
					}}
				</button></template
			>
		</div>
		<Scanner
			v-if="scanner"
			presentation="modal"
			:paused="scanBusy"
			@scan="scan"
			@close="scanner = false"
		/>
		<div
			v-if="unknownBarcodePrompt"
			class="modal"
			role="presentation"
			@click.self="dismissUnknownItem"
		>
			<section role="dialog" aria-modal="true" aria-labelledby="unknown-barcode-title">
				<h2 id="unknown-barcode-title">未找到物品</h2>
				<p>没有找到条码 {{ unknownBarcodePrompt }} 对应的物品。要现在新建物品吗？</p>
				<div class="detail-actions">
					<button type="button" @click="dismissUnknownItem">取消</button
					><button type="button" class="primary" @click="createUnknownItem">
						新建物品
					</button>
				</div>
			</section>
		</div>
		<ExportDialog
			v-model:open="exportOpen"
			report-type="current_stock"
			:filters="exportFilters"
			title="导出当前库存"
			summary="沿用当前搜索、类别、仓库和排序条件，包含物品汇总与批次明细。"
		/>
	</section>
</template>

<style scoped>
.inventory-desktop-page {
	color: #343c46;
	background: #f8f7f4;
}
.inventory-view-controls {
	display: flex;
	align-items: center;
	flex: none;
	gap: 0;
	padding: 2px;
	border-radius: 7px;
	background: #eeebe5;
}
.inventory-view-controls button {
	display: flex;
	align-items: center;
	gap: 5px;
	min-height: 28px;
	padding: 3px 8px;
	border: 0;
	background: transparent;
	color: #85817b;
}
.toolbar-action,
.inventory-filter-button {
	display: flex;
	align-items: center;
	gap: 6px;
	min-height: 34px;
	white-space: nowrap;
}
.compact-identity {
	display: none;
	font-size: 17px;
	white-space: nowrap;
}
.compact .inventory-heading {
	display: none;
}
.compact .compact-identity {
	display: block;
}
.compact .results-chrome {
	padding-top: 9px;
}
.inventory-view-controls button[aria-pressed="true"] {
	background: #fff;
	color: #665038;
	box-shadow: 0 1px 3px #473a2115;
}
.inventory-heading {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-bottom: 10px;
}
.inventory-title {
	display: flex;
	align-items: baseline;
	gap: 10px;
}
.inventory-title h1 {
	margin: 0;
	color: #202b39;
	font-size: 25px;
	font-weight: 750;
	line-height: 1.2;
}
.inventory-title span,
.inventory-result-count,
.no-filters {
	color: #7b8087;
	font-size: 12px;
}
.inventory-heading-actions {
	display: flex;
	gap: 7px;
	margin-left: auto;
}
.inventory-heading-actions button {
	min-height: 31px;
	padding: 5px 9px;
	color: #916236;
}
.inventory-heading-actions .primary {
	border-color: #ae8051;
	background: #ae8051;
	color: #fff;
}
.result-toolbar {
	gap: 7px;
	margin: 0;
	padding: 0;
	background: transparent;
}
.inventory-search {
	display: flex;
	min-width: 120px;
	height: 36px;
	flex: 1;
	align-items: center;
	gap: 8px;
	padding: 0 10px;
	border: 1px solid #e0e2e4;
	border-radius: 6px;
	background: #fff;
	color: #7b8492;
}
.inventory-search:focus-within {
	outline: 2px solid #946c3f;
}
.inventory-search input {
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
.inventory-filter-button {
	display: flex;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
}
.inventory-filter-button svg {
	width: 20px;
	height: 20px;
	fill: none;
	stroke: currentColor;
	stroke-linecap: round;
	stroke-width: 1.8;
}
.inventory-filter-button b {
	display: grid;
	min-width: 18px;
	height: 18px;
	place-items: center;
	border-radius: 50%;
	background: #ede4d6;
	color: #855e33;
	font-size: 10px;
}
.inventory-filter-button.active {
	border-color: #c8b69b;
	background: #f5f0e8;
}
.inventory-filter-strip {
	display: flex;
	min-height: 40px;
	align-items: center;
	gap: 8px;
	padding: 7px 0;
}
.inventory-filter-strip :deep(.active-filter-chips) {
	min-width: 0;
	flex: 1;
	margin: 0;
}
.inventory-result-count {
	margin-left: auto;
	white-space: nowrap;
}
.inventory-sort {
	display: flex;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
}
.inventory-sort select {
	min-width: 112px;
	padding-block: 6px;
}
.sort-direction {
	min-height: 34px;
	white-space: nowrap;
}
.item-code-cell {
	display: flex;
	flex-direction: column;
}
.item-code-cell small {
	color: #7b8087;
}
.table-details {
	display: flex;
	align-items: center;
	gap: 6px;
}
.table-batch-count {
	color: #476b88;
	font-size: 11px;
}
.mobile-inventory-page {
	display: none;
}
@media (max-width: 1023px) {
	.inventory-desktop-page {
		width: 100%;
		height: calc(
			100dvh - var(--mobile-nav-height, 0px) - var(--mobile-context-nav-height, 0px)
		);
		min-height: 0;
		overflow: hidden;
		padding: 0;
	}
	.desktop-list-layout {
		display: none !important;
	}
	.mobile-inventory-page {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
		background: #f8f7f4;
	}
	.mobile-browse-header {
		position: sticky;
		top: 0;
		z-index: 20;
		display: grid;
		gap: 9px;
		margin: 0;
		padding: 12px 10px 7px;
		border-bottom: 1px solid #ebe6dd;
		background: rgb(248 247 244 / 97%);
		box-shadow: 0 2px 10px rgb(72 54 32 / 4%);
		backdrop-filter: blur(10px);
	}
	.mobile-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.mobile-title-row > div:first-child {
		display: flex;
		min-width: 0;
		align-items: baseline;
		gap: 8px;
		margin-right: auto;
	}
	.mobile-title-row > .overflow-action-menu {
		margin-left: auto;
		margin-right: 0;
	}
	.mobile-title-row h1 {
		margin: 0;
		color: #202b39;
		font-size: 24px;
		line-height: 1.2;
	}
	.mobile-title-row span {
		color: #7c858f;
		font-size: 12px;
	}
	.mobile-subnav {
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 3px;
		border-radius: 8px;
		background: #ece8e1;
	}
	.mobile-subnav a {
		min-height: 38px;
		padding: 9px;
		border-radius: 6px;
		color: #746d63;
		text-align: center;
		text-decoration: none;
	}
	.mobile-subnav a[aria-current="page"] {
		background: #fff;
		color: #80572f;
		box-shadow: 0 1px 3px #5b49351c;
		font-weight: 700;
	}
	.mobile-subnav span {
		margin-left: 2px;
		font-size: 10px;
	}
	.mobile-search-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.compact-page-title {
		display: none;
		flex: none;
		color: #202b39;
		font-size: 15px;
		white-space: nowrap;
	}
	.mobile-search-actions label {
		display: flex;
		min-width: 0;
		height: 44px;
		flex: 1;
		align-items: center;
		gap: 6px;
		padding: 0 9px;
		border: 1px solid #e3dfd7;
		border-radius: 8px;
		background: #fff;
		color: #7c858f;
	}
	.mobile-search-actions input {
		width: 100%;
		min-width: 0;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 12px;
	}
	.mobile-search-actions > button {
		position: relative;
		display: flex;
		min-width: 62px;
		height: 44px;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 0 7px;
		border: 1px solid #e3dfd7;
		border-radius: 8px;
		background: #fff;
		font-size: 12px;
	}
	.mobile-filter > b {
		position: absolute;
		top: -5px;
		right: -4px;
		display: grid;
		min-width: 18px;
		height: 18px;
		place-items: center;
		padding: 0 4px;
		border: 2px solid #f8f7f4;
		border-radius: 50%;
		background: #f2dfc9;
		color: #965a23;
		font-size: 9px;
	}
	.mobile-result-controls {
		display: flex;
		min-height: 34px;
		align-items: center;
		justify-content: space-between;
	}
	.mobile-result-controls > span {
		font-size: 13px;
		font-weight: 600;
	}
	.mobile-result-controls > div {
		display: flex;
		padding: 2px;
		border-radius: 7px;
		background: #efebe5;
	}
	.mobile-result-controls button {
		display: grid;
		width: 38px;
		height: 32px;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
	}
	.mobile-result-controls button[aria-pressed="true"] {
		background: #fff;
		color: #95602d;
		box-shadow: 0 1px 3px rgb(59 46 31 / 12%);
	}
	.mobile-results {
		min-height: 0;
		flex: 1;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 4px 8px 16px;
		background: #f8f7f4;
	}
	.mobile-results :deep(.inventory-card-grid) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		padding: 4px 0;
	}
	.mobile-results :deep(.inventory-card-body) {
		padding: 7px 8px 9px;
		gap: 4px;
	}
	.mobile-results :deep(.inventory-card-name) {
		font-size: 13px;
	}
	.mobile-results :deep(.inventory-card-image) {
		aspect-ratio: 1.08;
	}
	.mobile-results :deep(.inventory-card-totals) {
		font-size: 10px;
	}
	.mobile-results :deep(.card-state) {
		padding: 25px 8px;
	}
	.mobile-inventory-page.compact .mobile-title-row,
	.mobile-inventory-page.compact .mobile-subnav,
	.mobile-inventory-page.compact :deep(.mobile-summary) {
		display: none;
	}
	.mobile-inventory-page.compact .mobile-browse-header {
		gap: 5px;
		padding: 7px 8px 4px;
	}
	.mobile-inventory-page.compact .mobile-search-actions > button {
		min-width: 40px;
	}
	.mobile-inventory-page.compact .mobile-search-actions > button span {
		display: none;
	}
	.mobile-inventory-page.compact .compact-page-title {
		display: block;
	}
}

@media (min-width: 1024px) {
	.inventory-desktop-page {
		width: 100%;
		max-width: none;
		padding: 0 16px;
	}
	.desktop-list-layout {
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
	}
	.desktop-list-layout.filters-open {
		grid-template-columns: 250px minmax(0, 1fr);
		margin-left: -16px;
	}
	.desktop-list-layout:not(.filters-open) :deep(.filter-sidebar) {
		display: none;
	}
	.desktop-list-layout.filters-open :deep(.filter-sidebar) {
		display: block;
		padding: 14px 12px;
		border-right: 1px solid #e4ded5;
		border-radius: 0;
		background: #fbfaf7;
		box-shadow: none;
	}
	.desktop-list-layout.filters-open :deep(.filter-sidebar h2) {
		color: #202b39;
		font-size: 20px;
	}
	.results-column {
		padding-left: 0;
	}
	.filters-open .results-column {
		padding-left: 16px;
	}
	.results-chrome {
		padding-top: 14px;
	}
	.results-scroll {
		border: 1px solid #ece9e2;
		border-radius: 8px 8px 0 0;
		background: #fff;
	}
	.inventory-results :deep(.sortable-data-table table) {
		font-size: 14px;
	}
	.inventory-results :deep(.sortable-data-table th) {
		background: #f2f2f0;
		color: #7a7d84;
		font-size: 14px;
	}
	.inventory-results :deep(.sortable-data-table td) {
		height: 57px;
		padding: 5px 10px;
		border-bottom-color: #f0f0ed;
	}
	.inventory-results :deep(.sortable-data-table th),
	.inventory-results :deep(.sortable-data-table td) {
		padding-inline: 10px;
	}
	.inventory-fab {
		display: none;
	}
}
@media (max-width: 1023px) {
	.inventory-desktop-page {
		padding: 14px;
	}
	.inventory-heading {
		display: none;
	}
	.inventory-filter-button span {
		display: none;
	}
	.inventory-result-count {
		width: 100%;
		margin-left: 0;
	}
	.inventory-filter-strip {
		flex-wrap: wrap;
	}
}
</style>
