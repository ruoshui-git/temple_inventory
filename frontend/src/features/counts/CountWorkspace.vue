<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { compareTableValues, nextTableSort } from "../../composables/useArrayTableSort";
import FilterPanel from "../../components/ui/FilterPanel.vue";
import HierarchyFilter from "../../components/ui/HierarchyFilter.vue";
import ItemImage from "../../components/ItemImage.vue";
import ItemPicker from "../items/ItemPicker.vue";
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import { warehouseLabel } from "../../lib/warehouseLabel";
import type { HistoryRow } from "../movements/useMovementHistory";
import CountSummary from "./CountSummary.vue";
import type { CountRow } from "./countModel";
import type { CountEditor } from "./useCountEditor";
import DataTable from "../../components/ui/DataTable.vue";
import SearchField from "../../components/ui/SearchField.vue";
import VirtualList from "../../components/ui/VirtualList.vue";
import { useOptionalInventoryServices } from "../../services/contracts";
import type { DataColumn, DataTableEntry, DataTableGroup } from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { showCountRowsOrEmpty } from "../documents/creationFormPresentation";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { unitLabel } from "../../lib/units";
import { formatQuantity } from "../../lib/formatQuantity";
import SerialCountChecklist from "./SerialCountChecklist.vue";
import { serialCountDifference } from "./countModel";

const props = defineProps<{ controller: CountEditor }>();
const emit = defineEmits<{ openDocument: [doctype: string, name: string] }>();
const c = props.controller;
const { isMobile } = useResponsiveLayout();
const services = useOptionalInventoryServices();
const {
	values,
	rows,
	names,
	images,
	reference,
	writable,
	busy,
	baselineBusy,
	baselineError,
	issues,
	showError,
	removed,
	removalAcknowledged,
} = c;
const search = ref("");
const searchTerm = ref("");
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, (value) => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => (searchTerm.value = value), 200);
});
const reviewFilter = ref<"all" | "unreviewed" | "difference">("all");
const groupBy = ref<"location" | "item" | "none">("location");
const collapsedGroups = ref(new Set<string>());
const serialDetailExpansion = ref(new Map<string, boolean>());
const selectedLocations = ref<string[]>(c.warehouseFilter ? [c.warehouseFilter] : []);
const sortBy = ref<"location" | "item_name" | "item_code" | "batch">("location");
const sortDirection = ref<1 | -1>(1);
const pageSize = 100;
const visiblePage = ref(1);
const pickerOpen = ref(false);
const notesTarget = ref<CountRow>();
const historyTarget = computed(() => c.historyTarget.value);
const historyRows = computed(() => c.history.result.rows as HistoryRow[]);
const physicalLocations = computed(() => {
	const warehouses = reference.warehouses;
	const leaves = new Set(reference.physicalLeaves);
	return warehouses.filter(
		(warehouse) =>
			leaves.has(warehouse.name) ||
			Boolean(
				warehouse.is_group &&
				warehouses.some(
					(leaf) =>
						leaves.has(leaf.name) &&
						Number(warehouse.lft || 0) < Number(leaf.lft || 0) &&
						Number(warehouse.rgt || 0) > Number(leaf.rgt || 0),
				),
			),
	);
});
const warehouseByName = computed(
	() => new Map(reference.warehouses.map((row) => [row.name, row])),
);
const warehouseLabels = computed(
	() =>
		new Map(
			reference.warehouses.map((row) => [
				row.name,
				warehouseLabel(row.name, reference.warehouses),
			]),
		),
);
function leafScope(row: CountRow) {
	if (!selectedLocations.value.length) return true;
	return selectedLocations.value.some((name) => {
		if (name === row.warehouse) return true;
		const parent = warehouseByName.value.get(name);
		const target = warehouseByName.value.get(row.warehouse);
		return Boolean(
			parent?.is_group &&
			target &&
			Number(parent.lft || 0) < Number(target.lft || 0) &&
			Number(parent.rgt || 0) > Number(target.rgt || 0),
		);
	});
}
const filteredRows = computed(() => {
	const term = searchTerm.value.trim().toLocaleLowerCase();
	return rows.value.filter((row) => {
		if (!leafScope(row)) return false;
		if (reviewFilter.value === "unreviewed" && row.review_state !== "Unreviewed") return false;
		if (
			reviewFilter.value === "difference" &&
			(row.review_state !== "Reviewed" ||
				row.actual_qty === null ||
				(row.is_serial
					? !serialCountDifference(row).missing.length &&
						!serialCountDifference(row).found.length
					: row.actual_qty === row.baseline_qty))
		)
			return false;
		const location = warehouseLabels.value.get(row.warehouse) || row.warehouse;
		return (
			!term ||
			`${location} ${row.item_name || names[row.item_code] || ""} ${row.item_code} ${row.batch_no || ""}`
				.toLocaleLowerCase()
				.includes(term)
		);
	});
});
const sortedRows = computed(() =>
	[...filteredRows.value].sort((left, right) => {
		if (groupBy.value !== "none") {
			const leftGroup =
				groupBy.value === "location"
					? warehouseLabels.value.get(left.warehouse) || left.warehouse
					: left.item_name || names[left.item_code] || left.item_code;
			const rightGroup =
				groupBy.value === "location"
					? warehouseLabels.value.get(right.warehouse) || right.warehouse
					: right.item_name || names[right.item_code] || right.item_code;
			const groupOrder = compareTableValues(leftGroup, rightGroup);
			if (groupOrder) return groupOrder;
		}
		const values = {
			location: [
				warehouseLabels.value.get(left.warehouse) || left.warehouse,
				warehouseLabels.value.get(right.warehouse) || right.warehouse,
			],
			item_name: [
				left.item_name || names[left.item_code] || left.item_code,
				right.item_name || names[right.item_code] || right.item_code,
			],
			item_code: [left.item_code, right.item_code],
			batch: [left.batch_no || "", right.batch_no || ""],
		}[sortBy.value];
		const primary = compareTableValues(values[0], values[1]) * sortDirection.value;
		if (primary) return primary;
		const stable = [
			[
				warehouseLabels.value.get(left.warehouse) || left.warehouse,
				warehouseLabels.value.get(right.warehouse) || right.warehouse,
			],
			[
				left.item_name || names[left.item_code] || left.item_code,
				right.item_name || names[right.item_code] || right.item_code,
			],
			[left.batch_no || "", right.batch_no || ""],
		];
		for (const [first, second] of stable) {
			const order = compareTableValues(first, second);
			if (order) return order;
		}
		return compareTableValues(c.countKey(left), c.countKey(right));
	}),
);
const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize)));
const visibleRows = computed(() =>
	sortedRows.value.slice((visiblePage.value - 1) * pageSize, visiblePage.value * pageSize),
);
const virtualCountList = ref<{
	scrollToIndex: (index: number, focus?: boolean, selector?: string) => Promise<void>;
}>();
const groupCounts = computed(() => {
	const counts = new Map<string, number>();
	if (groupBy.value === "none") return counts;
	for (const row of sortedRows.value) {
		const key = groupBy.value === "location" ? row.warehouse : row.item_code;
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	return counts;
});
const countColumns = computed<DataColumn[]>(() => [
	{ id: "location", label: "位置", sortable: true },
	{ id: "image", label: "图片", defaultVisible: true },
	{ id: "item_name", label: "物品名称", sortable: true, required: true },
	{ id: "item_code", label: "物品编码", sortable: true, required: true },
	{ id: "batch", label: "批次", sortable: true },
	{ id: "stock_uom", label: "库存单位" },
	{ id: "baseline_qty", label: "账面数量", align: "end" },
	{ id: "actual_qty", label: "实点数量", required: true, className: "count-actual-column" },
	{ id: "difference", label: "差异", align: "end" },
	{ id: "actions", label: "操作", required: true },
]);
const countColumnPreferences = services
	? useColumnPreferences("count.workspace", countColumns, reference, services)
	: undefined;
function serialDetailId(row: CountRow) {
	return `count-serial-detail:${c.countKey(row)}`;
}
function isSerialDetailGroup(group: DataTableGroup) {
	return group.id.startsWith("count-serial-detail:") && Boolean(group.value);
}
function serialDetailValue(group: DataTableGroup) {
	return group.value as unknown as CountRow;
}
function serialDetailExpanded(row: CountRow) {
	return (
		serialDetailExpansion.value.get(serialDetailId(row)) ??
		(!hasCountInput(row) || Boolean(serialDifferenceLabel(row)))
	);
}
function toggleSerialDetail(row: CountRow) {
	serialDetailExpansion.value.set(serialDetailId(row), !serialDetailExpanded(row));
}
function countTableEntry(row: CountRow): DataTableEntry {
	if (!row.is_serial) return { kind: "record", id: c.countKey(row), value: row };
	const expanded = serialDetailExpanded(row);
	return {
		kind: "group",
		id: serialDetailId(row),
		label: "",
		labelColumn: "location",
		depth: 0,
		count: 1,
		expanded,
		hasChildren: true,
		detailRow: expanded,
		value: row,
	};
}
const countTableRows = computed<DataTableEntry[]>(() => {
	const page = visibleRows.value;
	if (groupBy.value === "none") return page.map(countTableEntry);
	const groups = new Map<string, CountRow[]>();
	for (const row of page) {
		const key = groupBy.value === "location" ? row.warehouse : row.item_code;
		groups.set(key, [...(groups.get(key) || []), row]);
	}
	const result: DataTableEntry[] = [];
	for (const [key, grouped] of groups) {
		const location = groupBy.value === "location";
		result.push({
			kind: "group",
			id: `count-group:${groupBy.value}:${key}`,
			label: location
				? warehouseLabels.value.get(key) || key
				: grouped[0]?.item_name || names[key] || key,
			labelColumn: "item_name",
			countColumn: "item_name",
			depth: 0,
			count: groupCounts.value.get(key) || grouped.length,
			countLabel: "行",
			expanded: !collapsedGroups.value.has(`count-group:${groupBy.value}:${key}`),
			hasChildren: grouped.length > 0,
		});
		if (collapsedGroups.value.has(`count-group:${groupBy.value}:${key}`)) continue;
		for (const row of grouped) result.push(countTableEntry(row));
	}
	return result;
});
function toggleCountGroup(id: string) {
	if (id.startsWith("count-serial-detail:")) {
		const row = rows.value.find((item) => serialDetailId(item) === id);
		if (row) toggleSerialDetail(row);
		return;
	}
	const next = new Set(collapsedGroups.value);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	collapsedGroups.value = next;
}
const countEmptyText = computed(() =>
	rows.value.length ? "没有符合当前搜索和筛选条件的行。" : "此范围没有库存行。",
);
const hiddenEntered = computed(() => {
	const visibleKeys = new Set(filteredRows.value.map(c.countKey));
	return rows.value.filter((row) => hasCountInput(row) && !visibleKeys.has(c.countKey(row)))
		.length;
});

function hasCountInput(row: CountRow): row is CountRow & { actual_qty: number } {
	return (
		row.actual_qty !== null && (row.review_state === "Reviewed" || row.needs_review === true)
	);
}
watch([selectedLocations, search, reviewFilter, groupBy], () => {
	visiblePage.value = 1;
});
watch(pageCount, (count) => {
	if (visiblePage.value > count) visiblePage.value = count;
});
function sort(field: "location" | "item_name" | "item_code" | "batch") {
	const next = nextTableSort(field, sortBy.value, sortDirection.value === 1 ? "asc" : "desc");
	sortBy.value = next.field as typeof sortBy.value;
	sortDirection.value = next.direction === "asc" ? 1 : -1;
	visiblePage.value = 1;
}
function countRowAttributes(row: Record<string, unknown>) {
	return { "data-count-key": c.countKey(row as unknown as CountRow) };
}
function input(row: CountRow, event: Event) {
	c.input(row, (event.target as HTMLInputElement).value);
}
function clear(row: CountRow) {
	c.clearInput(row);
}
function serialsChanged(row: CountRow, serials: string[] | null) {
	c.setSerials(row, serials);
}
function serialDifferenceLabel(row: CountRow) {
	const difference = serialCountDifference(row);
	return [
		difference.missing.length ? `缺少 ${difference.missing.length}` : "",
		difference.found.length ? `多出 ${difference.found.length}` : "",
	]
		.filter(Boolean)
		.join(" · ");
}
async function nextCountInput(event: KeyboardEvent) {
	event.preventDefault();
	const current = event.currentTarget as HTMLInputElement;
	const virtualIndex = Number(
		current.closest<HTMLElement>("[data-virtual-index]")?.dataset.virtualIndex,
	);
	if (visibleRows.value.length > 80 && Number.isFinite(virtualIndex)) {
		if (virtualIndex + 1 < visibleRows.value.length) {
			await virtualCountList.value?.scrollToIndex(
				virtualIndex + 1,
				true,
				".count-card-input:not(:disabled)",
			);
		} else if (visiblePage.value < pageCount.value) {
			visiblePage.value++;
			await nextTick();
			await virtualCountList.value?.scrollToIndex(
				0,
				true,
				".count-card-input:not(:disabled)",
			);
		}
		return;
	}
	const inputs = Array.from(
		current
			.closest(".count-card-list")
			?.querySelectorAll<HTMLInputElement>(".count-card-input:not(:disabled)") || [],
	);
	const index = inputs.indexOf(current);
	if (index >= 0 && index < inputs.length - 1) {
		inputs[index + 1]?.focus();
		return;
	}
	if (visiblePage.value < pageCount.value && index === inputs.length - 1) {
		visiblePage.value++;
		await nextTick();
		(
			document.querySelector(".count-card-input:not(:disabled)") as HTMLInputElement | null
		)?.focus();
	}
}
watch([showError, issues], async ([shown, currentIssues]) => {
	if (!shown || !currentIssues.length) return;
	const index = sortedRows.value.findIndex((row) => c.countKey(row) === currentIssues[0]!.key);
	if (index < 0) return;
	visiblePage.value = Math.floor(index / pageSize) + 1;
	await nextTick();
	if (isMobile.value) {
		await virtualCountList.value?.scrollToIndex(
			index % pageSize,
			true,
			"input:not(:disabled)",
		);
	} else {
		Array.from(document.querySelectorAll<HTMLElement>("[data-count-key]"))
			.find((element) => element.dataset.countKey === currentIssues[0]!.key)
			?.scrollIntoView({ block: "center" });
	}
});
function itemImage(row: CountRow) {
	return {
		code: row.item_code,
		name: row.item_name || names[row.item_code] || row.item_code,
		image: images[row.item_code] || row.image || "",
		category: "",
		uom: row.stock_uom,
		tracksBatch: Boolean(row.batch_no),
		tracksExpiry: false,
		locations: [],
		available: 0,
		loaned: 0,
		damaged: 0,
	};
}
</script>

<template>
	<section class="count-workspace">
		<div class="count-filter-bar">
			<UiButton :disabled="busy || baselineBusy" @click="pickerOpen = true"
				>添加物品</UiButton
			>
			<UiButton :disabled="busy || baselineBusy" :loading="baselineBusy" @click="c.refresh"
				>刷新账面</UiButton
			>
			<FilterPanel label="位置" :count="selectedLocations.length" context="count-location">
				<HierarchyFilter
					v-model="selectedLocations"
					:options="physicalLocations"
					title="显示位置"
					placeholder="搜索位置"
					embedded
					initial-expansion="branching-leaves"
				/>
			</FilterPanel>
			<SearchField
				class="count-search"
				v-model="search"
				label="搜索物品、批次或位置"
				placeholder="输入物品名称、编码、批次或位置"
			/>
			<label class="form-field count-group-by"
				>分组方式<select v-model="groupBy">
					<option value="location">位置</option>
					<option value="item">物品</option>
					<option value="none">不分组</option>
				</select></label
			>
			<div class="segmented" role="group" aria-label="核对状态筛选">
				<button
					type="button"
					:aria-pressed="reviewFilter === 'all'"
					@click="reviewFilter = 'all'"
				>
					全部
				</button>
				<button
					type="button"
					:aria-pressed="reviewFilter === 'unreviewed'"
					@click="reviewFilter = 'unreviewed'"
				>
					未核对
				</button>
				<button
					type="button"
					:aria-pressed="reviewFilter === 'difference'"
					@click="reviewFilter = 'difference'"
				>
					有差异
				</button>
			</div>
		</div>
		<div class="count-toolbar" data-table-settings-outlet>
			<strong>{{ filteredRows.length }} / {{ rows.length }} 行</strong>
			<span v-if="hiddenEntered">已隐藏 {{ hiddenEntered }} 条有输入的记录</span>
			<span v-if="removed.length">{{ removed.length }} 行已移出基准</span>
		</div>
		<p v-if="baselineError" role="alert" class="notice-bar danger">{{ baselineError }}</p>
		<p v-if="showError && issues.length" role="alert" class="notice-bar danger">
			{{ issues.length }} 行实点数量需要修正。
		</p>
		<CountSummary :rows="rows" :mobile="isMobile" />
		<section v-if="removed.length" class="notice-bar warning count-removed">
			<div>
				<strong>已移出账面范围的原输入</strong>
				<p>这些行保留在本次输入中，不会纳入调整。请确认后继续。</p>
			</div>
			<p v-for="(row, index) in removed" :key="index">
				{{ row.item_name || names[row.item_code] || row.item_code }} ·
				{{ warehouseLabel(row.warehouse, reference.warehouses) }} ·
				{{ row.batch_no || "无批次" }} ·
				{{ row.actual_qty ?? "未核对" }}
				{{ unitLabel(String(row.stock_uom || "")) }}
			</p>
			<label v-if="writable" class="form-choice-label">
				<input v-model="removalAcknowledged" type="checkbox" />已核对移出的输入
			</label>
		</section>
		<p v-if="baselineBusy" class="muted count-baseline-status" role="status">
			正在刷新账面基准…
		</p>
		<div
			v-if="isMobile && showCountRowsOrEmpty(!!baselineError, rows.length)"
			class="count-card-list"
			:class="{ 'is-refreshing': baselineBusy }"
			:aria-busy="baselineBusy ? 'true' : undefined"
			:inert="baselineBusy || undefined"
		>
			<p v-if="baselineBusy" class="sr-only" role="status">正在刷新账面基准…</p>
			<p v-if="!visibleRows.length" class="data-table-state">{{ countEmptyText }}</p>
			<VirtualList
				ref="virtualCountList"
				:keys="visibleRows.map(c.countKey)"
				:estimate="210"
				:threshold="80"
				:gap="12"
				tab-through=".count-card-input:not(:disabled), .serial-count input:not(:disabled)"
			>
				<template #default="{ index }">
					<article
						v-for="row in [visibleRows[index]]"
						:key="c.countKey(row)"
						class="count-card"
						:data-count-key="c.countKey(row)"
					>
						<div class="count-card-heading">
							<div class="count-card-image">
								<ItemImage :item="itemImage(row)" />
							</div>
							<div class="count-card-identity">
								<strong>{{
									row.item_name || names[row.item_code] || row.item_code
								}}</strong>
								<small
									>{{ row.item_code
									}}<template v-if="row.batch_no">
										· {{ row.batch_no }}</template
									></small
								>
								<small class="count-card-location">{{
									warehouseLabel(row.warehouse, reference.warehouses)
								}}</small>
							</div>
						</div>
						<div class="count-card-counts" :class="{ 'is-serial': row.is_serial }">
							<div class="count-card-book">
								<span>账面</span
								><strong
									>{{ row.baseline_qty }}
									{{ unitLabel(String(row.stock_uom || "")) }}</strong
								>
							</div>
							<div class="count-card-entry">
								<template v-if="row.is_serial">
									<label>实点序列号</label>
									<SerialCountChecklist
										:row="row"
										:writable="writable"
										:busy="busy || baselineBusy"
										@update="serialsChanged(row, $event)"
									/>
									<details
										v-if="hasCountInput(row) && serialDifferenceLabel(row)"
										class="serial-count-difference"
									>
										<summary>{{ serialDifferenceLabel(row) }}</summary>
										<p v-if="serialCountDifference(row).missing.length">
											缺少：{{
												serialCountDifference(row).missing.join("、")
											}}
										</p>
										<p v-if="serialCountDifference(row).found.length">
											多出：{{ serialCountDifference(row).found.join("、") }}
										</p>
									</details>
								</template>
								<template v-else>
									<label
										:for="`count-input-${encodeURIComponent(c.countKey(row))}`"
										>实点数量</label
									>
									<input
										v-if="writable"
										:id="`count-input-${encodeURIComponent(c.countKey(row))}`"
										class="count-card-input"
										type="number"
										inputmode="decimal"
										enterkeyhint="next"
										min="0"
										:step="
											reference.units.find(
												(unit) => unit.name === row.stock_uom,
											)?.whole
												? 1
												: 'any'
										"
										:value="hasCountInput(row) ? row.actual_qty : ''"
										:disabled="busy || baselineBusy"
										:aria-label="`${row.item_name || names[row.item_code] || row.item_code}实点数量`"
										:aria-invalid="
											showError &&
											issues.some((issue) => issue.key === c.countKey(row))
										"
										@input="input(row, $event)"
										@keydown.enter="nextCountInput"
									/>
									<strong v-else
										>{{ hasCountInput(row) ? row.actual_qty : "未核对" }}
										{{ unitLabel(String(row.stock_uom || "")) }}</strong
									>
									<span
										v-if="
											hasCountInput(row) &&
											row.actual_qty !== row.baseline_qty
										"
										class="count-card-difference"
										:class="
											row.actual_qty! > row.baseline_qty
												? 'count-difference-positive'
												: 'count-difference-negative'
										"
										>差异 {{ row.actual_qty! - row.baseline_qty > 0 ? "+" : ""
										}}{{ row.actual_qty! - row.baseline_qty }}</span
									>
									<span
										v-else-if="!hasCountInput(row)"
										class="count-card-pending"
										>未核对</span
									>
								</template>
							</div>
						</div>
						<div
							v-if="row.needs_review && row.actual_qty !== null"
							class="count-baseline-warning"
						>
							<span>基准已变化</span>
							<button
								type="button"
								:disabled="busy || baselineBusy"
								@click="c.rereview(row)"
							>
								确认仍按当前实点
							</button>
						</div>
						<div class="count-card-actions">
							<UiButton
								size="compact"
								:disabled="busy || baselineBusy"
								@click="c.openHistory(row)"
								>历史</UiButton
							>
							<UiButton
								v-if="writable"
								size="compact"
								:disabled="busy || baselineBusy"
								@click="clear(row)"
								>清除</UiButton
							>
							<UiButton
								v-if="writable || row.reason"
								size="compact"
								@click="notesTarget = row"
								>备注</UiButton
							>
						</div>
					</article>
				</template>
			</VirtualList>
		</div>
		<DataTable
			sticky-header
			v-else-if="!isMobile && showCountRowsOrEmpty(!!baselineError, rows.length)"
			class="count-data-table"
			:style="{ '--data-table-sticky-top': 'var(--app-desktop-nav-height, 0px)' }"
			ariaLabel="盘点明细"
			table-class="count-table"
			:columns="countColumns"
			:rows="countTableRows"
			:loading="baselineBusy"
			:initialized="!baselineBusy || rows.length > 0"
			:row-key="(row) => c.countKey(row as unknown as CountRow)"
			:row-attributes="countRowAttributes"
			:empty-text="countEmptyText"
			:sort-by="sortBy"
			:sort-direction="sortDirection === 1 ? 'asc' : 'desc'"
			:column-preferences="countColumnPreferences"
			@sort="sort($event as 'location' | 'item_name' | 'item_code' | 'batch')"
			@toggle-group="toggleCountGroup"
		>
			<template #cell="{ column, row }">
				<template v-if="column.id === 'location'">{{
					warehouseLabel(String(row.warehouse || ""), reference.warehouses)
				}}</template>
				<div v-else-if="column.id === 'image'" class="count-item-thumbnail">
					<ItemImage :item="itemImage(row as unknown as CountRow)" />
				</div>
				<strong v-else-if="column.id === 'item_name'">{{
					row.item_name || names[String(row.item_code || "")] || row.item_code
				}}</strong>
				<template v-else-if="column.id === 'item_code'">{{ row.item_code }}</template>
				<template v-else-if="column.id === 'batch'">{{ row.batch_no || "—" }}</template>
				<template v-else-if="column.id === 'stock_uom'">{{
					unitLabel(String(row.stock_uom || ""))
				}}</template>
				<template v-else-if="column.id === 'baseline_qty'">{{
					row.baseline_qty
				}}</template>
				<div v-else-if="column.id === 'actual_qty'" class="count-actual-cell">
					<template v-if="(row as unknown as CountRow).is_serial">
						<span
							>实点 {{ (row as unknown as CountRow).actual_qty ?? "—" }} / 账面
							{{ (row as unknown as CountRow).baseline_qty }}</span
						>
						<button
							type="button"
							class="serial-count-row-toggle"
							:aria-expanded="serialDetailExpanded(row as unknown as CountRow)"
							@click.stop="toggleSerialDetail(row as unknown as CountRow)"
						>
							{{
								serialDetailExpanded(row as unknown as CountRow) ? "收起" : "展开"
							}}
						</button>
					</template>
					<template v-else>
						<input
							v-if="writable"
							class="count-actual-input"
							type="number"
							inputmode="decimal"
							enterkeyhint="next"
							min="0"
							:step="
								reference.units.find((unit) => unit.name === row.stock_uom)?.whole
									? 1
									: 'any'
							"
							:value="
								hasCountInput(row as unknown as CountRow) ? row.actual_qty : ''
							"
							:disabled="busy || baselineBusy"
							:aria-label="`${row.item_name || names[String(row.item_code || '')] || row.item_code}实点数量`"
							:aria-invalid="
								showError &&
								issues.some(
									(issue) =>
										issue.key === c.countKey(row as unknown as CountRow),
								)
							"
							@input="input(row as unknown as CountRow, $event)"
						/>
						<span v-else>{{
							row.review_state === "Unreviewed" ? "未核对" : row.actual_qty
						}}</span>
					</template>
					<div
						v-if="row.needs_review && row.actual_qty !== null"
						class="count-baseline-warning"
					>
						<span>基准已变化</span>
						<button
							type="button"
							:disabled="busy || baselineBusy"
							@click="c.rereview(row as unknown as CountRow)"
						>
							确认仍按当前实点
						</button>
					</div>
				</div>
				<span
					v-else-if="column.id === 'difference'"
					:class="[
						'stock-effect',
						!hasCountInput(row as unknown as CountRow)
							? ''
							: Number(row.actual_qty) > Number(row.baseline_qty)
								? 'is-increase'
								: Number(row.actual_qty) < Number(row.baseline_qty)
									? 'is-decrease'
									: 'is-neutral',
					]"
					>{{
						hasCountInput(row as unknown as CountRow)
							? (row as unknown as CountRow).is_serial
								? serialDifferenceLabel(row as unknown as CountRow) || "一致"
								: `${Number(row.actual_qty) > Number(row.baseline_qty) ? "+" : Number(row.actual_qty) < Number(row.baseline_qty) ? "−" : ""}${formatQuantity(Math.abs(Number(row.actual_qty) - Number(row.baseline_qty)))}`
							: "待核对"
					}}</span
				>
				<div v-else-if="column.id === 'actions'" class="count-row-actions-inner">
					<UiButton
						size="compact"
						:disabled="busy || baselineBusy"
						@click="c.openHistory(row as unknown as CountRow)"
						>历史</UiButton
					>
					<UiButton
						v-if="writable"
						size="compact"
						:disabled="busy || baselineBusy"
						@click="clear(row as unknown as CountRow)"
						>清除输入</UiButton
					>
					<UiButton
						v-if="writable || row.reason"
						size="compact"
						@click="notesTarget = row as unknown as CountRow"
						>备注</UiButton
					>
				</div>
			</template>
			<template #group-label="{ group }">
				<span v-if="isSerialDetailGroup(group)">{{
					warehouseLabel(serialDetailValue(group).warehouse, reference.warehouses)
				}}</span>
			</template>
			<template #group-column="{ group, column }">
				<template v-if="isSerialDetailGroup(group)">
					<template v-if="column.id === 'image'">
						<div class="count-item-thumbnail">
							<ItemImage :item="itemImage(serialDetailValue(group))" />
						</div>
					</template>
					<strong v-else-if="column.id === 'item_name'">{{
						serialDetailValue(group).item_name ||
						names[serialDetailValue(group).item_code] ||
						serialDetailValue(group).item_code
					}}</strong>
					<template v-else-if="column.id === 'item_code'">{{
						serialDetailValue(group).item_code
					}}</template>
					<template v-else-if="column.id === 'batch'">{{
						serialDetailValue(group).batch_no || "—"
					}}</template>
					<template v-else-if="column.id === 'stock_uom'">{{
						unitLabel(serialDetailValue(group).stock_uom)
					}}</template>
					<template v-else-if="column.id === 'baseline_qty'">{{
						serialDetailValue(group).baseline_qty
					}}</template>
					<div v-else-if="column.id === 'actual_qty'" class="serial-count-row-summary">
						<span
							>实点 {{ serialDetailValue(group).actual_qty ?? "—" }} / 账面
							{{ serialDetailValue(group).baseline_qty }}</span
						>
						<button
							type="button"
							class="serial-count-row-toggle"
							:aria-expanded="serialDetailExpanded(serialDetailValue(group))"
							@click.stop="toggleSerialDetail(serialDetailValue(group))"
						>
							{{ serialDetailExpanded(serialDetailValue(group)) ? "收起" : "展开" }}
						</button>
					</div>
					<span v-else-if="column.id === 'difference'" class="stock-effect">{{
						hasCountInput(serialDetailValue(group))
							? serialDifferenceLabel(serialDetailValue(group)) || "一致"
							: "待核对"
					}}</span>
					<div v-else-if="column.id === 'actions'" class="count-row-actions-inner">
						<UiButton
							size="compact"
							:disabled="busy || baselineBusy"
							@click="c.openHistory(serialDetailValue(group))"
							>历史</UiButton
						>
						<UiButton
							v-if="writable"
							size="compact"
							:disabled="busy || baselineBusy"
							@click="clear(serialDetailValue(group))"
							>清除输入</UiButton
						>
						<UiButton
							v-if="writable || serialDetailValue(group).reason"
							size="compact"
							@click="notesTarget = serialDetailValue(group)"
							>备注</UiButton
						>
					</div>
				</template>
			</template>
			<template #group="{ group }">
				<div v-if="isSerialDetailGroup(group)" class="serial-count-detail-row">
					<SerialCountChecklist
						:row="serialDetailValue(group)"
						:writable="writable"
						:busy="busy || baselineBusy"
						@update="serialsChanged(serialDetailValue(group), $event)"
					/>
					<details
						v-if="
							hasCountInput(serialDetailValue(group)) &&
							serialDifferenceLabel(serialDetailValue(group))
						"
						class="serial-count-difference"
					>
						<summary>{{ serialDifferenceLabel(serialDetailValue(group)) }}</summary>
						<p v-if="serialCountDifference(serialDetailValue(group)).missing.length">
							缺少：{{
								serialCountDifference(serialDetailValue(group)).missing.join("、")
							}}
						</p>
						<p v-if="serialCountDifference(serialDetailValue(group)).found.length">
							多出：{{
								serialCountDifference(serialDetailValue(group)).found.join("、")
							}}
						</p>
					</details>
				</div>
			</template>
		</DataTable>
		<div v-if="pageCount > 1" class="count-pagination">
			<UiButton :disabled="visiblePage <= 1" @click="visiblePage--">上一页</UiButton>
			<span>{{ visiblePage }} / {{ pageCount }}</span>
			<UiButton :disabled="visiblePage >= pageCount" @click="visiblePage++">下一页</UiButton>
		</div>
		<ItemPicker
			v-if="pickerOpen"
			mode="add-multiple"
			purpose="count"
			@close="pickerOpen = false"
			@select-multiple="
				(selections) => {
					pickerOpen = false;
					c.chooseItems(selections);
				}
			"
		/>
		<Overlay
			v-if="historyTarget"
			:title="`${historyTarget.item_name || names[historyTarget.item_code] || historyTarget.item_code} · 提交历史`"
			@close="c.closeHistory"
		>
			<p>
				{{ warehouseLabel(historyTarget.warehouse, reference.warehouses)
				}}<template v-if="historyTarget.batch_no">
					· {{ historyTarget.batch_no }}</template
				>
			</p>
			<MovementHistoryTable
				:rows="historyRows"
				:total="c.history.result.total"
				:next="c.history.result.next"
				:loading="c.history.result.loading"
				:error="c.history.result.error"
				:initialized="c.history.result.initialized"
				:stale="c.history.result.stale"
				:sort-by="c.history.sortBy.value"
				:sort-direction="c.history.sortDirection.value"
				:show-status="false"
				@load-more="c.history.loadMore"
				@retry="c.history.retry"
				@sort="c.history.setSort"
				@open-document="(doctype, name) => emit('openDocument', doctype, name)"
				@open-loan="(name) => emit('openDocument', 'Stock Entry', name)"
			/>
		</Overlay>
		<Overlay v-if="notesTarget" title="盘点行备注" @close="notesTarget = undefined">
			<p>
				{{
					notesTarget.item_name || names[notesTarget.item_code] || notesTarget.item_code
				}}
				· {{ warehouseLabel(notesTarget.warehouse, reference.warehouses) }}
			</p>
			<label class="form-field"
				>差异原因<textarea
					v-model="notesTarget.reason"
					rows="3"
					:disabled="!writable || busy || baselineBusy"
				/>
			</label>
			<template #footer><UiButton @click="notesTarget = undefined">完成</UiButton></template>
		</Overlay>
	</section>
</template>

<style scoped>
.count-workspace {
	display: grid;
	gap: var(--p-gap);
	min-width: 0;
}
.count-filter-bar,
.count-toolbar,
.count-pagination {
	display: flex;
	align-items: center;
	gap: var(--p-control-gap);
}
.count-filter-bar {
	flex-wrap: wrap;
	align-items: end;
}
.count-search {
	flex: 1 1 260px;
	min-width: 220px;
}
.count-toolbar {
	flex-wrap: wrap;
	color: var(--p-muted);
	font-size: var(--p-body);
}
.count-table {
	min-width: 990px;
}
.count-item-content {
	display: flex;
	align-items: center;
	gap: var(--p-control-gap);
}
.count-item-thumbnail {
	width: var(--p-table-thumbnail);
	height: var(--p-table-thumbnail);
	flex: 0 0 var(--p-table-thumbnail);
	overflow: hidden;
}
.count-item-content strong,
.count-item-content small {
	display: block;
}
.count-item-content strong {
	max-width: 250px;
	overflow-wrap: anywhere;
}
.count-item-content small {
	color: var(--p-muted);
}
.count-actual-cell {
	display: grid;
	justify-items: start;
	gap: var(--p-field-gap);
}
.count-table .count-actual-input {
	box-sizing: border-box;
	width: 104px;
	max-width: 120px;
	min-height: var(--p-control);
	padding: 3px 7px;
}
.count-baseline-warning {
	display: flex;
	align-items: center;
	gap: var(--p-space-1);
	color: var(--p-muted);
	font-size: var(--p-micro);
}
.count-baseline-warning button {
	min-height: 28px;
	border: 0;
	padding: 0 var(--p-space-1);
	color: var(--p-accent-strong);
	background: transparent;
	text-decoration: underline;
}
.count-row-actions-inner {
	display: flex;
	align-items: center;
	gap: var(--p-space-1);
	white-space: nowrap;
}
.count-row-actions-inner :deep(button) {
	flex: 0 0 auto;
	min-width: max-content;
	white-space: nowrap;
	word-break: keep-all;
}
.count-difference-positive {
	color: var(--p-success);
	font-weight: 650;
}
.count-difference-negative {
	color: var(--p-danger);
	font-weight: 650;
}
.count-removed {
	display: grid;
	gap: 6px;
}
.count-pagination {
	justify-content: center;
}
:global(.browse-filter-popover .hierarchy-inline-tree),
:global(.compact-filter-content .hierarchy-inline-tree) {
	max-height: min(45dvh, 320px);
	overflow: auto;
}
.count-card-list {
	display: grid;
	gap: var(--p-gap);
}
.count-card-list.is-refreshing {
	opacity: 0.72;
}
.count-card {
	min-width: 0;
	padding: var(--p-card-inner-pad);
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
}
.count-card-heading {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: var(--p-control-gap);
}
.count-card-image {
	width: 52px;
	height: 52px;
	flex: 0 0 52px;
	overflow: hidden;
}
.count-card-identity {
	display: grid;
	min-width: 0;
	gap: var(--p-field-gap);
}
.count-card-identity strong,
.count-card-identity small {
	display: -webkit-box;
	overflow: hidden;
	-webkit-box-orient: vertical;
	word-break: break-word;
}
.count-card-identity strong {
	-webkit-line-clamp: 2;
}
.count-card-identity small {
	color: var(--p-muted);
	-webkit-line-clamp: 1;
}
.count-card-counts {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(116px, 0.9fr);
	align-items: center;
	gap: var(--p-control-gap);
	margin-top: var(--p-field-gap);
	padding-top: var(--p-field-gap);
	border-top: 1px solid var(--p-border);
}
.count-card-counts.is-serial {
	grid-template-columns: minmax(0, 1fr);
}
.count-card-book,
.count-card-entry {
	display: grid;
	gap: var(--p-field-gap);
}
.count-card-entry:has(.serial-count) {
	min-width: 0;
}
.count-card-book span,
.count-card-entry label,
.count-card-pending {
	color: var(--p-muted);
	font-size: var(--p-small);
}
.count-card-input {
	box-sizing: border-box;
	width: 100%;
	min-width: 0;
	min-height: 44px;
	padding: var(--p-space-1) var(--p-space-2);
}
.count-card-difference {
	font-size: var(--p-small);
	font-weight: 650;
}
.count-card-actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--p-field-gap);
	margin-top: var(--p-field-gap);
}
.count-card-actions :deep(button) {
	min-height: 36px;
}
.serial-count-row-summary {
	display: flex;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
}
.serial-count-row-toggle {
	min-height: 32px;
	min-width: max-content;
	flex: 0 0 auto;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	padding: 3px var(--p-space-2);
	color: var(--p-accent-strong);
	background: var(--p-surface);
	white-space: nowrap;
}
.serial-count-detail-row {
	display: grid;
	gap: var(--p-control-gap);
	min-width: 0;
	padding: var(--p-table-cell-y) var(--p-table-cell-x);
}
:deep(.count-table tr[data-row-id^="count-serial-detail:"] .data-table-group-toggle) {
	display: none;
}
:deep(.count-table tr[data-row-id^="count-serial-detail:"] .data-table-group-count) {
	display: none;
}
:deep(.count-table .count-actual-column) {
	min-width: 176px;
}
:deep(.count-table tr[data-row-id^="count-serial-detail:"] > td) {
	font-weight: 400;
	background: var(--p-surface);
}
:deep(.count-table tr[data-row-id^="count-serial-detail:"][aria-expanded="true"] > td) {
	background: var(--p-surface);
}
:deep(.count-table .data-table-group-detail-row .data-table-group-detail-cell) {
	padding: 10px var(--p-space-4);
}
@media (max-width: 1023px) {
	.count-filter-bar {
		align-items: stretch;
	}
	.count-search {
		flex: 1 1 180px;
		min-width: 0;
	}
	.count-filter-bar > .browse-tabs {
		flex: 1 1 100%;
	}
	.count-table .count-actual-input {
		min-height: 44px;
		width: 112px;
	}
	.count-item-thumbnail {
		width: var(--p-table-thumbnail);
		height: var(--p-table-thumbnail);
		flex-basis: var(--p-table-thumbnail);
	}
	.count-row-actions-inner :deep(button) {
		min-height: 44px;
	}
}
</style>
