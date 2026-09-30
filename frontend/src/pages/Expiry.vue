<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../lib/api";
import { warehousePresentation } from "../lib/warehousePresenter";
import { hydrateFilterQuery, sameFilterValue, serializeFilterQuery } from "../composables/filters";
import ResponsiveFilterPanel from "../components/ResponsiveFilterPanel.vue";
import ActiveFilterChips from "../components/ActiveFilterChips.vue";
import OverflowActionMenu from "../components/OverflowActionMenu.vue";
import MobileExpiryResults from "../components/MobileExpiryResults.vue";
import MobileInventorySummary, {
	type MobileSummaryMetric,
} from "../components/MobileInventorySummary.vue";
import Scanner from "../components/Scanner.vue";
import ItemImagePreview from "../components/ItemImagePreview.vue";
import SortableDataTable, { type SortState } from "../components/SortableDataTable.vue";
import { formatExpiryDuration } from "../lib/duration";
import ExportDialog from "../components/ExportDialog.vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import InventoryFilterPanel, {
	type InventoryFilterNode,
	type InventoryFilterState,
} from "../components/InventoryFilterPanel.vue";

const route = useRoute();
const router = useRouter();
const boot = ref<any>();
const rows = ref<any[]>([]);
const error = ref("");
const busy = ref(false);
const refreshing = ref(false);
const appending = ref(false);
const total = ref(0);
const overallTotal = ref(0);
const quantityTotals = ref<Record<string, Array<{ uom: string; qty: number }>>>({});
const facetCounts = ref<any>({ warehouses: {}, item_groups: {}, expiry: {} });
const start = ref(0);
const pageLength = 25;
const filterOpen = ref(false);
const desktopFilterOpen = ref(false);
const exportOpen = ref(false);
const compact = ref(false);
const expandedSummary = ref("");
const scanner = ref(false);
const scanBusy = ref(false);
const view = ref<"card" | "table">("table");
const viewStorageKey = "temple_inventory.expiry.view";
const itemGroupRoot = "All Item Groups";
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {});
const movementActions = computed(() =>
	["Receive", "Issue", "Transfer"]
		.filter((kind) => operationCaps.value[kind])
		.map((kind) => ({
			kind,
			label: ({ Receive: "入库", Issue: "出库", Transfer: "转移" } as any)[kind],
		})),
);
const overflowActions = computed(() => [
	...movementActions.value,
	{ kind: "Export", label: "导出" },
]);
const expirySummary = ref({
	expiring_soon: 0,
	expired: 0,
	within_7_days: 0,
	days_8_to_30: 0,
	average_remaining_days: null as number | null,
});
const mobileExpiryMetrics = computed<MobileSummaryMetric[]>(() => [
	{
		key: "soon",
		label: "即将到期",
		overall: Number(expirySummary.value.expiring_soon || 0),
		tone: "warning",
		details: [
			{ label: "7 天内", value: Number(expirySummary.value.within_7_days || 0) },
			{ label: "8–30 天内", value: Number(expirySummary.value.days_8_to_30 || 0) },
			...(expirySummary.value.average_remaining_days == null
				? []
				: [
						{
							label: "平均剩余",
							value: expirySummary.value.average_remaining_days,
							uom: "天",
						},
					]),
		],
	},
	{
		key: "expired",
		label: "已过期",
		overall: Number(expirySummary.value.expired || 0),
		tone: "danger",
		details: [{ label: "已过期批次", value: Number(expirySummary.value.expired || 0) }],
	},
]);
const filterPanel = ref<InstanceType<typeof ResponsiveFilterPanel> | null>(null);
const sentinel = ref<HTMLElement>();
const resultsScroll = ref<HTMLElement>();
const mobileResultsScroll = ref<HTMLElement>();
const mobileSentinel = ref<HTMLElement>();
const scrollKey = "temple_inventory.scroll.expiry";
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
const defaultSort: SortState = { sort_by: "expiry_date", sort_order: "asc" };
const sort = ref<SortState>({ ...defaultSort });
const sortColumns = [
	{ key: "item_name", label: "物品 / 批次", sortable: true, initialOrder: "asc" as const },
	{ key: "item_group", label: "类别" },
	{ key: "expiry_date", label: "到期日期", sortable: true, initialOrder: "asc" as const },
	{ key: "days_to_expiry", label: "剩余" },
	{ key: "total_qty", label: "数量", sortable: true, initialOrder: "desc" as const },
	{ key: "locations", label: "位置" },
];
const expiryWindows = [
	"all",
	"overdue",
	"overdue_within",
	"overdue_beyond",
	"remaining_within",
	"remaining_beyond",
	"none",
	"custom",
];
const routeValidationError = ref("");
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
const expiryDays = computed(() =>
	/^[1-9]\d*$/.test(filters.value.expiry_days) ? filters.value.expiry_days : "30",
);
const expiryWindowLabel = (value = filters.value.expiry_window) =>
	(
		({
			overdue: "已过期",
			overdue_within: `已过期 ${expiryDays.value} 天以下`,
			overdue_beyond: `已过期 ${expiryDays.value} 天以上`,
			remaining_within: `还剩 ${expiryDays.value} 天以下`,
			remaining_beyond: `还剩 ${expiryDays.value} 天以上`,
			none: "无效期",
			custom: `自定义 ${filters.value.expiry_from_days} – ${filters.value.expiry_to_days} 天`,
		}) as Record<string, string>
	)[value] || "全部效期";

const activeCount = computed(
	() =>
		filters.value.warehouses.length +
		filters.value.item_groups.length +
		(filters.value.search ? 1 : 0) +
		(!filters.value.in_stock ? 1 : 0) +
		(filters.value.expiry_window !== "all" ? 1 : 0),
);
const sortQuery = () =>
	JSON.stringify(sort.value) === JSON.stringify(defaultSort)
		? { sort_by: undefined, sort_order: undefined }
		: { sort_by: sort.value.sort_by, sort_order: sort.value.sort_order };
const exportFilters = computed(() => ({
	...filters.value,
	...sort.value,
	warehouses: filters.value.warehouses,
	item_groups: filters.value.item_groups,
}));
const expiryTabQuery = computed(() => ({
	search: filters.value.search || undefined,
	warehouses: filters.value.warehouses.length ? filters.value.warehouses : undefined,
	item_groups: filters.value.item_groups.length ? filters.value.item_groups : undefined,
}));
const chips = computed(() => [
	...filters.value.warehouses.map((value) => ({
		key: "warehouses",
		value,
		label: warehouseText(value),
	})),
	...filters.value.item_groups.map((value) => ({
		key: "item_groups",
		value,
		label:
			boot.value?.item_groups?.find((group: any) => group.name === value)?.item_group_name ||
			value,
	})),
	...(filters.value.search ? [{ key: "search", label: `搜索：${filters.value.search}` }] : []),
	...(!filters.value.in_stock ? [{ key: "in_stock", label: "包含零库存" }] : []),
	...(filters.value.expiry_window !== "all"
		? [{ key: "expiry_window", label: expiryWindowLabel() }]
		: []),
]);

function removeChip(chip: any) {
	if (chip.key === "warehouses")
		filters.value.warehouses = filters.value.warehouses.filter(
			(value) => value !== chip.value,
		);
	else if (chip.key === "item_groups")
		filters.value.item_groups = filters.value.item_groups.filter(
			(value) => value !== chip.value,
		);
	else if (chip.key === "in_stock") filters.value.in_stock = true;
	else if (chip.key === "expiry_window") filters.value.expiry_window = "all";
	else (filters.value as any)[chip.key] = "";
}
function clearAll() {
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
	start.value = 0;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let sequence = 0;
let syncingRoute = false;
let restoringRoute = false;
let observer: IntersectionObserver | undefined;
let mediaQuery: MediaQueryList | undefined;
let lastRequestKey = "";
function operation(kind: string) {
	if (kind === "Export") {
		exportOpen.value = true;
		return;
	}
	void router.push(`/new/${kind}`);
}
function setQuickExpiry(kind: "all" | "soon" | "expired") {
	filters.value = {
		...filters.value,
		expiry_window: kind === "all" ? "all" : kind === "soon" ? "remaining_within" : "overdue",
		expiry_days: "30",
	};
}
async function scan(value: string) {
	if (scanBusy.value) return;
	scanBusy.value = true;
	try {
		const result = await api("scan", { value });
		scanner.value = false;
		if (result.item_code) await router.push(`/item/${encodeURIComponent(result.item_code)}`);
	} catch (cause: any) {
		error.value = cause.message || "条码查询失败";
	} finally {
		scanBusy.value = false;
	}
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
		/* optional */
	}
}
function openFilters(event: Event) {
	if (window.matchMedia("(min-width: 1024px)").matches)
		desktopFilterOpen.value = !desktopFilterOpen.value;
	else filterPanel.value?.openPanel(event);
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
function handleViewportChange() {
	setupObserver();
	onResultsScroll();
}
function setupObserver() {
	observer?.disconnect();
	observer = new IntersectionObserver(
		(entries) => {
			if (
				entries.some((entry) => entry.isIntersecting) &&
				rows.value.length < total.value &&
				!busy.value &&
				!refreshing.value &&
				!appending.value
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
async function load(append = false) {
	if (!boot.value) return;
	if (customError.value) return;
	if (timer) clearTimeout(timer);
	controller?.abort();
	const current = ++sequence;
	controller = new AbortController();
	const run = async () => {
		appending.value = append;
		refreshing.value = !append && rows.value.length > 0;
		busy.value = !append && rows.value.length === 0;
		error.value = "";
		try {
			const data = await api(
				"expiring_batches",
				{
					...filters.value,
					...sort.value,
					in_stock: filters.value.in_stock ? 1 : 0,
					expiry_window:
						filters.value.expiry_window === "all" ? "" : filters.value.expiry_window,
					expiry_days: expiryDays.value,
					expiry_from_days:
						filters.value.expiry_window === "custom"
							? filters.value.expiry_from_days
							: undefined,
					expiry_to_days:
						filters.value.expiry_window === "custom"
							? filters.value.expiry_to_days
							: undefined,
					warehouses: filters.value.warehouses.length
						? filters.value.warehouses
						: undefined,
					item_groups: filters.value.item_groups.length
						? filters.value.item_groups
						: undefined,
					start: append ? rows.value.length : start.value,
					page_length: pageLength,
				},
				controller?.signal,
			);
			if (current !== sequence) return;
			rows.value = append
				? [
						...rows.value,
						...(data.results || []).filter(
							(row: any) => !rows.value.some((old) => old.batch_no === row.batch_no),
						),
					]
				: data.results || [];
			total.value = data.total || 0;
			facetCounts.value = data.facets || facetCounts.value;
			overallTotal.value = data.overall_total || 0;
			quantityTotals.value = data.quantity_totals || {};
			expirySummary.value = {
				...expirySummary.value,
				...(data.expiry_summary || {}),
			};
			syncingRoute = true;
			void router
				.replace({
					query: {
						...route.query,
						sort: undefined,
						...serializeFilterQuery({
							...filters.value,
							in_stock: filters.value.in_stock ? undefined : 0,
							expiry_window:
								filters.value.expiry_window === "all"
									? undefined
									: filters.value.expiry_window,
							start: start.value || undefined,
						}),
						...sortQuery(),
					},
				})
				.finally(() => {
					syncingRoute = false;
				});
		} catch (cause: any) {
			if (current === sequence && cause?.name !== "AbortError") {
				error.value = cause.message;
				if (!append) quantityTotals.value = {};
			}
		} finally {
			if (current === sequence) {
				busy.value = false;
				refreshing.value = false;
				appending.value = false;
			}
		}
	};
	if (filters.value.search) timer = setTimeout(() => void run(), 300);
	else await run();
}

watch(
	[filters, sort],
	() => {
		const requestKey = JSON.stringify({
			...filters.value,
			sort: sort.value,
		});
		if (requestKey === lastRequestKey) return;
		lastRequestKey = requestKey;
		const preserveStart = restoringRoute;
		restoringRoute = false;
		if (!preserveStart) start.value = 0;
		if (!preserveStart) resultsScroll.value?.scrollTo({ top: 0 });
		void load();
	},
	{ deep: true },
);

watch(
	() => route.query,
	(query) => {
		if (syncingRoute || !boot.value) return;
		const hydrated = hydrateFilterQuery(query as Record<string, unknown>, {
			search: "",
			warehouses: [] as string[],
			item_groups: [] as string[],
			in_stock: true,
			expiry_window: "all",
			expiry_days: "30",
			expiry_from_days: "-30",
			expiry_to_days: "30",
			start: "0",
		});
		const requestedWindow = String(hydrated.expiry_window || "all");
		const requestedDays = String(hydrated.expiry_days || "");
		const validWindow = expiryWindows.includes(requestedWindow);
		const validDays = /^[1-9]\d*$/.test(requestedDays);
		if (!validWindow || !validDays)
			routeValidationError.value = "效期范围参数无效，已恢复为默认值。";
		const next = {
			search: String(hydrated.search || ""),
			warehouses: hydrated.warehouses as string[],
			item_groups: (hydrated.item_groups as string[]).filter(
				(value) => value !== itemGroupRoot,
			),
			in_stock: !["0", "false"].includes(String((query as any).in_stock ?? "1")),
			expiry_window: validWindow ? requestedWindow : "all",
			expiry_days: validDays ? requestedDays : "30",
			expiry_from_days: String(hydrated.expiry_from_days ?? "-30"),
			expiry_to_days: String(hydrated.expiry_to_days ?? "30"),
		};
		const changed = Object.keys(next).some(
			(key) => !sameFilterValue((filters.value as any)[key], (next as any)[key]),
		);
		const sortBy = String(query.sort_by || "expiry_date");
		const sortOrder = String(query.sort_order || query.sort || "asc");
		const nextSort =
			["item_name", "expiry_date", "total_qty"].includes(sortBy) &&
			["asc", "desc"].includes(sortOrder)
				? { sort_by: sortBy, sort_order: sortOrder as "asc" | "desc" }
				: { ...defaultSort };
		const sortChanged =
			sort.value.sort_by !== nextSort.sort_by ||
			sort.value.sort_order !== nextSort.sort_order;
		if (!changed && start.value === (Number(hydrated.start) || 0) && !sortChanged) return;
		restoringRoute = true;
		filters.value = next;
		start.value = Number(hydrated.start) || 0;
		sort.value = nextSort;
	},
	{ deep: true },
);

onMounted(async () => {
	try {
		try {
			const savedView = localStorage.getItem(viewStorageKey);
			if (savedView === "card" || savedView === "table") view.value = savedView;
		} catch {
			view.value = "table";
		}
		boot.value = await api("bootstrap");
		const hydrated = hydrateFilterQuery(route.query as Record<string, unknown>, {
			search: "",
			warehouses: [] as string[],
			item_groups: [] as string[],
			in_stock: true,
			expiry_window: "all",
			expiry_days: "30",
			expiry_from_days: "-30",
			expiry_to_days: "30",
			start: "0",
		});
		filters.value = {
			search: String(hydrated.search || ""),
			warehouses: hydrated.warehouses as string[],
			item_groups: (hydrated.item_groups as string[]).filter(
				(value) => value !== itemGroupRoot,
			),
			in_stock: !["0", "false"].includes(String(route.query.in_stock ?? "1")),
			expiry_window: String(hydrated.expiry_window || "all"),
			expiry_days: /^[1-9]\d*$/.test(String(hydrated.expiry_days || ""))
				? String(hydrated.expiry_days)
				: "30",
			expiry_from_days: String(hydrated.expiry_from_days ?? "-30"),
			expiry_to_days: String(hydrated.expiry_to_days ?? "30"),
		};
		lastRequestKey = JSON.stringify({
			...filters.value,
			sort: sort.value,
		});
		const sortBy = String(route.query.sort_by || "expiry_date");
		const sortOrder = String(route.query.sort_order || route.query.sort || "asc");
		if (
			["item_name", "expiry_date", "total_qty"].includes(sortBy) &&
			["asc", "desc"].includes(sortOrder)
		)
			sort.value = { sort_by: sortBy, sort_order: sortOrder as "asc" | "desc" };
		start.value = Number(hydrated.start) || 0;
		await load();
		await nextTick();
		if (typeof window.matchMedia === "function") {
			mediaQuery = window.matchMedia("(min-width: 1024px)");
			mediaQuery.addEventListener("change", handleViewportChange);
		}
		setupObserver();
		const saved = Number(sessionStorage.getItem(scrollKey) || 0);
		activeResultsScroll()?.scrollTo({ top: saved });
		compact.value = saved > 80;
	} catch (cause: any) {
		error.value = cause.message;
	}
});
onBeforeUnmount(() => {
	controller?.abort();
	observer?.disconnect();
	mediaQuery?.removeEventListener("change", handleViewportChange);
	sessionStorage.setItem(scrollKey, String(activeResultsScroll()?.scrollTop || 0));
});
</script>

<template>
	<main class="inventory-destination wide-shell viewport-list-root expiry-desktop-page">
		<div class="mobile-expiry-page" :class="{ compact }">
			<header class="mobile-browse-header">
				<div class="mobile-title-row">
					<div>
						<h1>效期批次</h1>
						<span>{{ total }} 个批次</span>
					</div>
					<OverflowActionMenu :actions="overflowActions" @select="operation" />
				</div>
				<nav class="mobile-subnav" aria-label="库存页面">
					<RouterLink :to="{ path: '/', query: expiryTabQuery }">库存列表</RouterLink>
					<RouterLink
						:to="{ path: '/expiry', query: expiryTabQuery }"
						aria-current="page"
						>效期批次 <span>{{ facetCounts.expiry?.all || 0 }}</span></RouterLink
					>
				</nav>
				<div class="mobile-search-actions" aria-label="浏览工具">
					<b class="compact-page-title">效期批次</b>
					<label
						><span aria-hidden="true">⌕</span
						><input
							v-model="filters.search"
							type="search"
							placeholder="搜索物品或批次"
							aria-label="搜索物品或批次"
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
						:aria-label="`筛选，${activeCount} 项已启用`"
						@click="openFilters($event)"
					>
						<InventoryIcon name="filter" /><span>筛选</span
						><b v-if="activeCount">{{ activeCount }}</b>
					</button>
				</div>
				<MobileInventorySummary
					:metrics="mobileExpiryMetrics"
					:expanded-key="expandedSummary"
					@select="expandedSummary = expandedSummary === $event ? '' : $event"
				/>
				<div class="expiry-quick-filters" role="group" aria-label="效期状态">
					<button
						type="button"
						:aria-pressed="filters.expiry_window === 'all'"
						@click="setQuickExpiry('all')"
					>
						全部 <span>{{ facetCounts.expiry?.all || 0 }}</span>
					</button>
					<button
						type="button"
						:aria-pressed="
							filters.expiry_window === 'remaining_within' &&
							filters.expiry_days === '30'
						"
						@click="setQuickExpiry('soon')"
					>
						即将到期 <span>{{ expirySummary.expiring_soon }}</span>
					</button>
					<button
						type="button"
						:aria-pressed="filters.expiry_window === 'overdue'"
						@click="setQuickExpiry('expired')"
					>
						已过期 <span>{{ expirySummary.expired }}</span>
					</button>
				</div>
				<ActiveFilterChips
					:chips="chips"
					:show-clear="false"
					@remove="removeChip"
					@clear="clearAll"
				/>
				<div class="mobile-result-controls">
					<span aria-live="polite">共 {{ total }} 个批次</span>
				</div>
			</header>
			<section
				ref="mobileResultsScroll"
				class="mobile-results"
				aria-label="效期批次结果"
				@scroll.passive="onResultsScroll"
			>
				<MobileExpiryResults
					:rows="rows"
					:loading="busy"
					:loading-more="appending"
					:error="error || routeValidationError"
					:warehouse-label="warehouseText"
					@retry="load()"
					@activate="
						(row) =>
							router.push(
								`/item/${encodeURIComponent(row.item_code)}?batch=${encodeURIComponent(row.batch_no)}`,
							)
					"
				/>
				<div ref="mobileSentinel" aria-hidden="true"></div>
			</section>
		</div>
		<div
			class="list-layout desktop-list-layout"
			:class="{ 'filters-open': desktopFilterOpen }"
		>
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="activeCount"
			>
				<InventoryFilterPanel
					v-model="panelFilters"
					:warehouses="warehouseNodes"
					:categories="categoryNodes"
					:expiry-counts="facetCounts.expiry"
					:custom-error="customError"
					expiry-primary
				/>
			</ResponsiveFilterPanel>
			<div class="results-column" :class="{ compact }">
				<div class="results-chrome">
					<div class="inventory-heading">
						<div class="inventory-title">
							<h1>效期批次</h1>
							<span>{{ total }} 个批次</span>
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
						</div>
					</div>
					<div class="result-toolbar">
						<b class="compact-identity">效期批次</b>
						<label class="inventory-search"
							><span aria-hidden="true">⌕</span
							><input
								v-model="filters.search"
								type="search"
								placeholder="搜索物品或批次"
								aria-label="搜索物品或批次"
						/></label>
						<button
							type="button"
							class="inventory-filter-button"
							:class="{ active: desktopFilterOpen || filterOpen }"
							:aria-expanded="desktopFilterOpen || filterOpen"
							@click="openFilters($event)"
						>
							<InventoryIcon name="filter" /><span>筛选</span
							><b v-if="activeCount">{{ activeCount }}</b>
						</button>
						<div
							class="inventory-view-controls"
							role="group"
							aria-label="效期显示方式"
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
					<div class="inventory-filter-strip">
						<ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
						<span v-if="!chips.length" class="no-filters"
							>全部仓库 · 全部类别 · 全部效期</span
						>
						<span class="inventory-result-count" aria-live="polite">{{
							refreshing
								? "正在更新…"
								: `已加载 ${rows.length} · 筛选结果 ${total} · 全部 ${overallTotal}`
						}}</span>
					</div>
				</div>
				<div ref="resultsScroll" class="results-scroll" @scroll.passive="onResultsScroll">
					<div
						v-if="view === 'card'"
						class="expiry-card-grid"
						:aria-busy="busy || refreshing"
					>
						<RouterLink
							v-for="row in rows"
							:key="row.batch_no"
							class="expiry-batch-card"
							:class="{
								overdue: row.days_to_expiry < 0,
								soon: row.days_to_expiry >= 0 && row.days_to_expiry <= 30,
							}"
							:to="`/item/${encodeURIComponent(row.item_code)}?batch=${encodeURIComponent(row.batch_no)}`"
						>
							<img
								v-if="row.image"
								:src="row.image"
								:alt="row.item_name"
								loading="lazy"
								decoding="async"
							/><span v-else class="expiry-card-placeholder"
								><InventoryIcon name="box"
							/></span>
							<div>
								<small>{{ row.item_group }}</small>
								<h3>{{ row.item_name }}</h3>
								<p>{{ row.item_code }} · {{ row.batch_no }}</p>
								<strong>{{ row.total_qty }} {{ row.stock_uom }}</strong>
								<p class="expiry-date">
									{{ row.expiry_date ? `到期 ${row.expiry_date}` : "无效期"
									}}<span v-if="row.days_to_expiry != null">
										· {{ formatExpiryDuration(row.days_to_expiry) }}</span
									>
								</p>
								<p
									v-for="location in row.locations"
									:key="location.warehouse"
									class="location-line"
								>
									{{ warehouseText(location.warehouse) }}：{{ location.qty }}
								</p>
							</div>
						</RouterLink>
						<p v-if="!busy && !rows.length" class="empty-state">暂无符合条件的批次</p>
					</div>
					<SortableDataTable
						v-else
						:rows="rows"
						:columns="sortColumns"
						row-key="batch_no"
						:sort="sort"
						:loading="busy || refreshing"
						:loading-more="appending"
						:error="error || routeValidationError"
						empty-message="暂无符合条件的批次"
						@sort="applySort"
						@activate="
							(row) =>
								router.push(
									`/item/${encodeURIComponent(row.item_code)}?batch=${encodeURIComponent(row.batch_no)}`,
								)
						"
					>
						<template #error
							>{{ error || routeValidationError }}
							<button type="button" @click="load()">重试</button></template
						>
						<template #cell-item_name="{ row }"
							><div class="primary-cell">
								<span data-row-control
									><ItemImagePreview
										:src="row.image"
										:alt="row.item_name" /></span
								><RouterLink
									data-row-action
									:to="`/item/${encodeURIComponent(row.item_code)}?batch=${encodeURIComponent(row.batch_no)}`"
									><b class="primary-text">{{ row.item_name }}</b
									><small class="secondary-text"
										>{{ row.item_code }} · {{ row.batch_no }}</small
									></RouterLink
								>
							</div></template
						>
						<template #cell-expiry_date="{ row }"
							><span :class="{ warn: row.days_to_expiry < 0 }">{{
								row.expiry_date || "无效期"
							}}</span></template
						>
						<template #cell-days_to_expiry="{ row }"
							><span :class="{ warn: row.days_to_expiry < 0 }">{{
								row.days_to_expiry == null
									? "—"
									: formatExpiryDuration(row.days_to_expiry)
							}}</span></template
						>
						<template #cell-total_qty="{ row }"
							><span class="quantity"
								>{{ row.total_qty }} {{ row.stock_uom }}</span
							></template
						>
						<template #cell-locations="{ row }"
							><span
								v-for="location in row.locations"
								:key="location.warehouse"
								class="location-line"
								>{{ warehouseText(location.warehouse) }}：{{ location.qty }}</span
							></template
						>
						<template #mobile-row="{ row }"
							><article
								class="item-card result-card"
								tabindex="0"
								:class="{ 'expiry-overdue-row': row.days_to_expiry < 0 }"
							>
								<RouterLink
									data-row-action
									:to="`/item/${encodeURIComponent(row.item_code)}?batch=${encodeURIComponent(row.batch_no)}`"
									><b>{{ row.item_code }} · {{ row.item_name }}</b>
									<p>
										{{ row.item_group }} · 批次 {{ row.batch_no }} ·
										{{ row.total_qty }} {{ row.stock_uom }}
									</p>
									<p>
										{{ row.expiry_date ? `到期 ${row.expiry_date}` : "无效期"
										}}<span v-if="row.days_to_expiry != null">
											· {{ formatExpiryDuration(row.days_to_expiry) }}</span
										>
									</p></RouterLink
								>
							</article></template
						>
					</SortableDataTable>
					<p
						v-if="view === 'card' && (error || routeValidationError)"
						class="inline-error"
					>
						{{ error || routeValidationError }}
						<button type="button" @click="load()">重试</button>
					</p>
					<div ref="sentinel" aria-hidden="true"></div>
				</div>
			</div>
		</div>
		<Scanner
			v-if="scanner"
			presentation="modal"
			:paused="scanBusy"
			@scan="scan"
			@close="scanner = false"
		/>
		<ExportDialog
			v-model:open="exportOpen"
			report-type="expiry"
			:filters="exportFilters"
			title="导出效期批次"
			summary="沿用当前搜索、类别、位置、库存和效期条件，按批次与位置导出。"
		/>
	</main>
</template>

<style scoped>
.expiry-desktop-page {
	color: #343c46;
	background: #f8f7f4;
}
.mobile-expiry-page {
	display: none;
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
.result-toolbar {
	gap: 7px;
	margin: 0;
	padding: 0;
	background: transparent;
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
	min-height: 34px;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
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
.inventory-view-controls button[aria-pressed="true"] {
	background: #fff;
	color: #665038;
	box-shadow: 0 1px 3px #473a2115;
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
.expiry-card-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(245px, 1fr));
	gap: 12px;
	padding: 12px;
}
.expiry-batch-card {
	display: grid;
	grid-template-columns: 64px 1fr;
	gap: 12px;
	min-height: 126px;
	padding: 12px;
	border: 1px solid var(--border-color, #e2e8f0);
	border-radius: 10px;
	color: inherit;
	text-decoration: none;
	background: #fff;
}
.expiry-batch-card:hover,
.expiry-batch-card:focus-visible {
	border-color: #94a3b8;
	box-shadow: 0 3px 12px rgb(15 23 42 / 0.08);
	outline: none;
}
.expiry-batch-card.overdue {
	border-left: 3px solid #dc2626;
}
.expiry-batch-card.soon {
	border-left: 3px solid #d97706;
}
.expiry-batch-card img,
.expiry-card-placeholder {
	width: 64px;
	height: 64px;
	border-radius: 8px;
	object-fit: cover;
	background: #f1f5f9;
	display: grid;
	place-items: center;
}
.expiry-batch-card h3 {
	margin: 2px 0;
	font-size: 14px;
	line-height: 1.3;
}
.expiry-batch-card p,
.expiry-batch-card small {
	margin: 2px 0;
	color: #64748b;
	font-size: 12px;
}
.expiry-batch-card strong {
	font-size: 15px;
}
.expiry-date {
	margin-top: 8px !important;
}
.location-line {
	display: block;
}
.empty-state,
.inline-error {
	padding: 24px;
	color: #64748b;
}
@media (min-width: 1024px) {
	.expiry-desktop-page {
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
	.results-scroll :deep(.sortable-data-table table) {
		font-size: 14px;
	}
	.results-scroll :deep(.sortable-data-table th) {
		background: #f2f2f0;
		color: #7a7d84;
		font-size: 14px;
	}
	.results-scroll :deep(.sortable-data-table td) {
		height: 57px;
		padding: 5px 10px;
	}
}
@media (max-width: 1023px) {
	.expiry-desktop-page {
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
	.mobile-expiry-page {
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
	.expiry-quick-filters {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 5px;
	}
	.expiry-quick-filters button {
		min-height: 36px;
		padding: 4px;
		border: 1px solid transparent;
		border-radius: 7px;
		background: #efede8;
		color: #6d6c69;
		font-size: 12px;
	}
	.expiry-quick-filters button[aria-pressed="true"] {
		border-color: #dda56d;
		background: #fff8f1;
		color: #a64f19;
		font-weight: 700;
	}
	.expiry-quick-filters span {
		margin-left: 2px;
		font-size: 10px;
	}
	.mobile-results {
		min-height: 0;
		flex: 1;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 4px 8px 16px;
		background: #f8f7f4;
	}
	.mobile-expiry-page.compact .mobile-title-row,
	.mobile-expiry-page.compact .mobile-subnav,
	.mobile-expiry-page.compact :deep(.mobile-summary),
	.mobile-expiry-page.compact .expiry-quick-filters {
		display: none;
	}
	.mobile-expiry-page.compact .mobile-browse-header {
		gap: 5px;
		padding: 7px 8px 4px;
	}
	.mobile-expiry-page.compact .mobile-search-actions > button {
		min-width: 40px;
	}
	.mobile-expiry-page.compact .mobile-search-actions > button span {
		display: none;
	}
	.mobile-expiry-page.compact .compact-page-title {
		display: block;
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
	.expiry-card-grid {
		grid-template-columns: 1fr;
		padding: 8px 0;
	}
	.expiry-batch-card {
		grid-template-columns: 52px 1fr;
	}
	.expiry-batch-card img,
	.expiry-card-placeholder {
		width: 52px;
		height: 52px;
	}
}
</style>
