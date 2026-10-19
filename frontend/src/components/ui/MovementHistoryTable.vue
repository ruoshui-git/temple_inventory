<script setup lang="ts">
import { computed, useSlots } from "vue";
import { useReferenceData } from "../../services/contracts";
import { formatQuantity } from "../../lib/formatQuantity";
import { movementLabels } from "../../lib/filterPresentation";
import { nativeStatusLabel } from "../../lib/nativeLabels";
import { siteDateTime } from "../../lib/nativeTime";
import { warehouseLabel } from "../../lib/warehouseLabel";
import type { HistoryRow } from "../../features/movements/useMovementHistory";
import UiButton from "./UiButton.vue";

const props = withDefaults(
	defineProps<{
		rows: HistoryRow[];
		total: number;
		loading?: boolean;
		error?: string;
		initialized?: boolean;
		next?: number | null;
		includeItem?: boolean;
		mode?: "movement" | "loan-balance" | "loan-allocation" | "handling";
		busy?: boolean;
		historyComplete?: boolean;
		stale?: boolean;
	}>(),
	{
		loading: false,
		error: "",
		initialized: false,
		next: null,
		includeItem: false,
		mode: "movement",
		busy: false,
		historyComplete: true,
		stale: false,
	},
);
const emit = defineEmits<{
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
	openItem: [code: string];
	loadMore: [];
	retry: [];
}>();
const reference = useReferenceData();
const slots = useSlots();
const hasActions = computed(() => !!slots.actions && props.rows.some(canSettle));
function endpoint(value: string) {
	return value ? warehouseLabel(value, reference.warehouses) : "外部";
}
function record(row: HistoryRow) {
	if (row.doctype === "Stock Entry" && row.kind === "Loan") emit("openLoan", row.document);
	else emit("openDocument", row.doctype, row.document);
}
function canSettle(row: HistoryRow) {
	return Boolean((row as { can_settle?: boolean }).can_settle);
}
function quantity(row: HistoryRow, mode: string) {
	if (mode === "loan-allocation") return "";
	const value =
		mode === "loan-balance" && "loan_balance_effect" in row
			? row.loan_balance_effect
			: "quantity" in row
				? row.quantity
				: 0;
	const amount = formatQuantity(Math.abs(Number(value || 0)));
	const sign =
		mode === "loan-balance"
			? Number(value) > 0
				? "+"
				: Number(value) < 0
					? "−"
					: ""
			: mode === "handling"
				? ""
				: Number(value) < 0
					? "−"
					: "";
	return `${sign}${amount} ${row.stock_uom}`.trim();
}
function effect(row: HistoryRow) {
	if (!("available_effect" in row)) return 0;
	return Number(row.available_effect || 0);
}
function effectText(row: HistoryRow) {
	const value = effect(row);
	if (!value) return "可用库存无变化";
	return `${value > 0 ? "增加" : "减少"}可用库存 ${formatQuantity(Math.abs(value))} ${row.stock_uom}`;
}
const uomOf = (row: HistoryRow) => row.stock_uom || "";
const codeOf = (row: HistoryRow) => String((row as { item_code?: string }).item_code || "");
const nameOf = (row: HistoryRow) =>
	String((row as { item_name?: string }).item_name || codeOf(row));
</script>
<template>
	<section
		class="movement-history-surface"
		:aria-label="mode === 'loan-allocation' ? '物品借用记录' : '库存流动记录'"
	>
		<p
			v-if="['loan-balance', 'handling'].includes(mode) && !historyComplete"
			class="notice-bar warning"
			role="status"
		>
			部分关联处理记录不可用，无法核对未归还数量。
		</p>
		<p v-if="loading && !initialized" role="status">正在读取记录…</p>
		<div
			v-if="rows.length"
			class="movement-history-scroll"
			role="region"
			aria-label="可横向滚动的流动记录"
			tabindex="0"
		>
			<table class="movement-history-table">
				<thead>
					<tr>
						<th>记录</th>
						<th>日期 / 时间</th>
						<th v-if="mode !== 'loan-allocation'">类型</th>
						<th v-if="mode === 'loan-allocation'">借用方</th>
						<th>来源位置</th>
						<th>去向位置</th>
						<th v-if="includeItem">物品</th>
						<th v-if="mode === 'loan-allocation'">借出数量</th>
						<th v-if="mode === 'loan-allocation'">未归还数量</th>
						<th v-else>数量 / 单位</th>
						<th v-if="hasActions">操作</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="row in rows"
						:key="row.id"
						:class="{
							'history-effect-up':
								['movement', 'handling'].includes(mode) && effect(row) > 0,
							'history-effect-down':
								['movement', 'handling'].includes(mode) && effect(row) < 0,
						}"
						:aria-label="
							['movement', 'handling'].includes(mode) ? effectText(row) : undefined
						"
					>
						<td class="history-record-cell">
							<div class="history-record">
								<UiButton
									variant="ghost"
									size="compact"
									:disabled="stale || loading || busy"
									@click="record(row)"
									>{{ row.document }}</UiButton
								><span class="browse-badge is-neutral">{{
									nativeStatusLabel(row.docstatus)
								}}</span>
							</div>
						</td>
						<td>{{ siteDateTime(row.date_time) }}</td>
						<td v-if="mode !== 'loan-allocation'">
							{{ movementLabels[row.kind] || row.kind }}
						</td>
						<td v-if="mode === 'loan-allocation'">
							{{ "borrower" in row ? row.borrower : "" }}
						</td>
						<td class="history-location">{{ endpoint(row.source_warehouse) }}</td>
						<td class="history-location">{{ endpoint(row.destination_warehouse) }}</td>
						<td v-if="includeItem">
							<UiButton
								variant="ghost"
								size="compact"
								:disabled="stale || loading || busy"
								@click="emit('openItem', codeOf(row))"
								>{{ nameOf(row) }}</UiButton
							>
						</td>
						<td v-if="mode === 'loan-allocation'">
							{{
								"borrowed" in row
									? `${formatQuantity(Number(row.borrowed))} ${uomOf(row)}`
									: ""
							}}
						</td>
						<td v-if="mode === 'loan-allocation'">
							{{
								"outstanding" in row
									? `${formatQuantity(Number(row.outstanding))} ${uomOf(row)}`
									: ""
							}}
						</td>
						<td
							v-else
							:class="{
								'history-effect-quantity-up':
									['movement', 'handling'].includes(mode) && effect(row) > 0,
								'history-effect-quantity-down':
									['movement', 'handling'].includes(mode) && effect(row) < 0,
							}"
						>
							{{ quantity(row, mode)
							}}<small
								v-if="['movement', 'handling'].includes(mode)"
								class="history-effect-note"
								>{{ effectText(row) }}</small
							>
						</td>
						<td v-if="hasActions"><slot name="actions" :row="row" /></td>
					</tr>
				</tbody>
			</table>
		</div>
		<p v-else-if="initialized && !loading && !error" class="browse-empty compact">
			没有符合范围的流动记录。
		</p>
		<p v-if="error" role="alert">
			{{ error }} <UiButton @click="emit('retry')">重试</UiButton>
		</p>
		<p v-if="loading && initialized" role="status">正在更新；保留上次读取结果。</p>
		<UiButton
			v-if="next !== null"
			:loading="busy || loading"
			:disabled="busy || loading"
			@click="emit('loadMore')"
			>加载更多</UiButton
		>
	</section>
</template>
<style scoped>
.movement-history-surface {
	min-width: 0;
}
.movement-history-scroll {
	max-width: 100%;
	overflow: auto;
	overscroll-behavior-inline: contain;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
}
.movement-history-table {
	width: 100%;
	min-width: 700px;
	border-collapse: collapse;
	table-layout: auto;
}
.movement-history-table th,
.movement-history-table td {
	min-width: 0 !important;
	padding: 6px 10px;
	vertical-align: middle;
	border-bottom: 1px solid var(--p-border);
	text-align: start;
}
.movement-history-table th:first-child,
.movement-history-table td:first-child {
	min-width: 118px !important;
}
.history-record {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 4px;
}
.history-record-cell {
	width: 190px;
	max-width: 240px;
}
.history-location {
	max-width: 220px;
	overflow-wrap: anywhere;
}
.history-record :deep(.ui-button),
.movement-history-table td > :deep(.ui-button) {
	min-width: 0;
	max-width: 154px;
	height: auto;
	min-height: 32px;
	padding: 2px 4px;
	text-align: start;
	overflow-wrap: anywhere;
	word-break: break-word;
	white-space: normal;
}
.history-effect-up {
	background: color-mix(in srgb, var(--p-success) 7%, var(--p-surface));
}
.history-effect-down {
	background: color-mix(in srgb, var(--p-danger) 7%, var(--p-surface));
}
.history-effect-quantity-up {
	color: var(--p-success);
	font-weight: 650;
}
.history-effect-quantity-down {
	color: var(--p-danger);
	font-weight: 650;
}
.history-effect-note {
	display: block;
	max-width: 14em;
	color: var(--p-muted);
	font-weight: 400;
}
@media (max-width: 1023px) {
	.history-record :deep(.ui-button),
	.movement-history-table td > :deep(.ui-button) {
		min-height: 44px;
	}
}
</style>
