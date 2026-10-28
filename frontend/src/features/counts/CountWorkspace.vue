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
import { useOptionalInventoryServices } from "../../services/contracts";
import type { DataColumn, DataTableRecord } from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { showCountRowsOrEmpty } from "../documents/creationFormPresentation";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { unitLabel } from "../../lib/units";

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
const reviewFilter = ref<"all" | "unreviewed" | "difference">("all");
const selectedLocations = ref<string[]>([]);
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
	const term = search.value.trim().toLocaleLowerCase();
	return rows.value.filter((row) => {
		if (!leafScope(row)) return false;
		if (reviewFilter.value === "unreviewed" && row.review_state !== "Unreviewed") return false;
		if (
			reviewFilter.value === "difference" &&
			(row.review_state !== "Reviewed" ||
				row.actual_qty === null ||
				row.actual_qty === row.baseline_qty)
		)
			return false;
		const location = warehouseLabel(row.warehouse, reference.warehouses);
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
		const values = {
			location: [
				warehouseLabel(left.warehouse, reference.warehouses),
				warehouseLabel(right.warehouse, reference.warehouses),
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
				warehouseLabel(left.warehouse, reference.warehouses),
				warehouseLabel(right.warehouse, reference.warehouses),
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
const countColumns = computed<DataColumn[]>(() => [
	{ id: "location", label: "位置", sortable: true },
	{ id: "image", label: "图片", defaultVisible: true },
	{ id: "item_name", label: "物品名称", sortable: true, required: true },
	{ id: "item_code", label: "物品编码", sortable: true, required: true },
	{ id: "batch", label: "批次", sortable: true },
	{ id: "stock_uom", label: "库存单位" },
	{ id: "baseline_qty", label: "账面数量", align: "end" },
	{ id: "actual_qty", label: "实点数量", required: true },
	{ id: "difference", label: "差异", align: "end" },
	{ id: "actions", label: "操作", required: true },
]);
const countColumnPreferences = services
	? useColumnPreferences("count.workspace", countColumns, reference, services)
	: undefined;
const countTableRows = computed<DataTableRecord[]>(() =>
	visibleRows.value.map((row) => ({ kind: "record", id: c.countKey(row), value: row })),
);
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
watch([selectedLocations, search, reviewFilter], () => {
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
async function nextCountInput(event: KeyboardEvent) {
	event.preventDefault();
	const current = event.currentTarget as HTMLInputElement;
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
		<DisclosureSection
			class="count-scope-details"
			title="盘点范围与基准"
			:count="values.ti_count_warehouses.length"
			:summary="`${values.ti_count_warehouses.length} 个实体末级位置`"
		>
			<div class="count-scope-controls">
				<label class="preview-field count-scope-type">
					盘点方式
					<select
						v-model="values.ti_count_scope"
						:disabled="busy || baselineBusy"
						@change="c.refresh()"
					>
						<option value="Full Location">全部有库存物品</option>
						<option value="Selected">选定物品</option>
					</select>
				</label>
				<UiButton
					v-if="values.ti_count_scope === 'Selected'"
					:disabled="busy || baselineBusy"
					@click="pickerOpen = true"
					>添加物品</UiButton
				>
				<UiButton
					:disabled="busy || baselineBusy"
					:loading="baselineBusy"
					loading-label="正在刷新账面基准…"
					@click="c.refresh"
					>刷新账面基准</UiButton
				>
			</div>
		</DisclosureSection>
		<div class="count-filter-bar">
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
			<label class="preview-field count-search">
				搜索物品、批次或位置
				<input
					v-model="search"
					type="search"
					placeholder="输入物品名称、编码、批次或位置"
				/>
			</label>
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
		<div class="count-toolbar">
			<strong>{{ filteredRows.length }} / {{ rows.length }} 行</strong>
			<span v-if="hiddenEntered">已隐藏 {{ hiddenEntered }} 条有输入的记录</span>
			<span v-if="removed.length">{{ removed.length }} 行已移出基准</span>
		</div>
		<p v-if="baselineError" role="alert" class="notice-bar danger">{{ baselineError }}</p>
		<p v-if="showError && issues.length" role="alert" class="notice-bar danger">
			{{ issues.length }} 行实点数量需要修正。
		</p>
		<CountSummary :rows="rows" />
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
			<label v-if="writable" class="preview-choice-label">
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
			<article
				v-for="row in visibleRows"
				:key="c.countKey(row)"
				class="count-card"
				:data-count-key="c.countKey(row)"
			>
				<div class="count-card-heading">
					<div class="count-card-image"><ItemImage :item="itemImage(row)" /></div>
					<div class="count-card-identity">
						<strong>{{
							row.item_name || names[row.item_code] || row.item_code
						}}</strong>
						<small
							>{{ row.item_code
							}}<template v-if="row.batch_no"> · {{ row.batch_no }}</template></small
						>
						<small class="count-card-location">{{
							warehouseLabel(row.warehouse, reference.warehouses)
						}}</small>
					</div>
				</div>
				<div class="count-card-counts">
					<div class="count-card-book">
						<span>账面</span
						><strong
							>{{ row.baseline_qty }}
							{{ unitLabel(String(row.stock_uom || "")) }}</strong
						>
					</div>
					<div class="count-card-entry">
						<label :for="`count-input-${encodeURIComponent(c.countKey(row))}`"
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
								reference.units.find((unit) => unit.name === row.stock_uom)?.whole
									? 1
									: 'any'
							"
							:value="hasCountInput(row) ? row.actual_qty : ''"
							:disabled="busy || baselineBusy"
							:aria-label="`${row.item_name || names[row.item_code] || row.item_code}实点数量`"
							:aria-invalid="
								showError && issues.some((issue) => issue.key === c.countKey(row))
							"
							@input="input(row, $event)"
							@keydown.enter="nextCountInput"
						/>
						<strong v-else
							>{{ hasCountInput(row) ? row.actual_qty : "未核对" }}
							{{ unitLabel(String(row.stock_uom || "")) }}</strong
						>
						<span
							v-if="hasCountInput(row) && row.actual_qty !== row.baseline_qty"
							class="count-card-difference"
							:class="
								row.actual_qty! > row.baseline_qty
									? 'count-difference-positive'
									: 'count-difference-negative'
							"
							>差异 {{ row.actual_qty! - row.baseline_qty > 0 ? "+" : ""
							}}{{ row.actual_qty! - row.baseline_qty }}</span
						>
						<span v-else-if="!hasCountInput(row)" class="count-card-pending"
							>未核对</span
						>
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
		</div>
		<DataTable
			v-else-if="!isMobile && showCountRowsOrEmpty(!!baselineError, rows.length)"
			class="count-data-table"
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
						:value="hasCountInput(row as unknown as CountRow) ? row.actual_qty : ''"
						:disabled="busy || baselineBusy"
						:aria-label="`${row.item_name || names[String(row.item_code || '')] || row.item_code}实点数量`"
						:aria-invalid="
							showError &&
							issues.some(
								(issue) => issue.key === c.countKey(row as unknown as CountRow),
							)
						"
						@input="input(row as unknown as CountRow, $event)"
					/>
					<span v-else>{{
						row.review_state === "Unreviewed" ? "未核对" : row.actual_qty
					}}</span>
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
					:class="{
						'count-difference-positive':
							hasCountInput(row as unknown as CountRow) &&
							Number(row.actual_qty) > Number(row.baseline_qty),
						'count-difference-negative':
							hasCountInput(row as unknown as CountRow) &&
							Number(row.actual_qty) < Number(row.baseline_qty),
					}"
					>{{
						hasCountInput(row as unknown as CountRow)
							? `${Number(row.actual_qty) - Number(row.baseline_qty) > 0 ? "+" : ""}${Number(row.actual_qty) - Number(row.baseline_qty)}`
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
					c.chooseItems([...new Set(selections.map((selection) => selection.code))]);
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
			<label class="preview-field"
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
	gap: 8px;
	min-width: 0;
}
.count-scope-details {
	font-size: 0.88rem;
	color: var(--p-muted);
}
.count-scope-controls,
.count-filter-bar,
.count-toolbar,
.count-pagination {
	display: flex;
	align-items: center;
	gap: 8px;
}
.count-scope-controls {
	flex-wrap: wrap;
	padding: 6px 0;
}
.count-scope-type {
	width: min(260px, 32vw);
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
	font-size: 0.88rem;
}
.count-table {
	min-width: 990px;
}
.count-item-content {
	display: flex;
	align-items: center;
	gap: 8px;
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
	gap: 3px;
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
	gap: 4px;
	color: var(--p-muted);
	font-size: 0.72rem;
}
.count-baseline-warning button {
	min-height: 28px;
	border: 0;
	padding: 0 4px;
	color: var(--p-accent-strong);
	background: transparent;
	text-decoration: underline;
}
.count-row-actions-inner {
	display: flex;
	align-items: center;
	gap: 4px;
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
.count-workspace :deep(.preview-filter-popover .hierarchy-inline-tree),
.count-workspace :deep(.compact-filter-content .hierarchy-inline-tree) {
	max-height: min(45dvh, 320px);
	overflow: auto;
}
.count-card-list {
	display: grid;
	gap: 8px;
}
.count-card-list.is-refreshing {
	opacity: 0.72;
}
.count-card {
	min-width: 0;
	padding: 10px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
}
.count-card-heading {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 10px;
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
	gap: 2px;
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
	gap: 10px;
	margin-top: 8px;
	padding-top: 8px;
	border-top: 1px solid var(--p-border);
}
.count-card-book,
.count-card-entry {
	display: grid;
	gap: 3px;
}
.count-card-book span,
.count-card-entry label,
.count-card-pending {
	color: var(--p-muted);
	font-size: 0.78rem;
}
.count-card-input {
	box-sizing: border-box;
	width: 100%;
	min-width: 0;
	min-height: 44px;
	padding: 4px 8px;
}
.count-card-difference {
	font-size: 0.78rem;
	font-weight: 650;
}
.count-card-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 6px;
}
.count-card-actions :deep(button) {
	min-height: 36px;
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
