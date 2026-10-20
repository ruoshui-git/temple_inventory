<script setup lang="ts">
import { computed, ref, watch } from "vue";
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

const props = defineProps<{ controller: CountEditor }>();
const emit = defineEmits<{ openDocument: [doctype: string, name: string] }>();
const c = props.controller;
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
const sortBy = ref<"location" | "item" | "batch">("location");
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
			item: [
				left.item_name || names[left.item_code] || left.item_code,
				right.item_name || names[right.item_code] || right.item_code,
			],
			batch: [left.batch_no || "", right.batch_no || ""],
		}[sortBy.value];
		const primary = values[0].localeCompare(values[1], "zh-CN") * sortDirection.value;
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
			const order = first.localeCompare(second, "zh-CN");
			if (order) return order;
		}
		return c.countKey(left).localeCompare(c.countKey(right));
	}),
);
const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize)));
const visibleRows = computed(() =>
	sortedRows.value.slice((visiblePage.value - 1) * pageSize, visiblePage.value * pageSize),
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
function sort(field: "location" | "item" | "batch") {
	if (sortBy.value === field) sortDirection.value = sortDirection.value === 1 ? -1 : 1;
	else {
		sortBy.value = field;
		sortDirection.value = 1;
	}
	visiblePage.value = 1;
}
function input(row: CountRow, event: Event) {
	c.input(row, (event.target as HTMLInputElement).value);
}
function clear(row: CountRow) {
	c.clearInput(row);
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
		<details class="count-scope-details">
			<summary>
				盘点范围与基准 · {{ values.ti_count_warehouses.length }} 个实体末级位置
			</summary>
			<div class="count-scope-controls">
				<label class="preview-field count-scope-type">
					盘点方式
					<select
						v-model="values.ti_count_scope"
						:disabled="busy || baselineBusy"
						@change="c.refresh"
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
					@click="c.refresh"
					>刷新账面基准</UiButton
				>
			</div>
		</details>
		<div class="count-filter-bar">
			<FilterPanel label="位置" :count="selectedLocations.length" context="count-location">
				<HierarchyFilter
					v-model="selectedLocations"
					:options="physicalLocations"
					title="显示位置"
					placeholder="搜索位置"
					embedded
				/>
			</FilterPanel>
			<label class="preview-field count-search">
				搜索物品、批次或位置
				<input v-model="search" type="search" />
			</label>
			<div class="count-review-tabs" role="group" aria-label="核对状态筛选">
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
				{{ row.batch_no || "无批次" }} · {{ row.actual_qty ?? "未核对" }}
				{{ row.stock_uom }}
			</p>
			<label v-if="writable" class="preview-choice-label">
				<input v-model="removalAcknowledged" type="checkbox" />已核对移出的输入
			</label>
		</section>
		<div
			class="count-table-scroll"
			role="region"
			aria-label="盘点明细，可横向滚动"
			tabindex="0"
		>
			<table class="count-table">
				<thead>
					<tr>
						<th>
							<button type="button" @click="sort('location')">
								位置{{
									sortBy === "location"
										? sortDirection === 1
											? " ↑"
											: " ↓"
										: ""
								}}
							</button>
						</th>
						<th>
							<button type="button" @click="sort('item')">
								物品{{
									sortBy === "item" ? (sortDirection === 1 ? " ↑" : " ↓") : ""
								}}
							</button>
						</th>
						<th>
							<button type="button" @click="sort('batch')">
								批次{{
									sortBy === "batch" ? (sortDirection === 1 ? " ↑" : " ↓") : ""
								}}
							</button>
						</th>
						<th>库存单位</th>
						<th>账面数量</th>
						<th>实点数量</th>
						<th>差异</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="row in visibleRows"
						:key="c.countKey(row)"
						:data-count-key="c.countKey(row)"
					>
						<td>{{ warehouseLabel(row.warehouse, reference.warehouses) }}</td>
						<td class="count-item-cell">
							<div class="count-item-content">
								<div class="count-item-thumbnail">
									<ItemImage :item="itemImage(row)" />
								</div>
								<div>
									<strong>{{
										row.item_name || names[row.item_code] || row.item_code
									}}</strong
									><small>{{ row.item_code }}</small>
								</div>
							</div>
						</td>
						<td>{{ row.batch_no || "—" }}</td>
						<td>{{ row.stock_uom }}</td>
						<td>{{ row.baseline_qty }}</td>
						<td>
							<div class="count-actual-cell">
								<input
									v-if="writable"
									class="count-actual-input"
									type="number"
									min="0"
									:step="
										reference.units.find((unit) => unit.name === row.stock_uom)
											?.whole
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
										@click="c.rereview(row)"
									>
										确认仍按当前实点
									</button>
								</div>
							</div>
						</td>
						<td
							:class="{
								'count-difference-positive':
									hasCountInput(row) && row.actual_qty > row.baseline_qty,
								'count-difference-negative':
									hasCountInput(row) && row.actual_qty < row.baseline_qty,
							}"
						>
							{{
								hasCountInput(row) === false
									? "待核对"
									: `${row.actual_qty - row.baseline_qty > 0 ? "+" : ""}${row.actual_qty - row.baseline_qty}`
							}}
						</td>
						<td class="count-row-actions">
							<div class="count-row-actions-inner">
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
									>清除输入</UiButton
								>
								<UiButton
									v-if="writable || row.reason"
									size="compact"
									@click="notesTarget = row"
									>备注</UiButton
								>
							</div>
						</td>
					</tr>
					<tr v-if="!visibleRows.length">
						<td colspan="8" class="count-empty">
							{{
								rows.length
									? "没有符合当前搜索和筛选条件的行。"
									: "正在读取盘点基准或此范围没有库存行。"
							}}
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div v-if="pageCount > 1" class="count-pagination">
			<UiButton :disabled="visiblePage <= 1" @click="visiblePage--">上一页</UiButton>
			<span>{{ visiblePage }} / {{ pageCount }}</span>
			<UiButton :disabled="visiblePage >= pageCount" @click="visiblePage++">下一页</UiButton>
		</div>
		<ItemPicker
			v-if="pickerOpen"
			mode="add-multiple"
			@close="pickerOpen = false"
			@select-multiple="
				(codes) => {
					pickerOpen = false;
					c.chooseItems(codes);
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
				:show-status="false"
				@load-more="c.history.loadMore"
				@retry="c.history.retry"
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
				>差异原因（可选）<textarea
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
}
.count-scope-details > summary {
	min-height: var(--p-control);
	align-content: center;
	color: var(--p-muted);
	cursor: pointer;
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
.count-review-tabs {
	display: flex;
	align-items: center;
	border: 1px solid var(--p-control-border);
	border-radius: var(--p-radius-control);
	overflow: hidden;
}
.count-review-tabs button {
	min-height: var(--p-control);
	padding: 0 12px;
	border: 0;
	color: var(--p-ink);
	background: var(--p-surface);
}
.count-review-tabs button[aria-pressed="true"] {
	color: var(--p-accent-strong);
	background: var(--p-soft);
}
.count-toolbar {
	flex-wrap: wrap;
	color: var(--p-muted);
	font-size: 0.88rem;
}
.count-table-scroll {
	max-width: 100%;
	overflow: auto;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
}
.count-table {
	width: 100%;
	min-width: 990px;
	border-collapse: collapse;
}
.count-table th,
.count-table td {
	padding: 5px 8px;
	border-bottom: 1px solid var(--p-border);
	text-align: left;
	vertical-align: middle;
}
.count-table th {
	position: sticky;
	top: 0;
	z-index: 1;
	background: var(--p-surface);
}
.count-table th button {
	min-height: var(--p-control);
	padding: 0;
	border: 0;
	color: inherit;
	background: none;
	font: inherit;
	font-weight: 650;
	cursor: pointer;
}
.count-table tbody tr:hover {
	background: var(--p-soft);
}
.count-table td.count-item-cell {
	min-width: 220px;
}
.count-item-content {
	display: flex;
	align-items: center;
	gap: 8px;
}
.count-item-thumbnail {
	width: 38px;
	height: 38px;
	flex: 0 0 38px;
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
.count-table td.count-row-actions {
	min-width: 185px;
}
.count-row-actions-inner {
	display: flex;
	align-items: center;
	gap: 4px;
	white-space: nowrap;
}
.count-difference-positive {
	color: var(--p-success);
	font-weight: 650;
}
.count-difference-negative {
	color: var(--p-danger);
	font-weight: 650;
}
.count-empty {
	padding: 28px !important;
	text-align: center !important;
	color: var(--p-muted);
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
@media (max-width: 1023px) {
	.count-filter-bar {
		align-items: stretch;
	}
	.count-search {
		flex: 1 1 100%;
		min-width: 0;
	}
	.count-review-tabs {
		flex: 1 1 100%;
	}
	.count-review-tabs button {
		flex: 1;
		min-height: 44px;
	}
	.count-table th,
	.count-table td {
		padding: 5px 8px;
	}
	.count-table .count-actual-input {
		min-height: 44px;
		width: 112px;
	}
	.count-item-thumbnail {
		width: 44px;
		height: 44px;
		flex-basis: 44px;
	}
	.count-row-actions-inner :deep(button) {
		min-height: 44px;
	}
}
</style>
