<script setup lang="ts">
import { formatQuantityWithUnit } from "../../lib/formatQuantity";
import { computed, ref, watch } from "vue";
import DataTable from "../../components/ui/DataTable.vue";
import type { DataColumn, DataTableEntry } from "../../lib/dataTable";
import { useOpeningEditor } from "./useOpeningEditor";
import ItemPicker from "../items/ItemPicker.vue";
import TransactionContext from "../documents/TransactionContext.vue";
import QuickExport from "../../components/QuickExport.vue";
import { savedDocumentExport } from "../documents/savedDocumentExport";
import PageHeader from "../../components/ui/PageHeader.vue";
import UiButton from "../../components/ui/UiButton.vue";
import BackButton from "../../components/ui/BackButton.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import ItemImage from "../../components/ItemImage.vue";
import InboundSerialField from "../documents/InboundSerialField.vue";
import { useRouter } from "vue-router";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import { confirm as confirmDialog } from "../../services/confirm";
import { warehouseLabel, warehousePath, warehouseSearchText } from "../../lib/warehouseLabel";
import type { NativeDocument } from "../documents/nativeEditor";
const props = defineProps<{
	name?: string;
	recoveryId?: string;
	initialDocument?: NativeDocument;
}>();
const controller = useOpeningEditor(props);
defineExpose({ controller });
const router = useRouter();
const {
	state,
	values,
	busy,
	loading,
	writable,
	pickerOpen,
	queueError,
	warehouses,
	supportingDirty,
	activityLabel,
	batchOptions,
} = controller;
const context = computed(() => ({
	kind: "Reconcile",
	get activity() {
		return values.ti_activity;
	},
	set activity(value: string) {
		values.ti_activity = value;
	},
	source: "",
	purpose: "",
	loanName: "",
}));
const warehouse = ref(warehouses.value[0]?.name || "");
watch(warehouses, (rows) => {
	if (!rows.some((row) => row.name === warehouse.value)) warehouse.value = rows[0]?.name || "";
});
const accountName = computed(() => String(state.server?.expense_account || "保存后由系统设置"));
const needsBatch = computed(() => values.items.some((row) => row.has_batch_no));
const needsSerial = computed(() => values.items.some((row) => row.has_serial_no));
const needsExpiry = computed(() =>
	values.items.some((row) => row.has_batch_no && row.has_expiry_date),
);
const columnCount = computed(
	() =>
		4 +
		Number(needsBatch.value) * 2 +
		Number(needsSerial.value) +
		Number(needsExpiry.value) +
		Number(writable.value),
);
const locationOptions = computed(() =>
	warehouses.value.map((location) => ({
		value: location.name,
		label: location.label || warehouseLabel(location.name, warehouses.value),
		title: warehousePath(location.name, warehouses.value),
		detail: warehousePath(location.name, warehouses.value),
		keywords: warehouseSearchText(location.name, warehouses.value),
	})),
);
const exportQuery = computed(() => savedDocumentExport(state.server, state.status));
const readOnlyColumns = computed<DataColumn[]>(() => [
	{ id: "item_name", label: "物品", kind: "primary", defaultVisible: true },
	{ id: "warehouse", label: "位置", kind: "text", defaultVisible: true },
	...(needsBatch.value
		? [{ id: "batch_no", label: "批次", kind: "code" as const, defaultVisible: true }]
		: []),
	{ id: "qty", label: "期初数量", kind: "number", defaultVisible: true, align: "end" },
	{
		id: "valuation_rate",
		label: "估值单价",
		kind: "number",
		defaultVisible: true,
		align: "end",
	},
	{ id: "line_value", label: "估值金额", kind: "number", defaultVisible: true, align: "end" },
	...(needsSerial.value
		? [{ id: "serial_no", label: "序列号", kind: "text" as const, defaultVisible: true }]
		: []),
	...(needsExpiry.value
		? [{ id: "expiry_date", label: "到期日期", kind: "date" as const, defaultVisible: true }]
		: []),
]);
const openingMetrics = computed(() => ({
	itemKinds: new Set(values.items.map((row) => row.item_code)).size,
	lines: values.items.length,
	quantities:
		[
			...values.items.reduce((totals, row) => {
				const unit = row.stock_uom || "";
				totals.set(unit, (totals.get(unit) || 0) + Number(row.qty || 0));
				return totals;
			}, new Map<string, number>()),
		]
			.map(([unit, quantity]) => formatQuantityWithUnit(quantity, unit))
			.join(" · ") || "0",
	value: values.items.reduce(
		(total, row) => total + Number(row.qty || 0) * Number(row.valuation_rate || 0),
		0,
	),
}));
const saveStatus = computed(() => {
	const labels: Record<string, string> = {
		saving: "正在保存…",
		saved: "已保存",
		local: "已暂存在此浏览器",
		matching: "尚未保存",
		conflict: "记录已更新，请重新读取",
		deleted: "记录已删除",
		forbidden: "无权编辑",
		error: "保存失败",
	};
	return labels[state.status] || "";
});
const collapsedGroups = ref(new Set<string>());
const serialInputs = ref<Record<string, string>>({});
const readOnlyTableRows = computed<DataTableEntry[]>(() => {
	const groups = new Map<string, Record<string, unknown>[]>();
	values.items.forEach((row, index) => {
		const location = warehouses.value.find((entry) => entry.name === row.warehouse);
		const line = {
			...row,
			id: row.name || `${row.warehouse}:${index}`,
			item_name: row.item_name || controller.labels.get(row.item_code) || row.item_code,
			warehouse_label: location?.label || warehouseLabel(row.warehouse, warehouses.value),
			line_value: Number(row.qty || 0) * Number(row.valuation_rate || 0),
			qty_difference: Number(row.qty || 0),
		};
		groups.set(row.warehouse, [...(groups.get(row.warehouse) || []), line]);
	});
	const entries: DataTableEntry[] = [];
	for (const [location, lines] of groups) {
		const id = `opening:${location}`;
		entries.push({
			kind: "group",
			id,
			label: warehouseLabel(location, warehouses.value),
			labelColumn: "item_name",
			countColumn: "item_name",
			depth: 0,
			count: lines.length,
			countLabel: "行",
			expanded: !collapsedGroups.value.has(id),
			hasChildren: lines.length > 0,
		});
		if (!collapsedGroups.value.has(id))
			for (const line of lines)
				entries.push({ kind: "record", id: String(line.id), value: line });
	}
	return entries;
});
function toggleReadOnlyGroup(id: string) {
	const next = new Set(collapsedGroups.value);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	collapsedGroups.value = next;
}
function compactSerials(value: unknown) {
	return String(value || "")
		.split(/[\n,]+/)
		.map((serial) => serial.trim())
		.filter(Boolean);
}
const isFuture = computed(
	() =>
		`${values.posting_date}T${values.posting_time}` >
		`${new Date().toISOString().slice(0, 10)}T${new Date().toTimeString().slice(0, 8)}`,
);
function add(selection: { code: string; warehouse: string }) {
	controller.addItem({ item_code: selection.code }, selection.warehouse || warehouse.value);
	pickerOpen.value = false;
}
function rowName(row: (typeof values.items)[number]) {
	return row.item_name || controller.labels.get(row.item_code) || row.item_code;
}
function batchChoices(itemCode: string) {
	return (batchOptions[itemCode] || []).map((batch) => ({
		value: batch.name,
		label: batch.name,
		detail: `生产 ${batch.manufacturing_date || "未填写"} · 到期 ${batch.expiry_date || "无效期"}`,
	}));
}
function addSerialInput(row: (typeof values.items)[number], value: string) {
	controller.addSerials(row, value);
	serialInputs.value[row.localId] = "";
}
function toggleAutoSerial(row: (typeof values.items)[number], enabled: boolean) {
	controller.toggleAutoSerial(row, enabled);
	if (enabled) void controller.generateSerials(row);
}
async function lifecycle(kind: "cancel" | "amend") {
	const accepted = await confirmDialog({
		title: kind === "cancel" ? "取消期初库存？" : "修订期初库存？",
		message: `${state.identity?.name || "此期初库存"}。将执行 ERPNext 流程，并重新校验版本与权限。`,
		confirmLabel: kind === "cancel" ? "确认取消" : "创建修订草稿",
		tone: kind === "cancel" ? "danger" : "default",
	});
	if (accepted) await controller.action(kind);
}
</script>
<template>
	<section class="form-page opening-editor">
		<PageHeader class="form-page-heading">
			<div>
				<h1>期初库存</h1>
				<p class="muted">录入尚无库存流水的物品数量与估值。</p>
			</div>
			<template #actions>
				<QuickExport v-if="exportQuery" :query="exportQuery" title="盘点记录" />
				<UiButton
					v-if="state.identity && state.server?.actions?.cancel"
					:disabled="busy"
					@click="lifecycle('cancel')"
					>取消记录</UiButton
				>
				<UiButton
					v-if="state.identity && state.server?.actions?.amend"
					:disabled="busy"
					@click="lifecycle('amend')"
					>修订</UiButton
				>
			</template>
			<template #back><BackButton @click="router.back()" /></template>
		</PageHeader>
		<div v-if="state.server" class="form-status">
			<span class="form-record-tag"
				>{{ state.server.docstatus === 0 ? "草稿单据" : "记录" }}
				{{ state.identity?.name }}</span
			>
			<span v-if="saveStatus && state.server.docstatus === 0" role="status">{{
				saveStatus
			}}</span>
			<NativeStatusBadge :status="state.server.docstatus" />
		</div>
		<div v-if="loading" class="opening-status">正在读取期初库存…</div>
		<div v-if="state.error" class="opening-error" role="alert">{{ state.error }}</div>
		<div v-if="state.recoveryError" class="opening-error" role="alert">
			{{ state.recoveryError }}
		</div>
		<div v-if="state.server?.queued" class="opening-queued" role="status">正在后台提交…</div>
		<div v-else-if="queueError" class="opening-error" role="alert">{{ queueError }}</div>
		<div class="opening-header card">
			<label v-if="writable"
				>期初日期<input v-model="values.posting_date" type="date"
			/></label>
			<div v-else class="opening-readonly-field">
				<small>期初日期</small><strong>{{ values.posting_date || "未填写" }}</strong>
			</div>
			<label v-if="writable"
				>时间<input v-model="values.posting_time" type="time" step="1"
			/></label>
			<div v-else class="opening-readonly-field">
				<small>时间</small><strong>{{ values.posting_time || "未填写" }}</strong>
			</div>
			<div class="opening-readonly-field opening-account">
				<small>差额科目</small><strong>{{ accountName }}</strong>
			</div>
			<label v-if="writable" class="opening-notes"
				>备注<textarea v-model="values.remarks" rows="2" />
			</label>
			<div v-else-if="values.remarks" class="opening-readonly-field opening-notes">
				<small>备注</small>
				<p>{{ values.remarks }}</p>
			</div>
			<p v-if="isFuture" class="opening-error">期初日期和时间不能晚于当前时间。</p>
		</div>
		<section v-if="state.server && !writable" class="count-readonly surface opening-readonly">
			<TransactionContext :draft="context" :activity-label="activityLabel" mode="display" />
			<div class="count-summary-strip opening-summary" role="status">
				<article class="metric">
					<small>物品种数</small><strong>{{ openingMetrics.itemKinds }}</strong>
				</article>
				<article class="metric">
					<small>明细行数</small><strong>{{ openingMetrics.lines }}</strong>
				</article>
				<article class="metric">
					<small>期初数量</small><strong>{{ openingMetrics.quantities }}</strong>
				</article>
				<article class="metric">
					<small>估值金额</small><strong>{{ openingMetrics.value }}</strong>
				</article>
			</div>
			<DataTable
				ariaLabel="期初库存明细"
				:columns="readOnlyColumns"
				:rows="readOnlyTableRows"
				compact
				empty-text="此期初库存没有明细。"
				table-class="count-readonly-table"
				@toggle-group="toggleReadOnlyGroup"
			>
				<template #cell="{ column, row }">
					<div v-if="column.id === 'item_name'" class="count-readonly-item">
						<strong>{{ row.item_name }}</strong
						><small>{{ row.item_code }}</small>
					</div>
					<template v-else-if="column.id === 'warehouse'">{{
						row.warehouse_label
					}}</template>
					<template v-else-if="column.id === 'batch_no'">{{ row.batch_no }}</template>
					<span v-else-if="column.id === 'qty'">{{
						formatQuantityWithUnit(Number(row.qty), row.stock_uom)
					}}</span>
					<template v-else-if="column.id === 'valuation_rate'">{{
						row.valuation_rate ?? "—"
					}}</template>
					<template v-else-if="column.id === 'line_value'">{{
						row.line_value
					}}</template>
					<details
						v-else-if="
							column.id === 'serial_no' && compactSerials(row.serial_no).length
						"
						class="serial-compact"
					>
						<summary>
							{{ compactSerials(row.serial_no).slice(0, 3).join("、")
							}}<span v-if="compactSerials(row.serial_no).length > 3">
								+{{ compactSerials(row.serial_no).length - 3 }}</span
							>
						</summary>
						<small>{{ compactSerials(row.serial_no).join("、") }}</small>
					</details>
					<template v-else-if="column.id === 'expiry_date'">{{
						row.expiry_date
					}}</template>
				</template>
			</DataTable>
		</section>
		<section v-else class="opening-lines card">
			<div class="opening-lines-heading">
				<h2>期初明细</h2>
				<UiButton v-if="writable" @click="pickerOpen = true">添加物品</UiButton>
			</div>
			<div v-if="!values.items.length" class="opening-empty">添加物品后录入期初数量。</div>
			<table v-else class="data-table opening-table" aria-label="期初库存明细">
				<thead>
					<tr>
						<th>物品 <b class="required-mark">*</b></th>
						<th>位置 <b class="required-mark">*</b></th>
						<th v-if="needsBatch">批次编号 <b class="required-mark">*</b></th>
						<th v-if="needsBatch">生产日期</th>
						<th v-if="needsSerial">序列号 <b class="required-mark">*</b></th>
						<th v-if="needsExpiry">到期日期 <b class="required-mark">*</b></th>
						<th>数量 <b class="required-mark">*</b></th>
						<th>估值单价</th>
						<th v-if="writable"></th>
					</tr>
				</thead>
				<tbody>
					<template v-for="(row, index) in values.items" :key="row.localId">
						<tr class="opening-grid-row">
							<td data-label="物品">
								<div class="opening-item-identity">
									<ItemImage
										:item="{
											code: row.item_code,
											name: rowName(row),
											image: row.item_image || '',
										}"
										:thumbnail-size="36"
										:target-size="36"
									/>
									<span
										><strong>{{ rowName(row) }}</strong
										><small>{{ row.item_code }}</small></span
									>
								</div>
							</td>
							<td data-label="位置">
								<SearchSelect
									label="位置"
									external-label
									:aria-label="`${rowName(row)}位置`"
									:model-value="row.warehouse"
									:options="locationOptions"
									:disabled="!writable"
									:clearable="false"
									@update:model-value="row.warehouse = $event"
								/>
							</td>
							<td v-if="needsBatch" data-label="批次编号">
								<div v-if="row.has_batch_no" class="opening-batch-fields">
									<input
										v-model="row.batch_no"
										:aria-label="`${rowName(row)}批次编号`"
										:disabled="!writable"
										placeholder="输入批次编号"
										:list="`opening-batches-${row.localId}`"
										@input="controller.markBatchDirty(row)"
										@change="controller.chooseBatch(row, row.batch_no)"
										@blur="controller.ensureBatch(row)"
									/>
									<datalist :id="`opening-batches-${row.localId}`">
										<option
											v-for="choice in batchChoices(row.item_code)"
											:key="choice.value"
											:value="choice.value"
										>
											{{ choice.detail }}
										</option>
									</datalist>
								</div>
							</td>
							<td v-if="needsBatch" data-label="生产日期">
								<input
									v-if="row.has_batch_no"
									v-model="row.manufacturing_date"
									:aria-label="`${rowName(row)}生产日期`"
									:disabled="!writable"
									type="date"
									@blur="controller.ensureBatch(row)"
								/>
							</td>
							<td v-if="needsSerial" data-label="序列号">
								<InboundSerialField
									v-if="row.has_serial_no"
									:label="rowName(row)"
									:serials="controller.serialValues(row)"
									:input-value="serialInputs[row.localId] || ''"
									:auto-count="row.autoSerialCount"
									:has-series="Boolean(row.serial_no_series)"
									:generate-on-blur="true"
									:large-targets="true"
									:disabled="!writable"
									@update:input-value="serialInputs[row.localId] = $event"
									@toggle-auto="toggleAutoSerial(row, $event)"
									@update:auto-count="controller.setAutoSerialCount(row, $event)"
									@add="addSerialInput(row, $event)"
									@remove="controller.removeSerial(row, $event)"
									@generate="controller.generateSerials(row)"
								/>
							</td>
							<td v-if="needsExpiry" data-label="到期日期">
								<input
									v-if="row.has_batch_no && row.has_expiry_date"
									v-model="row.expiry_date"
									:aria-label="`${rowName(row)}到期日期`"
									:disabled="!writable"
									type="date"
									@blur="controller.ensureBatch(row)"
								/>
							</td>
							<td data-label="数量">
								<input
									v-model.number="row.qty"
									:aria-label="`${rowName(row)}数量`"
									:disabled="
										!writable ||
										(row.has_serial_no && row.autoSerialCount !== undefined)
									"
									type="number"
									min="0.001"
									step="any"
								/>
							</td>
							<td data-label="估值单价">
								<input
									v-model.number="row.valuation_rate"
									:aria-label="`${rowName(row)}估值单价`"
									:disabled="!writable"
									type="number"
									min="0"
									step="any"
									placeholder="留空使用 ERPNext 估值"
								/>
								<p v-if="row.allow_zero_valuation_rate" class="opening-warning">
									未找到估值，将按零估值登记（适用于捐赠物资）
								</p>
							</td>
							<td v-if="writable" data-label="操作">
								<UiButton aria-label="移除物品" @click="controller.removeItem(row)"
									>移除</UiButton
								>
							</td>
						</tr>
						<tr v-if="row.eligibility_error" class="opening-feedback">
							<td :colspan="columnCount">
								<p v-if="row.eligibility_error" class="opening-error" role="alert">
									{{ row.eligibility_error }}
								</p>
							</td>
						</tr>
					</template>
				</tbody>
			</table>
		</section>
		<section v-if="writable" class="opening-context card">
			<h2>活动背景</h2>
			<TransactionContext
				:draft="context"
				:activity-label="activityLabel"
				:mode="writable ? 'edit' : 'display'"
				:disabled="busy"
				@dirty-change="supportingDirty = $event"
			/>
		</section>
		<div v-if="writable" class="form-actions document-actions">
			<p class="opening-action-status">
				{{
					state.status === "saving"
						? "正在保存…"
						: state.status === "saved"
							? "已保存"
							: state.status === "submitted"
								? "已提交"
								: ""
				}}
			</p>
			<UiButton
				v-if="writable && !state.server?.docstatus"
				variant="primary"
				:disabled="busy || isFuture"
				@click="controller.confirm"
				>确认期初库存</UiButton
			>
		</div>
		<ItemPicker
			v-if="pickerOpen"
			mode="replace-single"
			purpose="inbound"
			:receiving-warehouse="warehouse"
			@close="pickerOpen = false"
			@select="add"
		/>
	</section>
</template>
<style scoped>
.opening-editor {
	display: grid;
	gap: var(--p-gap);
	padding-bottom: calc(var(--app-action-bar-height) + var(--p-editor-bottom-pad));
	min-width: 0;
	overflow-x: clip;
}
.opening-header {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: var(--p-control-gap);
}
.opening-notes {
	grid-column: 1/-1;
}
.opening-account {
	grid-column: 1 / -1;
}
.opening-readonly-field {
	min-width: 0;
	display: grid;
	align-content: start;
	gap: var(--p-field-gap);
}
.opening-readonly-field small {
	color: var(--p-muted);
}
.opening-readonly-field strong,
.opening-readonly-field p {
	margin: 0;
	min-width: 0;
	overflow-wrap: anywhere;
}
.opening-summary {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: var(--p-control-gap);
}
.opening-summary .metric {
	min-width: 0;
	padding: var(--p-card-inner-pad);
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	background: var(--p-surface);
}
.opening-summary .metric small,
.opening-summary .metric strong {
	display: block;
}
.opening-summary .metric small {
	color: var(--p-muted);
}
.opening-summary .metric strong {
	margin-top: var(--p-space-1);
	font-variant-numeric: tabular-nums;
}
.opening-lines-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--p-control-gap);
}
.opening-table {
	width: 100%;
	min-width: 0;
	table-layout: fixed;
	border-collapse: collapse;
}
.opening-table th,
.opening-table td {
	padding: var(--p-table-cell-y) var(--p-table-cell-x);
	border-bottom: 1px solid var(--p-border);
	text-align: start;
	vertical-align: top;
	overflow-wrap: anywhere;
}
.opening-table th {
	color: var(--p-muted);
	font-size: var(--p-small);
}
.opening-table input {
	width: 100%;
	max-width: 100%;
	min-width: 0;
}
.opening-item-identity {
	display: flex;
	align-items: center;
	gap: var(--p-control-gap);
	min-width: 0;
}
.opening-item-identity > span {
	display: grid;
	min-width: 0;
}
.opening-item-identity small {
	color: var(--p-muted);
}
.opening-batch-fields {
	display: grid;
	gap: var(--p-control-gap);
	min-width: 0;
}
.opening-feedback td {
	padding-top: 0;
}
.opening-readonly {
	min-width: 0;
	max-width: 100%;
	overflow: hidden;
	padding: var(--p-card-inner-pad);
}
.opening-readonly :deep(.data-table-frame),
.opening-readonly :deep(.data-table-scroll) {
	min-width: 0;
	max-width: 100%;
}
.opening-readonly :deep(.data-table-scroll) {
	overflow-x: auto;
}
.opening-error {
	color: var(--p-danger);
	margin: 0;
}
.opening-warning {
	color: var(--p-warning);
	font-size: var(--p-small);
	margin: 0;
}
.opening-status,
.opening-queued {
	padding: var(--p-card-inner-pad);
	background: var(--p-soft);
}
@media (max-width: 700px) {
	.opening-header {
		grid-template-columns: 1fr 1fr;
	}
	.opening-notes {
		grid-column: 1/-1;
	}
	.opening-table thead {
		display: none;
	}
	.opening-table,
	.opening-table tbody,
	.opening-table tr {
		display: block;
		width: 100%;
	}
	.opening-table tr.opening-grid-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--p-space-2);
		padding: var(--p-card-pad);
		margin-bottom: var(--p-space-3);
		border: 1px solid var(--p-border);
		border-radius: var(--p-radius-card);
		background: var(--p-surface);
	}
	.opening-table td {
		display: block;
		min-width: 0;
		padding: 0;
		border: 0;
	}
	.opening-table td:empty {
		display: none;
	}
	.opening-table td::before {
		display: block;
		margin-bottom: var(--p-space-1);
		color: var(--p-muted);
		font-size: var(--p-small);
		content: attr(data-label);
	}
	.opening-table td[data-label="物品"],
	.opening-table td[data-label="序列号"],
	.opening-feedback {
		grid-column: 1 / -1;
	}
	.opening-feedback td::before {
		content: none;
	}
	.opening-table td[data-label="位置"] :deep(.search-select) {
		min-width: 0;
	}
	.opening-table td[data-label="操作"] {
		grid-column: 1 / -1;
	}
	.opening-header label {
		min-width: 0;
	}
	.opening-header input,
	.opening-header textarea,
	.opening-table input {
		min-height: 44px;
		max-width: 100%;
	}
	.opening-item-identity {
		align-items: flex-start;
	}
	.opening-lines {
		min-width: 0;
	}
	.opening-lines-heading > * {
		flex: 0 0 auto;
	}
	.opening-header {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	}
	.opening-account {
		grid-column: 1 / -1;
	}
	.opening-notes {
		grid-column: 1/-1;
	}
}
</style>
