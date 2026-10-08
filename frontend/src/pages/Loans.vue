<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, workspaceApi } from "../lib/api";
import { hydrateFilterQuery, serializeFilterQuery } from "../composables/filters";
import ActiveFilterChips from "../components/ActiveFilterChips.vue";
import SortableDataTable, { type SortState } from "../components/SortableDataTable.vue";
import WarehouseSelector from "../components/WarehouseSelector.vue";
import CategorySelector from "../components/CategorySelector.vue";
import ResponsiveFilterPanel from "../components/ResponsiveFilterPanel.vue";
import ItemImagePreview from "../components/ItemImagePreview.vue";
import IconButton from "../components/IconButton.vue";
import QuantitySummary from "../components/QuantitySummary.vue";
import MovementLookup from "../components/MovementLookup.vue";
import CompactFilterSection from "../components/CompactFilterSection.vue";

const route = useRoute();
const router = useRouter();
const boot = ref<any>();
const activities = ref<any[]>([]);
const activityQuery = ref("");
const rows = ref<any[]>([]);
const total = ref(0);
const quantityTotals = ref<Record<string, Array<{ uom: string; qty: number }>>>({});
const error = ref("");
const loading = ref(false);
const loadingMore = ref(false);
const filterOpen = ref(false);
const desktopFilterOpen = ref(false);
const sentinel = ref<HTMLElement>();
const resultsScroll = ref<HTMLElement>();
const filterPanel = ref<InstanceType<typeof ResponsiveFilterPanel> | null>(null);
const filters = ref({
	search: "",
	loan_date: "",
	item_groups: [] as string[],
	warehouses: [] as string[],
	activity: "",
});
const status = computed(() => (route.query.status === "settled" ? "settled" : "outstanding"));
const sort = ref<SortState>({ sort_by: "loan_date", sort_order: "desc" });
const columns = [
	{ key: "loan_date", label: "借出日期", sortable: true, initialOrder: "desc" as const },
	{ key: "borrower", label: "借用方", sortable: true },
	{ key: "line_count", label: "物品行数", sortable: true },
	{ key: "outstanding_lines", label: "未结物品行数", sortable: true },
	{ key: "activity_title", label: "相关活动" },
	{ key: "loan_status", label: "状态", sortable: true },
];
const statusLabel = (value: string) =>
	(
		({ Outstanding: "未归还", "Partially Returned": "部分归还", Settled: "已结清" }) as Record<
			string,
			string
		>
	)[value] || value;
const summaryMetrics = computed(() => [
	{ key: "loaned_qty", label: "借出", quantities: quantityTotals.value.loaned_qty || [] },
	{
		key: "outstanding_qty",
		label: "未归还",
		quantities: quantityTotals.value.outstanding_qty || [],
	},
]);
const activityOptions = computed(() =>
	activities.value.map((activity) => ({ label: activity.title, value: activity.name })),
);
const activeCount = computed(
	() =>
		(filters.value.search ? 1 : 0) +
		(filters.value.loan_date ? 1 : 0) +
		filters.value.item_groups.length +
		filters.value.warehouses.length +
		(filters.value.activity ? 1 : 0),
);
const chips = computed(() => [
	...filters.value.warehouses.map((value) => ({
		key: "warehouses",
		value,
		label: `位置：${value}`,
	})),
	...filters.value.item_groups.map((value) => ({
		key: "item_groups",
		value,
		label: `类别：${value}`,
	})),
	...(filters.value.search ? [{ key: "search", label: `搜索：${filters.value.search}` }] : []),
	...(filters.value.loan_date
		? [{ key: "loan_date", label: `日期：${filters.value.loan_date}` }]
		: []),
	...(filters.value.activity
		? [
				{
					key: "activity",
					label: `活动：${activityOptions.value.find((option) => option.value === filters.value.activity)?.label || filters.value.activity}`,
				},
			]
		: []),
]);
let observer: IntersectionObserver | undefined;
let mediaQuery: MediaQueryList | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;
let syncingRoute = false;

async function load(append = false) {
	const current = ++sequence;
	if (append) loadingMore.value = true;
	else loading.value = true;
	error.value = "";
	try {
		const data = await api("loans", {
			...filters.value,
			status: status.value,
			start: append ? rows.value.length : 0,
			page_length: 25,
			...sort.value,
		});
		if (current !== sequence) return;
		const incoming = data.results || [];
		rows.value = append
			? [
					...rows.value,
					...incoming.filter(
						(row: any) => !rows.value.some((old) => old.name === row.name),
					),
				]
			: incoming;
		total.value = Number(data.total || 0);
		quantityTotals.value = data.quantity_totals || {};
		if (!append) {
			syncingRoute = true;
			await router.replace({
				query: {
					...(status.value === "settled" ? { status: "settled" } : {}),
					...serializeFilterQuery(filters.value),
					...(sort.value.sort_by === "loan_date" && sort.value.sort_order === "desc"
						? {}
						: sort.value),
				},
			});
			syncingRoute = false;
		}
	} catch (cause: any) {
		syncingRoute = false;
		if (current === sequence) {
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
	timer = setTimeout(() => void load(), 220);
}
function removeChip(chip: any) {
	if (Array.isArray((filters.value as any)[chip.key]))
		(filters.value as any)[chip.key] = (filters.value as any)[chip.key].filter(
			(value: string) => value !== chip.value,
		);
	else (filters.value as any)[chip.key] = "";
}
function clearFilters() {
	filters.value = { search: "", loan_date: "", item_groups: [], warehouses: [], activity: "" };
}
function openFilters(event?: Event) {
	if (typeof window !== "undefined" && window.matchMedia?.("(min-width: 1024px)").matches)
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
				!loading.value &&
				!loadingMore.value
			)
				void load(true);
		},
		{ root: mediaQuery?.matches ? resultsScroll.value : null, rootMargin: "240px" },
	);
	if (sentinel.value) observer.observe(sentinel.value);
}
function openLoan(name: string) {
	void router.push("/loans/" + encodeURIComponent(name));
}
watch(
	[filters, status, sort],
	() => {
		if (boot.value) {
			resultsScroll.value?.scrollTo?.({ top: 0 });
			scheduleLoad();
		}
	},
	{ deep: true },
);
watch(
	() => route.query,
	(query) => {
		if (syncingRoute || !boot.value) return;
		const hydrated = hydrateFilterQuery(query as Record<string, unknown>, {
			search: "",
			loan_date: "",
			item_groups: [] as string[],
			warehouses: [] as string[],
			activity: "",
		});
		const next = {
			search: String(hydrated.search || ""),
			loan_date: String(hydrated.loan_date || ""),
			item_groups: hydrated.item_groups as string[],
			warehouses: hydrated.warehouses as string[],
			activity: String(hydrated.activity || ""),
		};
		if (JSON.stringify(next) !== JSON.stringify(filters.value)) filters.value = next;
		const sortBy = String(query.sort_by || "loan_date"),
			sortOrder = String(query.sort_order || "desc");
		if (
			columns.some((column) => column.key === sortBy && column.sortable) &&
			["asc", "desc"].includes(sortOrder)
		)
			sort.value = { sort_by: sortBy, sort_order: sortOrder as "asc" | "desc" };
	},
	{ deep: true },
);
onMounted(async () => {
	try {
		const [bootstrap, activityData] = await Promise.all([
			api("bootstrap"),
			workspaceApi("activities"),
		]);
		boot.value = bootstrap;
		activities.value = Array.isArray(activityData)
			? activityData
			: Array.isArray(activityData?.results)
				? activityData.results
				: [];
		const hydrated = hydrateFilterQuery(route.query as Record<string, unknown>, {
			search: "",
			loan_date: "",
			item_groups: [] as string[],
			warehouses: [] as string[],
			activity: "",
		});
		filters.value = {
			search: String(hydrated.search || ""),
			loan_date: String(hydrated.loan_date || ""),
			item_groups: hydrated.item_groups as string[],
			warehouses: hydrated.warehouses as string[],
			activity: String(hydrated.activity || ""),
		};
		const sortBy = String(route.query.sort_by || "loan_date"),
			sortOrder = String(route.query.sort_order || "desc");
		if (
			columns.some((column) => column.key === sortBy && column.sortable) &&
			["asc", "desc"].includes(sortOrder)
		)
			sort.value = { sort_by: sortBy, sort_order: sortOrder as "asc" | "desc" };
		await load();
		await nextTick();
		if (typeof window.matchMedia === "function") {
			mediaQuery = window.matchMedia("(min-width: 1024px)");
			mediaQuery.addEventListener("change", setupObserver);
		}
		setupObserver();
	} catch (cause: any) {
		error.value = cause.message;
	}
});
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
	observer?.disconnect();
	mediaQuery?.removeEventListener("change", setupObserver);
});
</script>

<template>
	<section class="app-shell wide-shell viewport-list-root">
		<div
			class="list-layout desktop-list-layout compact-filter-layout"
			:class="{ 'filters-open': desktopFilterOpen }"
		>
			<ResponsiveFilterPanel
				ref="filterPanel"
				v-model:open="filterOpen"
				:count="activeCount"
				clearable
				@clear="clearFilters"
			>
				<CompactFilterSection title="借出日期" icon="calendar" :collapsible="false">
					<fieldset>
						<input v-model="filters.loan_date" type="date" aria-label="借出日期" />
					</fieldset>
				</CompactFilterSection>
				<CompactFilterSection title="原始借出位置" icon="warehouse">
					<WarehouseSelector
						v-model="filters.warehouses"
						:rows="boot?.physical_tree || []"
						embedded
						placeholder="原始借出位置"
					/>
				</CompactFilterSection>
				<CompactFilterSection title="物品类别" icon="card">
					<CategorySelector
						v-model="filters.item_groups"
						:rows="boot?.item_groups || []"
						embedded
						placeholder="物品类别"
					/>
				</CompactFilterSection>
				<CompactFilterSection title="相关活动" icon="calendar">
					<label
						><span class="sr-only">相关活动</span
						><MovementLookup
							v-model="filters.activity"
							v-model:query="activityQuery"
							:options="activityOptions"
							placeholder="搜索活动"
							aria-label="搜索活动"
							@update:query="activityQuery = String($event || '')"
					/></label>
				</CompactFilterSection>
			</ResponsiveFilterPanel>
			<div class="results-column">
				<div class="results-chrome">
					<div class="result-toolbar">
						<input
							v-model="filters.search"
							type="search"
							placeholder="搜索借用方、记录、活动或物品"
							aria-label="搜索借用记录"
						/><button
							type="button"
							class="toolbar-action desktop-filter-button"
							:aria-expanded="desktopFilterOpen"
							@click="openFilters($event)"
						>
							筛选<span v-if="activeCount" class="filter-count">{{
								activeCount
							}}</span></button
						><IconButton
							class="mobile-filter-button"
							:label="activeCount ? `筛选，已启用 ${activeCount} 项` : '筛选'"
							title="筛选"
							@click="openFilters($event)"
							><svg aria-hidden="true" viewBox="0 0 24 24">
								<path d="M4 6h16M7 12h10M10 18h4" /></svg
							><span v-if="activeCount" class="icon-count">{{
								activeCount
							}}</span></IconButton
						><span aria-live="polite"
							>已加载 {{ rows.length }} · 筛选结果 {{ total }}</span
						>
					</div>
					<ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearFilters" />
					<QuantitySummary :metrics="summaryMetrics" :loading="loading" />
				</div>
				<div ref="resultsScroll" class="results-scroll">
					<SortableDataTable
						:rows="rows"
						:columns="columns"
						row-key="name"
						:sort="sort"
						:loading="loading"
						:loading-more="loadingMore"
						:error="error"
						empty-message="没有符合条件的借用记录"
						@sort="sort = $event"
						@activate="(row) => openLoan(row.name)"
					>
						<template #error
							>{{ error }}
							<button type="button" @click="load()">重试</button></template
						>
						<template #cell-activity_title="{ row }">{{
							row.activity_title || row.activity || "—"
						}}</template>
						<template #cell-loan_status="{ row }">{{
							statusLabel(row.loan_status)
						}}</template>
						<template #mobile-row="{ row }"
							><article class="result-card" tabindex="0">
								<RouterLink
									data-row-action
									:to="'/loans/' + encodeURIComponent(row.name)"
									><b>{{ row.borrower }}</b
									><small
										>{{ row.loan_date }} ·
										{{ row.activity_title || row.activity || "无活动" }}</small
									><span
										>物品 {{ row.line_count }} 行 · 未结
										{{ row.outstanding_lines }} 行 ·
										{{ statusLabel(row.loan_status) }}</span
									><span v-for="item in row.items || []" :key="item.loan_item"
										><ItemImagePreview
											:src="item.image"
											:alt="item.item_name"
										/>
										{{ item.item_name }} {{ item.outstanding }}
										{{ item.uom }}</span
									></RouterLink
								>
							</article></template
						>
					</SortableDataTable>
					<div ref="sentinel" aria-hidden="true"></div>
				</div>
			</div>
		</div>
		<button
			v-if="boot?.stock_operation_capabilities?.Loan"
			type="button"
			class="action-fab"
			aria-label="新建借出"
			@click="router.push('/new/Loan')"
		>
			＋
		</button>
	</section>
</template>
