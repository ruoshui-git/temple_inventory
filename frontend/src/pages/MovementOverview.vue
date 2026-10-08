<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ActiveFilterChips from "../components/ActiveFilterChips.vue";
import CategorySelector from "../components/CategorySelector.vue";
import IconButton from "../components/IconButton.vue";
import ItemImagePreview from "../components/ItemImagePreview.vue";
import MovementPeriodSelector, {
	type MovementPeriodKey,
} from "../components/MovementPeriodSelector.vue";
import ResponsiveFilterPanel from "../components/ResponsiveFilterPanel.vue";
import SortableDataTable, { type SortState } from "../components/SortableDataTable.vue";
import WarehouseSelector from "../components/WarehouseSelector.vue";
import ExportDialog from "../components/ExportDialog.vue";
import { hydrateFilterQuery, sameFilterValue, serializeFilterQuery } from "../composables/filters";
import { api, labels, workspaceApi } from "../lib/api";
import { warehousePresentation } from "../lib/warehousePresenter";

type MovementKind =
	| "Receive"
	| "Issue"
	| "Transfer"
	| "Loan"
	| "Return"
	| "Damage"
	| "Loss"
	| "Repair"
	| "Disposal";
type Filters = {
	search: string;
	period_key: MovementPeriodKey;
	date_from: string;
	date_to: string;
	item_groups: string[];
	warehouses: string[];
	movement_kinds: string[];
};
type Quantity = { uom: string; qty: number };
type ActionSummary = {
	movement_kind: MovementKind;
	quantities: Quantity[];
	item_count: number;
	record_count: number;
};

const actionGroups: Array<{ label: string; kinds: MovementKind[] }> = [
	{ label: "日常流动", kinds: ["Receive", "Issue", "Transfer"] },
	{
		label: "借用与状态变化",
		kinds: ["Loan", "Return", "Damage", "Loss", "Repair", "Disposal"],
	},
];
const allKinds = actionGroups.flatMap((group) => group.kinds);
const route = useRoute();
const router = useRouter();
const boot = ref<any>();
const rows = ref<any[]>([]);
const total = ref(0);
const summaries = ref<ActionSummary[]>([]);
const facets = ref<Record<string, Record<string, number>>>({
	movement_kinds: {},
	item_groups: {},
	warehouses: {},
});
const resolved = ref({ date_from: "", date_to: "" });
const busy = ref(true);
const refreshing = ref(false);
const appending = ref(false);
const error = ref("");
const appendError = ref("");
const filterOpen = ref(false);
const exportOpen = ref(false);
const filterPanel = ref<InstanceType<typeof ResponsiveFilterPanel> | null>(null);
const resultsScroll = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
const pageLength = 25;
const defaultSort: SortState = { sort_by: "last_posting_date", sort_order: "desc" };
const sort = ref<SortState>({ ...defaultSort });
const filters = ref<Filters>({
	search: "",
	period_key: "last_30_days",
	date_from: "",
	date_to: "",
	item_groups: [],
	warehouses: [],
	movement_kinds: [],
});
const columns = [
	{ key: "item_name", label: "物品", sortable: true },
	{ key: "item_group", label: "类别" },
	{ key: "movement_totals", label: "动作明细" },
	{ key: "record_count", label: "相关记录", sortable: true },
	{ key: "last_posting_date", label: "最近变动", sortable: true, initialOrder: "desc" as const },
];
const activeCount = computed(
	() =>
		filters.value.item_groups.length +
		filters.value.warehouses.length +
		filters.value.movement_kinds.length,
);
const warehouseRows = computed(() => boot.value?.physical_tree || []);
const recordTotal = computed(() =>
	filters.value.movement_kinds.length
		? summaries.value
				.filter((summary) => filters.value.movement_kinds.includes(summary.movement_kind))
				.reduce((sum, summary) => sum + summary.record_count, 0)
		: summaries.value.reduce((sum, summary) => sum + summary.record_count, 0),
);
const chips = computed(() => [
	...filters.value.movement_kinds.map((value) => ({
		key: "movement_kinds",
		value,
		label: `动作：${labels[value] || value}`,
	})),
	...filters.value.item_groups.map((value) => ({
		key: "item_groups",
		value,
		label: `类别：${value}`,
	})),
	...filters.value.warehouses.map((value) => ({
		key: "warehouses",
		value,
		label: `位置：${warehousePresentation(value, warehouseRows.value).breadcrumb}`,
	})),
	...(filters.value.search ? [{ key: "search", label: `搜索：${filters.value.search}` }] : []),
]);

let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let sequence = 0;
let syncingRoute = false;
let restoringRoute = false;
let observer: IntersectionObserver | undefined;
let mediaQuery: MediaQueryList | undefined;

const formatQuantity = (value: number) =>
	new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(Number(value || 0));
function actionSummary(kind: MovementKind) {
	return (
		summaries.value.find((summary) => summary.movement_kind === kind) || {
			movement_kind: kind,
			quantities: [],
			item_count: 0,
			record_count: 0,
		}
	);
}
function nonzeroActions(row: any) {
	return allKinds.filter((kind) => Number(row.movement_totals?.[kind] || 0) !== 0);
}
function toggleKind(kind: MovementKind) {
	filters.value.movement_kinds = filters.value.movement_kinds.includes(kind)
		? filters.value.movement_kinds.filter((value) => value !== kind)
		: [...filters.value.movement_kinds, kind];
}
function removeChip(chip: any) {
	const value = filters.value[chip.key as keyof Filters];
	if (Array.isArray(value))
		(filters.value as any)[chip.key] = value.filter((item) => item !== chip.value);
	else (filters.value as any)[chip.key] = "";
}
function clearAll() {
	filters.value.search = "";
	filters.value.item_groups = [];
	filters.value.warehouses = [];
	filters.value.movement_kinds = [];
}
function requestFilters() {
	return {
		period_key: filters.value.period_key,
		date_from: filters.value.period_key === "custom" ? filters.value.date_from : undefined,
		date_to: filters.value.period_key === "custom" ? filters.value.date_to : undefined,
		search: filters.value.search || undefined,
		item_groups: filters.value.item_groups.length ? filters.value.item_groups : undefined,
		warehouses: filters.value.warehouses.length ? filters.value.warehouses : undefined,
		movement_kinds: filters.value.movement_kinds.length
			? filters.value.movement_kinds
			: undefined,
	};
}
const exportFilters = computed(() => ({ ...requestFilters(), ...sort.value }));
function routeQuery() {
	return {
		...serializeFilterQuery({
			period: filters.value.period_key,
			date_from: filters.value.period_key === "custom" ? filters.value.date_from : undefined,
			date_to: filters.value.period_key === "custom" ? filters.value.date_to : undefined,
			search: filters.value.search,
			item_groups: filters.value.item_groups,
			warehouses: filters.value.warehouses,
			actions: filters.value.movement_kinds,
		}),
		...(JSON.stringify(sort.value) === JSON.stringify(defaultSort) ? {} : sort.value),
	};
}
function applyQuery(query: Record<string, unknown>) {
	const hydrated = hydrateFilterQuery(query, {
		period: "last_30_days",
		date_from: "",
		date_to: "",
		posting_date: "",
		search: "",
		item_groups: [] as string[],
		warehouses: [] as string[],
		actions: [] as string[],
	});
	const legacyDate = String(hydrated.posting_date || "");
	const requestedPeriod = legacyDate ? "custom" : String(hydrated.period || "last_30_days");
	const validPeriods = [
		"today",
		"last_7_days",
		"last_30_days",
		"last_90_days",
		"last_365_days",
		"this_week",
		"this_month",
		"this_year",
		"custom",
	];
	const next: Filters = {
		search: String(hydrated.search || ""),
		period_key: (validPeriods.includes(requestedPeriod)
			? requestedPeriod
			: "last_30_days") as MovementPeriodKey,
		date_from: legacyDate || String(hydrated.date_from || ""),
		date_to: legacyDate || String(hydrated.date_to || ""),
		item_groups: hydrated.item_groups as string[],
		warehouses: hydrated.warehouses as string[],
		movement_kinds: (hydrated.actions as string[]).filter((kind) =>
			allKinds.includes(kind as MovementKind),
		),
	};
	const requestedSort = String(query.sort_by || "");
	const requestedOrder = String(query.sort_order || "");
	const nextSort =
		["item_name", "item_code", "record_count", "last_posting_date"].includes(requestedSort) &&
		["asc", "desc"].includes(requestedOrder)
			? { sort_by: requestedSort, sort_order: requestedOrder as "asc" | "desc" }
			: { ...defaultSort };
	const changed = Object.keys(next).some(
		(key) => !sameFilterValue(filters.value[key as keyof Filters], next[key as keyof Filters]),
	);
	const sortChanged =
		sort.value.sort_by !== nextSort.sort_by || sort.value.sort_order !== nextSort.sort_order;
	if (!changed && !sortChanged) return false;
	restoringRoute = true;
	filters.value = next;
	sort.value = nextSort;
	void nextTick(() => {
		restoringRoute = false;
	});
	return true;
}
async function load(append = false, debounce = false) {
	if (!boot.value || (append && (appending.value || rows.value.length >= total.value))) return;
	if (timer) clearTimeout(timer);
	if (!append) controller?.abort();
	const current = ++sequence;
	const requestController = new AbortController();
	if (!append) controller = requestController;
	if (append) appending.value = true;
	else if (rows.value.length) refreshing.value = true;
	else busy.value = true;
	if (append) appendError.value = "";
	else error.value = "";
	const run = async () => {
		try {
			const data = await workspaceApi(
				"movement_overview",
				{
					filters: requestFilters(),
					start: append ? rows.value.length : 0,
					page_length: pageLength,
					...sort.value,
				},
				requestController.signal,
			);
			if (current !== sequence) return;
			const incoming = data.results || [];
			rows.value = append
				? [
						...rows.value,
						...incoming.filter(
							(row: any) =>
								!rows.value.some((old) => old.item_code === row.item_code),
						),
					]
				: incoming;
			total.value = Number(data.total || 0);
			summaries.value = data.action_summaries || [];
			facets.value = data.facets || facets.value;
			resolved.value = {
				date_from: data.resolved_period?.date_from || "",
				date_to: data.resolved_period?.date_to || "",
			};
			if (!append) {
				syncingRoute = true;
				await router.replace({ query: routeQuery() });
				syncingRoute = false;
			}
		} catch (cause: any) {
			syncingRoute = false;
			if (current === sequence && cause?.name !== "AbortError") {
				if (append) appendError.value = cause.message;
				else error.value = cause.message;
			}
		} finally {
			if (current === sequence) {
				busy.value = false;
				refreshing.value = false;
				appending.value = false;
			}
		}
	};
	if (debounce) timer = setTimeout(() => void run(), 300);
	else await run();
}
function setupObserver() {
	observer?.disconnect();
	observer = new IntersectionObserver(
		(entries) => {
			if (entries.some((entry) => entry.isIntersecting)) void load(true);
		},
		{ root: mediaQuery?.matches ? resultsScroll.value : null, rootMargin: "240px" },
	);
	if (sentinel.value) observer.observe(sentinel.value);
}

watch(
	filters,
	(value, previous) => {
		if (!boot.value || restoringRoute) return;
		resultsScroll.value?.scrollTo({ top: 0 });
		void load(false, value.search !== previous.search);
	},
	{ deep: true },
);
watch(
	sort,
	() => {
		if (!boot.value || restoringRoute) return;
		resultsScroll.value?.scrollTo({ top: 0 });
		void load();
	},
	{ deep: true },
);
watch(
	() => route.query,
	(query) => {
		if (!syncingRoute && applyQuery(query as Record<string, unknown>)) void load();
	},
	{ deep: true },
);
onMounted(async () => {
	try {
		boot.value = await api("bootstrap");
		applyQuery(route.query as Record<string, unknown>);
		await load();
		await nextTick();
		if (typeof window.matchMedia === "function") {
			mediaQuery = window.matchMedia("(min-width: 1024px)");
			mediaQuery.addEventListener("change", setupObserver);
		}
		setupObserver();
		const saved = Number(
			sessionStorage.getItem("temple_inventory.scroll.movement-overview") || 0,
		);
		if (saved) resultsScroll.value?.scrollTo({ top: saved });
	} catch (cause: any) {
		error.value = cause.message;
		busy.value = false;
	}
});
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
	controller?.abort();
	observer?.disconnect();
	mediaQuery?.removeEventListener("change", setupObserver);
	if (resultsScroll.value)
		sessionStorage.setItem(
			"temple_inventory.scroll.movement-overview",
			String(resultsScroll.value.scrollTop),
		);
});
</script>

<template>
	<main class="app-shell wide-shell viewport-list-root movement-overview">
		<div class="list-layout desktop-list-layout">
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="activeCount"
			>
				<fieldset>
					<legend>动作</legend>
					<label v-for="kind in allKinds" :key="kind" class="choice-row">
						<input
							type="checkbox"
							:checked="filters.movement_kinds.includes(kind)"
							@change="toggleKind(kind)"
						/>
						<span>{{ labels[kind] }}</span>
					</label>
				</fieldset>
				<CategorySelector
					v-model="filters.item_groups"
					:rows="boot?.item_groups || []"
					:counts="facets.item_groups"
				/>
				<WarehouseSelector
					v-model="filters.warehouses"
					:rows="warehouseRows"
					:counts="facets.warehouses"
					title="位置"
				/>
			</ResponsiveFilterPanel>
			<div class="results-column">
				<div class="results-chrome">
					<MovementPeriodSelector
						v-model:period-key="filters.period_key"
						v-model:date-from="filters.date_from"
						v-model:date-to="filters.date_to"
						:resolved-from="resolved.date_from"
						:resolved-to="resolved.date_to"
					/>
					<div class="result-toolbar">
						<input
							v-model="filters.search"
							type="search"
							placeholder="搜索物品名称或编码"
							aria-label="搜索物品名称或编码"
						/>
						<IconButton
							class="mobile-filter-button"
							:label="activeCount ? `筛选，已启用 ${activeCount} 项` : '筛选'"
							@click="filterPanel?.openPanel($event)"
							><svg aria-hidden="true" viewBox="0 0 24 24">
								<path d="M4 6h16M7 12h10M10 18h4" /></svg
						></IconButton>
						<button type="button" @click="exportOpen = true">导出</button>
						<span aria-live="polite">{{
							refreshing
								? "正在更新…"
								: `涉及 ${total} 种物品 · ${recordTotal} 条记录`
						}}</span>
					</div>
					<ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
					<div class="movement-summary-groups" aria-label="动作汇总">
						<section v-for="group in actionGroups" :key="group.label">
							<h2>{{ group.label }}</h2>
							<div class="movement-summary-grid">
								<button
									v-for="kind in group.kinds"
									:key="kind"
									type="button"
									class="movement-summary-card"
									:aria-pressed="filters.movement_kinds.includes(kind)"
									@click="toggleKind(kind)"
								>
									<small>{{ labels[kind] }}</small>
									<span v-if="busy" class="summary-loading">正在更新…</span>
									<strong v-else-if="actionSummary(kind).quantities.length">
										<span
											v-for="quantity in actionSummary(kind).quantities"
											:key="quantity.uom"
											>{{ formatQuantity(quantity.qty) }}
											{{ quantity.uom }}</span
										>
									</strong>
									<strong v-else>0</strong>
									<span class="summary-counts"
										>{{ actionSummary(kind).item_count }} 种物品 ·
										{{ actionSummary(kind).record_count }} 条记录</span
									>
								</button>
							</div>
						</section>
					</div>
				</div>
				<div ref="resultsScroll" class="results-scroll">
					<SortableDataTable
						:rows="rows"
						:columns="columns"
						row-key="item_code"
						:sort="sort"
						:loading="busy || refreshing"
						:loading-more="appending"
						:error="error"
						empty-message="所选时间和筛选条件下暂无货物流动"
						@sort="sort = $event"
						@activate="
							(row) => router.push(`/item/${encodeURIComponent(row.item_code)}`)
						"
					>
						<template #error
							>{{ error }}
							<button type="button" @click="load()">重试</button></template
						>
						<template #cell-item_name="{ row }">
							<div class="primary-cell">
								<span data-row-control
									><ItemImagePreview :src="row.image" :alt="row.item_name"
								/></span>
								<RouterLink
									data-row-action
									:to="`/item/${encodeURIComponent(row.item_code)}`"
									><b class="primary-text">{{ row.item_name }}</b
									><small class="secondary-text">{{
										row.item_code
									}}</small></RouterLink
								>
							</div>
						</template>
						<template #cell-movement_totals="{ row }">
							<div class="movement-detail-values">
								<span v-for="kind in nonzeroActions(row)" :key="kind">
									{{ labels[kind] }}
									{{ formatQuantity(row.movement_totals[kind]) }}
									{{ row.stock_uom }}
								</span>
							</div>
						</template>
						<template #mobile-row="{ row }">
							<article class="item-card result-card movement-item-card" tabindex="0">
								<span data-row-control
									><ItemImagePreview :src="row.image" :alt="row.item_name"
								/></span>
								<RouterLink
									data-row-action
									:to="`/item/${encodeURIComponent(row.item_code)}`"
								>
									<b>{{ row.item_name }}</b>
									<small>{{ row.item_code }} · {{ row.item_group }}</small>
									<span
										v-for="kind in nonzeroActions(row)"
										:key="kind"
										class="movement-mobile-value"
										>{{ labels[kind] }}
										{{ formatQuantity(row.movement_totals[kind]) }}
										{{ row.stock_uom }}</span
									>
									<small
										>{{ row.record_count }} 条记录 · 最近
										{{ row.last_posting_date }}</small
									>
								</RouterLink>
							</article>
						</template>
					</SortableDataTable>
					<div ref="sentinel" aria-hidden="true"></div>
					<div v-if="appendError" class="table-append-error" role="alert">
						{{ appendError }} <button type="button" @click="load(true)">重试</button>
					</div>
				</div>
			</div>
		</div>
		<ExportDialog
			v-model:open="exportOpen"
			report-type="movement"
			:filters="exportFilters"
			title="导出货物流动"
			summary="沿用当前时间、动作、物品类别、位置、搜索和排序条件，包含汇总与记录明细。"
		/>
	</main>
</template>

<style scoped>
.movement-summary-groups {
	display: grid;
	gap: 8px;
	padding-bottom: 10px;
}
.movement-summary-groups h2 {
	margin: 4px 0 6px;
	font-size: 14px;
	color: #6b6257;
}
.movement-summary-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: 8px;
}
.movement-summary-card {
	display: grid;
	align-content: start;
	gap: 5px;
	min-width: 0;
	min-height: 102px;
	padding: 10px 12px;
	text-align: left;
	background: #fffaf2;
}
.movement-summary-card[aria-pressed="true"] {
	border-color: #9b571d;
	box-shadow: inset 0 0 0 2px #9b571d;
}
.movement-summary-card small,
.summary-counts,
.summary-loading {
	color: #6b6257;
}
.movement-summary-card strong {
	display: flex;
	flex-wrap: wrap;
	gap: 3px 9px;
	font-variant-numeric: tabular-nums;
}
.movement-detail-values {
	display: grid;
	gap: 4px;
	font-variant-numeric: tabular-nums;
}
.movement-item-card {
	align-items: flex-start;
}
.movement-item-card > a {
	display: grid;
	gap: 4px;
}
.movement-mobile-value {
	display: block;
	font-variant-numeric: tabular-nums;
}
@media (max-width: 600px) {
	.movement-summary-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.movement-summary-card {
		min-height: 112px;
	}
}
</style>
