<script setup lang="ts">
import { computed, useSlots } from "vue";
import { useOptionalInventoryServices } from "../../services/contracts";
import { formatQuantity } from "../../lib/formatQuantity";
import { movementLabels } from "../../lib/filterPresentation";
import { siteDateTime } from "../../lib/nativeTime";
import type { HistoryRow } from "../../features/movements/useMovementHistory";
import type { DataColumn, DataTableRecord } from "../../lib/dataTable";
import UiButton from "./UiButton.vue";
import NativeStatusBadge from "./NativeStatusBadge.vue";
import DataTable from "./DataTable.vue";
import ItemImage from "../ItemImage.vue";
import { useReferenceData } from "../../services/contracts";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import LocationEndpoint from "./LocationEndpoint.vue";
import RecordRef from "./RecordRef.vue";
import InventoryIcon from "../InventoryIcon.vue";
import { kindIcons } from "../../lib/kindIcons";

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
		showStatus?: boolean;
		sortBy?: string;
		sortDirection?: "asc" | "desc";
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
		showStatus: true,
		sortBy: "date",
		sortDirection: "desc",
	},
);
const emit = defineEmits<{
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
	openItem: [code: string];
	loadMore: [];
	retry: [];
	sort: [column: string];
}>();
const reference = useReferenceData();
const services = useOptionalInventoryServices();
const slots = useSlots();
const hasActions = computed(() => Boolean(slots.actions && props.rows.some(canSettle)));
const loadingMore = computed(() => props.loading && props.initialized && !props.stale);
const columns = computed<DataColumn[]>(() => {
	const result: DataColumn[] = [
		{ id: "document", label: "记录", required: true, sortable: true, minWidth: "190px" },
		{
			id: "date_time",
			label: "日期 / 时间",
			sortable: true,
			sortField: "date",
			minWidth: "150px",
		},
		...(props.mode === "loan-allocation"
			? [
					{
						id: "borrower",
						label: "借用方",
						sortable: true,
						minWidth: "130px",
					} as DataColumn,
				]
			: [{ id: "kind", label: "类型", sortable: true, minWidth: "110px" } as DataColumn]),
		{ id: "source_warehouse", label: "来源位置", sortable: true, minWidth: "150px" },
		{ id: "destination_warehouse", label: "去向位置", sortable: true, minWidth: "150px" },
	];
	if (props.includeItem)
		result.push(
			{ id: "item_name", label: "物品名称", sortable: true, minWidth: "150px" },
			{ id: "item_code", label: "物品编码", sortable: true, minWidth: "130px" },
		);
	if (props.mode === "loan-allocation") {
		result.push(
			{ id: "borrowed", label: "借出数量", sortable: true, minWidth: "120px" },
			{ id: "outstanding", label: "未归还数量", sortable: true, minWidth: "130px" },
		);
	} else {
		result.push(
			{ id: "stock_qty", label: "数量", sortable: true, minWidth: "100px" },
			{ id: "stock_uom", label: "库存单位", sortable: true, minWidth: "100px" },
		);
		if (props.mode === "loan-balance")
			result.push(
				{ id: "outstanding", label: "未还数量", sortable: true, minWidth: "120px" },
				{ id: "loan_status", label: "状态", minWidth: "110px" },
			);
	}
	if (hasActions.value)
		result.push({ id: "_actions", label: "操作", required: true, minWidth: "140px" });
	return result;
});
const columnPreferences = services
	? useColumnPreferences(`history.${props.mode}`, columns, reference, services)
	: undefined;
const rows = computed<DataTableRecord[]>(() =>
	props.rows.map((row) => ({ kind: "record", id: row.id, value: row })),
);

function history(row: Record<string, unknown>) {
	return row as unknown as HistoryRow;
}

function record(row: HistoryRow) {
	if (row.doctype === "Stock Entry" && row.kind === "Loan") emit("openLoan", row.document);
	else emit("openDocument", row.doctype, row.document);
}

function canSettle(row: HistoryRow) {
	return Boolean((row as { can_settle?: boolean }).can_settle);
}

function loanStatus(row: Record<string, unknown>) {
	if (row.kind !== "Loan") return "";
	const labels: Record<string, string> = {
		Open: "未结清",
		Settled: "已结清",
		Closed: "已结清",
	};
	return labels[String(row.loan_status || "")] || "";
}

function quantity(row: HistoryRow) {
	if (props.mode === "loan-allocation") return "";
	const amountValue =
		props.mode === "loan-balance" && "loan_balance_effect" in row
			? row.loan_balance_effect
			: "quantity" in row
				? row.quantity
				: 0;
	const amount = formatQuantity(Math.abs(Number(amountValue || 0)));
	const sign =
		props.mode === "loan-balance"
			? Number(amountValue) > 0
				? "+"
				: Number(amountValue) < 0
					? "−"
					: ""
			: props.mode === "handling"
				? ""
				: Number(amountValue) < 0
					? "−"
					: "";
	return `${sign}${amount}`.trim();
}

function effect(row: HistoryRow) {
	return "available_effect" in row ? Number(row.available_effect || 0) : 0;
}

function effectText(row: HistoryRow) {
	const value = effect(row);
	if (!value) return "可用库存无变化";
	return `${value > 0 ? "增加" : "减少"}可用库存 ${formatQuantity(Math.abs(value))} ${row.stock_uom}`;
}

function rowClass(row: Record<string, unknown>) {
	if (!["movement", "handling"].includes(props.mode)) return "";
	const value = Number(row.available_effect || 0);
	return value > 0 ? "history-effect-up" : value < 0 ? "history-effect-down" : "";
}

function rowLabel(row: Record<string, unknown>) {
	return ["movement", "handling"].includes(props.mode)
		? effectText(row as unknown as HistoryRow)
		: undefined;
}

function quantityClass(row: HistoryRow) {
	if (!["movement", "handling"].includes(props.mode)) return "";
	return effect(row) > 0
		? "history-effect-quantity-up"
		: effect(row) < 0
			? "history-effect-quantity-down"
			: "";
}

function historyIcon(row: HistoryRow) {
	return kindIcons[String(row.kind) as keyof typeof kindIcons]?.icon || "movement";
}

function compactDate(value: string) {
	const formatted = siteDateTime(value);
	return formatted.length >= 16 ? formatted.slice(5, 16) : formatted;
}

function compactDocumentName(value: string) {
	const segments = value.split(/[/-]/).filter(Boolean);
	const lastSegment = segments[segments.length - 1] || value;
	return value.length > 12 ? `…${lastSegment}` : value;
}

const title = computed(() => (props.mode === "loan-allocation" ? "物品借用记录" : "库存流动记录"));
</script>

<template>
	<section class="movement-history-surface" :aria-label="title">
		<p
			v-if="['loan-balance', 'handling'].includes(mode) && !historyComplete"
			class="notice-bar warning"
			role="status"
		>
			部分关联处理记录不可用，无法核对未归还数量。
		</p>
		<DataTable
			class="movement-history-table"
			:ariaLabel="title"
			:columns="columns"
			:sort-by="sortBy"
			:sort-direction="sortDirection"
			:rows="rows"
			:column-preferences="columnPreferences"
			:loading="loading"
			:initialized="initialized"
			:error="error"
			:retained="Boolean(rows.length && loading)"
			:stale="stale"
			:has-more="next !== null"
			:loaded-count="rows.length"
			:total-count="total"
			:loading-more="loadingMore"
			:row-class="rowClass"
			:row-label="rowLabel"
			:cell-class="
				(column, row) =>
					column === 'stock_qty'
						? quantityClass(history(row))
						: column === 'item_name'
							? 'history-item-cell'
							: ''
			"
			:services="services"
			@load-more="emit('loadMore')"
			@retry="emit('retry')"
			@sort="emit('sort', $event)"
		>
			<template #cell="{ column, row }">
				<template v-if="column.id === 'document'">
					<div class="history-record">
						<RecordRef
							:kind="String(row.kind || row.doctype || 'Activity')"
							:identity="`${movementLabels[String(row.kind || '')] || '流动'} · ${row.document || ''}`"
							:document-name="String(row.document || '')"
							:status="showStatus ? String(row.docstatus || '') : undefined"
							:disabled="stale || loading || busy"
							@open="record(history(row))"
						/>
					</div>
				</template>
				<template v-else-if="column.id === 'date_time'">{{
					siteDateTime(row.date_time)
				}}</template>
				<template v-else-if="column.id === 'kind'">{{
					movementLabels[String(row.kind || "")] || "其他类型"
				}}</template>
				<template v-else-if="column.id === 'borrower'">{{
					"borrower" in row ? row.borrower : ""
				}}</template>
				<LocationEndpoint
					v-else-if="column.id === 'source_warehouse'"
					:warehouse="String(row.source_warehouse || '')"
					:kind="String(row.kind || '')"
					:borrower="'borrower' in row ? String(row.borrower || '') : ''"
					role="来源位置"
				/>
				<LocationEndpoint
					v-else-if="column.id === 'destination_warehouse'"
					:warehouse="String(row.destination_warehouse || '')"
					:kind="String(row.kind || '')"
					:borrower="'borrower' in row ? String(row.borrower || '') : ''"
					role="去向位置"
				/>
				<div v-else-if="column.id === 'item_name'" class="history-item-identity">
					<ItemImage
						:item="{
							code: String(row.item_code || ''),
							name: String(row.item_name || row.item_code || ''),
							image: String(row.image || ''),
						}"
						:thumbnail-size="24"
						:target-size="24"
					/>
					<span>{{ row.item_name || row.item_code }}</span>
				</div>
				<UiButton
					v-else-if="column.id === 'item_code'"
					variant="ghost"
					size="compact"
					:disabled="stale || loading || busy"
					@click="emit('openItem', String(row.item_code || ''))"
					>{{ row.item_code }}</UiButton
				>
				<template v-else-if="column.id === 'borrowed'">{{
					"borrowed" in row
						? `${formatQuantity(Number(row.borrowed))} ${row.stock_uom || ""}`
						: ""
				}}</template>
				<template v-else-if="column.id === 'outstanding'">{{
					"outstanding" in row
						? `${formatQuantity(Number(row.outstanding))} ${row.stock_uom || ""}`
						: ""
				}}</template>
				<template v-else-if="column.id === 'stock_uom'">{{ row.stock_uom }}</template>
				<template v-else-if="column.id === 'stock_qty'">
					<span :class="quantityClass(history(row))">{{ quantity(history(row)) }}</span>
					<small
						v-if="['movement', 'handling'].includes(mode)"
						class="history-effect-note"
						>{{ effectText(history(row)) }}</small
					>
				</template>
				<template
					v-else-if="
						column.id === 'outstanding' &&
						row.kind === 'Loan' &&
						row.outstanding != null
					"
					>{{ formatQuantity(Number(row.outstanding)) }} {{ row.stock_uom }}</template
				>
				<template v-else-if="column.id === 'loan_status'">{{ loanStatus(row) }}</template>
				<slot v-else-if="column.id === '_actions'" name="actions" :row="history(row)" />
			</template>
		</DataTable>
		<div class="movement-history-mobile" :aria-busy="loading || undefined">
			<p v-if="loading && !initialized" class="history-mobile-state" role="status">
				正在加载记录…
			</p>
			<p v-if="error" class="history-mobile-state" role="alert">
				{{ error }} <UiButton size="compact" @click="emit('retry')">重试</UiButton>
			</p>
			<button class="history-mobile-sort" type="button" @click="emit('sort', 'date')">
				日期 {{ sortBy === "date" ? (sortDirection === "asc" ? "↑" : "↓") : "↕" }}
			</button>
			<p class="history-mobile-count" role="status">
				{{ rows.length }} / {{ total }} 条记录
			</p>
			<article
				v-for="row in rows"
				:key="row.id"
				class="history-mobile-row"
				:class="rowClass(row.value)"
			>
				<div class="history-mobile-primary">
					<div class="history-mobile-identity">
						<InventoryIcon :name="historyIcon(history(row.value))" />
						<span class="history-mobile-kind">{{
							movementLabels[String(row.value.kind || "")] || "其他类型"
						}}</span>
						<RecordRef
							:kind="String(row.value.kind || row.value.doctype || 'Activity')"
							:identity="compactDocumentName(String(row.value.document || ''))"
							:document-name="String(row.value.document || '')"
							:accessible-label="`${movementLabels[String(row.value.kind || '')] || '其他类型'}记录 ${row.value.document || ''}`"
							:disabled="stale || loading || busy"
							@open="record(history(row.value))"
						/>
					</div>
					<NativeStatusBadge
						v-if="showStatus"
						class="history-mobile-status"
						:status="row.value.docstatus"
					/>
				</div>
				<div class="history-mobile-secondary">
					<div class="history-mobile-place">
						<time>{{ compactDate(String(row.value.date_time || "")) }}</time>
						<span class="history-mobile-endpoints">
							<LocationEndpoint
								:warehouse="String(row.value.source_warehouse || '')"
								:kind="String(row.value.kind || '')"
								:borrower="
									'borrower' in row.value ? String(row.value.borrower || '') : ''
								"
								role="来源位置"
							/>
							<span aria-hidden="true">→</span>
							<LocationEndpoint
								:warehouse="String(row.value.destination_warehouse || '')"
								:kind="String(row.value.kind || '')"
								:borrower="
									'borrower' in row.value ? String(row.value.borrower || '') : ''
								"
								role="去向位置"
							/>
						</span>
					</div>
					<strong :class="quantityClass(history(row.value))"
						>{{ quantity(history(row.value)) }} {{ row.value.stock_uom }}</strong
					>
				</div>
			</article>
			<p
				v-if="initialized && !rows.length && !loading && !error"
				class="history-mobile-state"
			>
				没有符合条件的记录
			</p>
			<UiButton
				v-if="next !== null"
				size="compact"
				:loading="loadingMore"
				:disabled="stale"
				@click="emit('loadMore')"
				>加载更多 · {{ rows.length }} / {{ total }}</UiButton
			>
		</div>
	</section>
</template>

<style scoped>
.movement-history-surface {
	min-width: 0;
}
.movement-history-mobile {
	display: none;
}
.history-item-identity {
	display: flex;
	align-items: center;
	gap: var(--p-space-2);
	min-width: 0;
}
.history-item-identity > span {
	min-width: 0;
	overflow-wrap: anywhere;
}
.movement-history-surface :deep(td.history-item-cell) {
	padding-block: var(--p-space-2);
}
.history-item-identity :deep(.item-image-button--compact-target) {
	width: 24px !important;
	height: 24px !important;
	min-height: 24px;
}
.history-record {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 4px;
}
.history-record :deep(.ui-button),
.movement-history-surface :deep(td > .ui-button) {
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
.history-effect-up :deep(td) {
	background: color-mix(in srgb, var(--p-success) 7%, var(--p-surface));
}
.history-effect-down :deep(td) {
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
	.movement-history-surface :deep(.movement-history-table) {
		display: none;
	}
	.movement-history-mobile {
		display: grid;
		gap: 8px;
		padding: 8px 0;
	}
	.history-mobile-row {
		min-width: 0;
		padding: 8px 10px;
		border: 1px solid var(--p-border);
		border-radius: var(--p-radius-card);
		background: var(--p-surface);
	}
	.history-mobile-primary,
	.history-mobile-secondary,
	.history-mobile-endpoints {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 6px;
	}
	.history-mobile-primary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: 6px;
	}
	.history-mobile-identity {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 5px;
	}
	.history-mobile-kind {
		flex: 0 0 auto;
	}
	.history-mobile-identity :deep(.record-ref-chip) {
		flex: 0 1 auto;
		min-width: 0;
		max-width: 100%;
	}
	.history-mobile-status {
		white-space: nowrap;
	}
	.history-mobile-kind,
	.history-mobile-secondary time {
		color: var(--p-muted);
		white-space: nowrap;
	}
	.history-mobile-secondary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		margin-top: 6px;
		font-size: var(--p-small);
	}
	.history-mobile-place {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		min-width: 0;
		gap: 4px 8px;
	}
	.history-mobile-endpoints {
		flex-wrap: wrap;
		justify-content: flex-start;
		min-width: 0;
	}
	.history-mobile-endpoints :deep(.location-endpoint) {
		max-width: 92px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.history-mobile-secondary strong {
		grid-column: 2;
		grid-row: 1;
		align-self: start;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.history-mobile-sort {
		justify-self: start;
		padding: 4px 9px;
		border: 1px solid var(--p-border);
		border-radius: 999px;
		background: var(--p-surface);
		color: var(--p-ink);
	}
	.history-mobile-count {
		margin: -6px 0 0;
		color: var(--p-muted);
		font-size: var(--p-small);
		text-align: start;
	}
	.movement-history-surface :deep(td.history-item-cell) {
		padding-block: 0;
	}
	.history-item-identity :deep(.item-image-button--compact-target) {
		width: 44px !important;
		height: 44px !important;
		min-height: 44px;
	}
	.history-record :deep(.ui-button),
	.movement-history-surface :deep(td > .ui-button) {
		min-height: 44px;
	}
}
</style>
