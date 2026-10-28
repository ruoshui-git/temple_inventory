<script setup lang="ts">
import { computed, ref, useSlots } from "vue";
import { useOptionalInventoryServices, useOptionalReferenceData } from "../../services/contracts";
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import { nativeStatusLabel } from "../../lib/nativeLabels";
import { siteDateTime } from "../../lib/nativeTime";
import { formatQuantity } from "../../lib/formatQuantity";
import type {
	DataColumn,
	DataTableEntry,
	DataTableGroup,
	DataTableRecord,
} from "../../lib/dataTable";
import type { ReportTable as ReportTableData } from "../../lib/reportContract";
import UiButton from "./UiButton.vue";
import NativeStatusBadge from "./NativeStatusBadge.vue";
import ItemImage from "../ItemImage.vue";
import DataTable from "./DataTable.vue";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import type { useReportGroups } from "../../composables/useReportGroups";
import { reportColumnLabels } from "../../lib/reportCells";
import { dataColumnKind } from "../../lib/dataTable";
import { movementLabels } from "../../lib/filterPresentation";
import { enumPresentationLabel } from "../../lib/presentationLabels";
import LocationEndpoint from "./LocationEndpoint.vue";
import { RouterLink } from "vue-router";
import { routeTarget } from "../../lib/routeRegistry";
import { unitLabel, sortByUnit } from "../../lib/units";
import { stockEffectLabel } from "../../lib/stockEffectLabel";

const props = withDefaults(
	defineProps<{
		table: ReportTableData;
		hiddenColumns?: string[];
		preferenceId?: string;
		limit?: number;
		total?: number;
		loading?: boolean;
		initialized?: boolean;
		error?: string;
		stale?: boolean;
		documentLinks?: boolean;
		stickyActions?: boolean;
		grouped?: boolean;
		sortableColumns?: string[];
		sortBy?: string;
		sortDirection?: "asc" | "desc";
		groupPages?: ReturnType<typeof useReportGroups>;
	}>(),
	{ documentLinks: true },
);
const emit = defineEmits<{
	loadMore: [];
	retry: [];
	openDocument: [doctype: string, name: string];
	sort: [column: string];
}>();
const slots = useSlots();
const services = useOptionalInventoryServices();
const reference = useOptionalReferenceData();
const loaded = ref(30);
const visibleLimit = computed(
	() => props.limit ?? (props.total === undefined ? loaded.value : props.table.rows.length),
);
const visibleRows = computed(() => props.table.rows.slice(0, visibleLimit.value));
const groupRoot = computed(() => props.groupPages?.pages.value["[[],null]"]);
function groupProgress(groupId?: string) {
	const controller = props.groupPages as
		| (ReturnType<typeof useReportGroups> & {
				progress?: (id?: string) => { loaded: number; total: number };
		  })
		| undefined;
	return controller?.progress?.(groupId) || { loaded: 0, total: 0 };
}
function columnLabel(column: string) {
	if (column === "parent" && props.table.id === "warehouses") return "上级位置";
	if (column === "parent" && props.table.id === "files") return "所属物品";
	return reportColumnLabels[column] || column;
}
const presentationOnlyLeafFields = new Set([
	"image",
	"batch_tracked",
	"has_expiry_date",
	"disabled",
]);
const quantityColumns = new Set([
	"available",
	"loaned",
	"borrowed",
	"returned",
	"damaged",
	"lost",
	"outstanding",
	"opening",
	"incoming",
	"outgoing",
	"adjustment",
	"closing",
	"baseline_qty",
	"actual_qty",
	"difference",
	"stock_qty",
	"entered_qty",
	"quantity",
]);
const hasItemIdentity = computed(() =>
	props.table.rows.some((row) => Boolean(row.item_code || row.itemId)),
);
const columns = computed<DataColumn[]>(() => {
	const baseColumns =
		props.grouped && props.groupPages?.leafColumns?.value.length
			? props.groupPages.leafColumns.value
			: props.table.columns;
	const sourceColumns =
		hasItemIdentity.value && !baseColumns.includes("image")
			? ["image", ...baseColumns]
			: baseColumns;
	const data: DataColumn[] = sourceColumns
		.filter(
			(column) =>
				column !== "id" &&
				(!props.hiddenColumns?.includes(column) ||
					(column === "image" && hasItemIdentity.value)) &&
				(!props.grouped || !presentationOnlyLeafFields.has(column)),
		)
		.map((column) => ({
			id: column,
			label: column === "image" ? "图片" : columnLabel(column),
			defaultVisible: true,
			required:
				(column === "image" && hasItemIdentity.value) ||
				["item_code", "itemId", "document", "documentId"].includes(column),
			sortable: props.sortableColumns?.includes(column) || false,
			sortField: column,
			kind:
				column === "image"
					? "thumb"
					: quantityColumns.has(column)
						? "number"
						: dataColumnKind({
								id: column,
								label: column === "image" ? "图片" : columnLabel(column),
							}),
			className: [
				quantityColumns.has(column) ? "report-quantity-cell" : "",
				["batch", "batch_no"].includes(column) ? "report-batch-column" : "",
			]
				.filter(Boolean)
				.join(" "),
		}));
	if (slots.actions)
		data.push({
			id: "_actions",
			label: "操作",
			defaultVisible: true,
			required: true,
			kind: "actions",
			className: props.stickyActions ? "report-sticky-actions-column" : undefined,
		});
	return data;
});
const columnPreferences =
	services && reference
		? useColumnPreferences(
				computed(() => props.preferenceId || `report.${props.table.id}`),
				columns,
				reference,
				services,
			)
		: undefined;
function columnIsVisible(id: string) {
	if (columnPreferences) return columnPreferences.visible.value.includes(id);
	return columns.value.some((column) => String(column.id) === id && column.defaultVisible);
}
function unitForQuantity(column: string, row: Record<string, unknown>) {
	if (column === "entered_qty") return String(row.entered_uom || row.uom || "");
	if (column === "quantity") return String(row.uom || row.stock_uom || "");
	return String(row.stock_uom || "");
}
function unitColumnVisible(column: string, row: Record<string, unknown>) {
	if (column === "entered_qty") return columnIsVisible(row.entered_uom ? "entered_uom" : "uom");
	if (column === "quantity") return columnIsVisible(row.uom ? "uom" : "stock_uom");
	return columnIsVisible("stock_uom");
}
function quantityText(column: string, value: number, row: Record<string, unknown>) {
	if (column === "quantity") {
		const sign = row.signed && value > 0 ? "+" : value < 0 ? "−" : "";
		return `${sign}${formatQuantity(Math.abs(value))}`;
	}
	return formatQuantity(value);
}
const tableRows = computed<DataTableEntry[]>(() =>
	props.grouped && props.groupPages
		? props.groupPages.entries.value
		: visibleRows.value.map((row, index) => ({
				kind: "record",
				id: String(row.id ?? index),
				value: row,
			})),
);
const hasMore = computed(() =>
	props.total !== undefined
		? props.table.rows.length < props.total && props.limit === undefined
		: props.limit === undefined && visibleLimit.value < props.table.rows.length,
);

function cell(column: string, value: unknown, row: Record<string, unknown>) {
	if (value === "" || value === undefined || value === null) return "";
	if (
		[
			"kind",
			"docstatus",
			"status",
			"loan_status",
			"doctype",
			"outcome_key",
			"outcome",
			"review_state",
			"count_scope",
			"relationship",
		].includes(column)
	)
		return enumPresentationLabel(column, value);
	if (column === "activity_type")
		return (
			reference?.activityTypes.find((option) => option.value === String(value))?.label ||
			"活动类型未知"
		);
	if (
		[
			"warehouse",
			"source_warehouse",
			"destination_warehouse",
			"origin_warehouse",
			"locationId",
			"sourceLocationId",
		].includes(column)
	)
		return warehouseLabel(value, reference?.warehouses || [], row[column + "_label"]);
	if (
		[
			"snapshot",
			"modified",
			"creation",
			"balance_at",
			"posting_timestamp",
			"baseline_timestamp",
			"date_time",
		].includes(column)
	)
		return siteDateTime(value);
	if (column === "quantity" && typeof value === "number") {
		const amount = formatQuantity(Math.abs(value));
		return `${row.signed && value > 0 ? "+" : value < 0 ? "−" : ""}${amount} ${String(row.stock_uom || "")}`.trim();
	}
	if (typeof value === "boolean") return value ? "是" : "否";
	const dictionary: Record<string, Record<string, string>> = {
		kind: movementLabels,
		docstatus: { "0": "草稿", "1": "已提交", "2": "已取消" },
		status: { Active: "进行中", Archived: "已归档" },
		loan_status: {
			Draft: "草稿",
			Cancelled: "已取消",
			Open: "未结清",
			Settled: "已结清",
			Closed: "已结清",
		},
		doctype: {
			"Stock Entry": "库存流动",
			"Stock Reconciliation": movementLabels.Reconcile,
			"Purchase Receipt": "采购收货",
			"Delivery Note": "销售发货",
		},
		review_state: { Unreviewed: "尚未核对", Reviewed: "已核对" },
		count_scope: { Selected: "选定物品", "Full Location": "整个库位" },
		outcome_key: {
			outstanding: "未归还",
			returned: "完好归还",
			damaged: "损坏归还",
			lost: "遗失",
		},
		outcome: { Returned: "完好归还", Damaged: "损坏归还", Lost: "遗失" },
		relationship: {
			direct: "直接关联",
			"via original loan": "经原借出关联",
			indirect: "经原借出关联",
		},
	};
	return dictionary[column]?.[String(value)] ?? value;
}

function displayCell(column: string, value: unknown, row: Record<string, unknown>) {
	if (quantityColumns.has(column) && typeof value === "number") {
		const quantity = quantityText(column, value, row);
		if (unitColumnVisible(column, row)) return quantity;
		return `${quantity} ${unitForQuantity(column, row)}`.trim();
	}
	return cell(column, value, row);
}
function warehouseCellTitle(column: string, value: unknown, row: Record<string, unknown>) {
	if (
		![
			"warehouse",
			"source_warehouse",
			"destination_warehouse",
			"origin_warehouse",
			"locationId",
			"sourceLocationId",
		].includes(column)
	)
		return undefined;
	return warehousePath(value, reference?.warehouses || [], row[column + "_label"]);
}

function stockEffect(row: Record<string, unknown>) {
	if (Number(row.docstatus) === 0 || Number(row.docstatus) === 2) return 0;
	return Number(row.available_effect || 0);
}

function quantityTone(column: string, row: Record<string, unknown>) {
	if (row[column] === null || row[column] === undefined || row[column] === "") return "";
	if (!["stock_qty", "available_effect"].includes(column) || row.available_effect === undefined)
		return "";
	const effect = stockEffect(row);
	return effect > 0
		? "stock-effect is-increase"
		: effect < 0
			? "stock-effect is-decrease"
			: "stock-effect is-neutral";
}

function quantityEffectLabel(row: Record<string, unknown>) {
	return stockEffectLabel(stockEffect(row));
}

function loadMore() {
	if (props.grouped && props.groupPages) void props.groupPages.loadMore();
	else if (props.total !== undefined) emit("loadMore");
	else loaded.value += 30;
}
function toggleGroup(id: string) {
	if (props.groupPages) void props.groupPages.toggleGroup(id);
}
function groupLoadMore(group: DataTableGroup) {
	if (props.groupPages) void props.groupPages.loadMore(group.id);
}
function groupRetry(group: DataTableGroup) {
	if (props.groupPages) void props.groupPages.retry(group.id);
}
function groupHasMore(group: DataTableGroup) {
	return props.groupPages?.hasMore(group.id) || false;
}
function groupSummary(group: DataTableGroup) {
	const row = group.value || {};
	const metrics = [
		"available",
		"loaned",
		"borrowed",
		"returned",
		"damaged",
		"lost",
		"outstanding",
		"opening",
		"incoming",
		"outgoing",
		"adjustment",
		"closing",
		"baseline_qty",
		"actual_qty",
		"difference",
		"stock_qty",
	];
	const parts = metrics
		.filter((key) => row[key] !== undefined && row[key] !== null)
		.filter((key) => key !== "stock_qty" || Number(row[key]) !== 0)
		.map((key) => {
			const value = row[key];
			const rendered =
				typeof value === "number" ? quantityText(key, value, row) : cell(key, value, row);
			const unit = unitForQuantity(key, row);
			return `${reportColumnLabels[key] || key} ${rendered}${unit ? ` ${unitLabel(unit)}` : ""}`;
		});
	if (Array.isArray(row.quantity_breakdown)) {
		for (const entry of sortByUnit(
			row.quantity_breakdown as Record<string, unknown>[],
			(entry) => String(entry.stock_uom || entry.uom || row.stock_uom || ""),
		)) {
			const kind = movementLabels[String(entry.kind)] || String(entry.kind || "记录");
			const status =
				entry.docstatus === undefined ? "" : `（${nativeStatusLabel(entry.docstatus)}）`;
			const quantity = entry.stock_qty;
			if (quantity !== undefined && quantity !== null)
				parts.push(
					`${kind}${status} ${formatQuantity(Number(quantity))}${entry.stock_uom || entry.uom || row.stock_uom ? ` ${unitLabel(String(entry.stock_uom || entry.uom || row.stock_uom))}` : ""}`,
				);
		}
	}
	return [...new Set(parts)].join(" · ");
}
function groupMetric(group: DataTableGroup, column: string) {
	const row = group.value || {};
	if (column === "stock_qty" && Array.isArray(row.quantity_breakdown)) {
		return sortByUnit(
			(row.quantity_breakdown as Record<string, unknown>[]).filter(
				(entry) => Number(entry.stock_qty || 0) !== 0,
			),
			(entry) => String(entry.stock_uom || entry.uom || row.stock_uom || ""),
		)
			.map((entry) => {
				const kind = movementLabels[String(entry.kind)] || String(entry.kind || "记录");
				const hasStatus = (row.quantity_breakdown as Record<string, unknown>[]).some(
					(other) => other.kind === entry.kind && other.docstatus !== entry.docstatus,
				);
				const status = hasStatus ? `（${nativeStatusLabel(entry.docstatus)}）` : "";
				const unit = entry.stock_uom || entry.uom || row.stock_uom || "";
				return `${kind}${status} ${formatQuantity(Number(entry.stock_qty))} ${unitLabel(String(unit))}`.trim();
			})
			.join(" / ");
	}
	if (
		[
			"item_count",
			"document_count",
			"allocation_count",
			"row_count",
			"display_count",
			"stock_uom",
		].includes(column)
	)
		return "";
	const value = row[column];
	if (typeof value === "number" && unitForQuantity(column, row))
		return `${quantityText(column, value, row)} ${unitLabel(unitForQuantity(column, row))}`;
	return value === undefined || value === null ? "" : cell(column, value, row);
}
</script>

<template>
	<div
		class="report-table-wrap"
		:data-browse-scroll="'table:' + table.id"
		:aria-label="table.label + ' · 可横向滚动'"
	>
		<div class="report-table-caption muted" data-table-settings-outlet>
			<span>{{
				(total ?? table.rows.length) +
				` 行完整结果 · 显示 ${Math.min(visibleLimit, table.rows.length)} 行`
			}}</span>
		</div>
		<DataTable
			:ariaLabel="table.label"
			:columns="columns"
			:rows="tableRows"
			:sort-by="sortBy"
			:sort-direction="sortDirection"
			:column-preferences="columnPreferences"
			:loading="grouped && groupPages ? Boolean(groupRoot?.loading) : loading"
			:initialized="
				grouped && groupPages ? Boolean(groupRoot?.initialized) : (initialized ?? !loading)
			"
			:error="grouped && groupPages ? groupRoot?.error || '' : error"
			:stale="grouped && groupPages ? Boolean(groupRoot?.stale) : stale"
			:retained="
				Boolean(
					grouped && groupPages
						? groupRoot?.rows.length && groupRoot.loading && groupRoot.stale
						: table.rows.length && loading,
				)
			"
			:has-more="grouped && groupPages ? groupPages.hasMore() : hasMore"
			:loaded-count="grouped && groupPages ? groupProgress().loaded : visibleRows.length"
			:total-count="
				grouped && groupPages ? groupProgress().total : (total ?? table.rows.length)
			"
			:loading-more="
				grouped && groupPages
					? Boolean(groupPages.pages.value['[[],null]']?.loading)
					: false
			"
			:retry-text="'重试加载'"
			:row-attributes="
				(row) => ({ 'data-browse-row': `${table.id}:${String(row.id ?? '')}` })
			"
			:services="services"
			@load-more="loadMore"
			@toggle-group="toggleGroup"
			@retry="grouped && groupPages ? groupPages.retry() : emit('retry')"
			@sort="emit('sort', $event)"
		>
			<template #cell="{ column, row, value, index }">
				<slot v-if="column.id === '_actions'" name="actions" :row="row" :index="index" />
				<span
					v-else-if="column.id === 'image' && (row.item_code || row.itemId)"
					class="report-item-image"
					:title="String(row.item_name || row.itemName || row.item_code || row.itemId)"
				>
					<ItemImage
						:item="{
							code: String(row.item_code || row.itemId),
							name: String(
								row.item_name || row.itemName || row.item_code || row.itemId,
							),
							image: String(row.image || ''),
						}"
						:thumbnail-size="32"
						:target-size="32"
					/>
				</span>
				<span v-else-if="column.id === 'image'" aria-hidden="true"></span>
				<RouterLink
					v-else-if="column.id === 'item_name' && row.item_code"
					:to="routeTarget('item-detail', { code: String(row.item_code) })"
					class="browse-row-link"
					>{{ value || row.item_code }}</RouterLink
				>
				<button
					v-else-if="
						documentLinks !== false &&
						column.id === 'document' &&
						row.doctype &&
						row.document
					"
					class="text-button"
					@click="emit('openDocument', String(row.doctype), String(row.document))"
				>
					{{ row.document }}
				</button>
				<LocationEndpoint
					v-else-if="
						['source_warehouse', 'destination_warehouse'].includes(String(column.id))
					"
					:warehouse="
						String(row.kind || '') === 'Reconcile' &&
						String(column.id) === 'source_warehouse'
							? String(row.warehouse || value || '')
							: String(value || '')
					"
					:kind="String(row.kind || '')"
					:borrower="String(row.borrower || '')"
					:role="column.id === 'source_warehouse' ? '来源位置' : '去向位置'"
				/>
				<NativeStatusBadge v-else-if="column.id === 'docstatus'" :status="value" />
				<span
					v-else
					:class="quantityTone(String(column.id), row)"
					:title="
						warehouseCellTitle(String(column.id), value, row) ||
						(quantityTone(String(column.id), row)
							? quantityEffectLabel(row)
							: undefined)
					"
				>
					{{
						column.id === "stock_uom" ||
						column.id === "entered_uom" ||
						column.id === "uom"
							? unitLabel(String(value || ""))
							: displayCell(String(column.id), value, row)
					}}
					<span v-if="quantityTone(String(column.id), row)" class="sr-only">{{
						quantityEffectLabel(row)
					}}</span>
				</span>
			</template>
			<template v-if="grouped && groupPages" #group="{ group }">
				<div class="report-group-details">
					<span>{{ groupSummary(group) }}</span>
					<UiButton v-if="group.error" @click="groupRetry(group)">重试</UiButton>
					<UiButton
						v-if="groupHasMore(group)"
						:loading="group.loading"
						@click="groupLoadMore(group)"
						>加载更多此分组 · {{ groupProgress(group.id).loaded }} /
						{{ groupProgress(group.id).total }}</UiButton
					>
				</div>
			</template>
			<template v-if="grouped && groupPages" #group-label="{ group }">
				<span class="data-table-group-visual">
					<ItemImage
						v-if="group.value?.item_code && group.value?.image"
						:item="{
							code: String(group.value.item_code),
							name: String(group.value.item_name || group.label),
							image: String(group.value.image),
						}"
					/>
				</span>
			</template>
			<template v-if="grouped && groupPages" #group-column="{ group, column }">
				<span>{{ groupMetric(group, String(column.id)) }}</span>
			</template>
		</DataTable>
	</div>
</template>

<style scoped>
.report-item-image {
	display: flex;
	align-items: center;
}
</style>
