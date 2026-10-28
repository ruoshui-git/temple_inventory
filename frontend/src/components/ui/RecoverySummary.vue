<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { JsonValue } from "../../lib/browserRecovery";
import UiButton from "./UiButton.vue";
import DataTable from "./DataTable.vue";
import type { DataColumn, DataTableRecord } from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { useOptionalInventoryServices, useOptionalReferenceData } from "../../services/contracts";
import { showToast } from "../../services/toast";
import ItemLine from "./ItemLine.vue";
import LocationEndpoint from "./LocationEndpoint.vue";
import { recoveryLabels } from "../../lib/presentationLabels";

const props = defineProps<{
	kind: string;
	values: Record<string, unknown>;
	copyText: string;
	pendingUploadReselection?: boolean;
}>();
const copyFailed = ref(false);
const fallback = ref<HTMLTextAreaElement>();
const labels: Record<string, string> = {
	item_code: "物品编号",
	code: "物品编号",
	item_name: "物品名称",
	name: "名称",
	item_group: "分类",
	category: "分类",
	stock_uom: "库存单位",
	uom: "计量单位",
	barcode: "条码",
	description: "说明",
	has_batch_no: "按批次管理",
	tracksBatch: "按批次管理",
	has_expiry_date: "记录效期",
	tracksExpiry: "记录效期",
	title: "活动名称",
	activity_type: "活动类型",
	typeId: "活动类型",
	status: "状态",
	docstatus: "单据状态",
	notes: "详细备注",
	kind: "操作类型",
	start: "开始日期",
	end: "结束日期",
	posting_date: "操作日期",
	posting_time: "操作时间",
	ti_movement_kind: "操作类型",
	ti_time_mode: "时间方式",
	ti_borrower: "借用方",
	ti_activity: "关联活动",
	ti_source_text: "来源",
	ti_purpose_text: "用途",
	ti_recorder_name: "记录人",
	ti_handler_name: "经办人",
	ti_reviewer_name: "复核人",
	ti_count_warehouses: "盘点位置范围",
	ti_count_scope: "盘点范围",
	ti_notes: "盘点备注",
	ti_baseline_timestamp: "账面基准时间",
	warehouse: "仓库 / 位置",
	label: "名称",
	parent: "上级位置",
	short_label: "简称",
	action: "编辑方式",
	disabled: "停用",

	whole: "只允许整数",
	group: "允许下级分类",
	editingCode: "原物品编号",
	editingName: "记录",
	editingWarehouse: "原仓库",
	qty: "数量",
	stock_qty: "库存数量",
	actual_qty: "实点数量",
	reason: "差异说明",
	batch_no: "批次",
	s_warehouse: "来源位置",
	t_warehouse: "去向位置",
	transfer_qty: "库存数量",
	conversion_factor: "单位换算",
	remarks: "备注",
	ti_count_review: "盘点明细",
	attachments: "附件",
};
const normalizedValues = computed(() => {
	const values: Record<string, unknown> = { ...props.values };
	const aliases: Record<string, string> = {
		code: "item_code",
		category: "item_group",
		uom: "stock_uom",
		postingDate: "posting_date",
		postingTime: "posting_time",
		timeMode: "ti_time_mode",
		source: "ti_source_text",
		sourceText: "ti_source_text",
		note: "remarks",
		purpose: "ti_purpose_text",
		activity: "ti_activity",
		borrower: "ti_borrower",
		warehouses: "ti_count_warehouses",
		scope: "ti_count_scope",
		notes: "ti_notes",
	};
	if (props.kind === "Item") aliases.name = "item_name";
	if (props.kind === "Stock Entry") aliases.kind = "ti_movement_kind";
	for (const [alias, canonical] of Object.entries(aliases)) {
		if (values[canonical] === undefined && values[alias] !== undefined)
			values[canonical] = values[alias];
		if (values[canonical] !== undefined && alias !== canonical) delete values[alias];
	}
	return values;
});
const fields = computed(() => {
	const referenceKeys =
		props.kind === "UOM"
			? new Set(["name", "whole"])
			: props.kind === "Item Group"
				? new Set(["name", "parent", "group"])
				: undefined;
	const known = Object.entries(labels).filter(
		([key]) =>
			key in normalizedValues.value &&
			normalizedValues.value[key] !== undefined &&
			!(props.kind === "Stock Entry" && key === "name" && !normalizedValues.value[key]) &&
			(!referenceKeys || referenceKeys.has(key)),
	);
	const excluded = new Set(["items", "ti_count_review", "attachments"]);
	return known
		.filter(([key]) => !excluded.has(key))
		.map(([key, label]) => ({
			key,
			label,
			value: format(
				(normalizedValues.value as Record<string, JsonValue | undefined>)[key],
				key,
			),
		}));
});
const rows = computed(() => {
	const key = props.kind === "Stock Reconciliation" ? "ti_count_review" : "items";
	const source = key ? props.values[key] : undefined;
	if (!Array.isArray(source)) return [];
	return source.map((value) => {
		const row =
			value && typeof value === "object" && !Array.isArray(value)
				? (value as Record<string, JsonValue>)
				: {};
		const qty = row.entryQty ?? row.qty ?? row.actual_qty;
		const uom = row.entryUom ?? row.uom ?? row.stock_uom;
		return {
			...row,
			item_code: row.item_code ?? row.code,
			item_name: row.item_name,
			qty,
			uom,
			transfer_qty: row.transfer_qty ?? row.stock_qty ?? row.qty,
			transfer_uom: row.transfer_uom ?? row.stock_uom ?? row.uom,
			s_warehouse: row.s_warehouse ?? row.sourceLocation ?? row.warehouse,
			t_warehouse: row.t_warehouse ?? row.destination ?? row.targetLocation ?? row.location,
			warehouse: row.warehouse ?? row.location,
			batch_no: row.batch_no ?? row.batch,
		} as Record<string, JsonValue>;
	});
});
const rowColumns = computed(() => {
	if (props.kind === "Stock Reconciliation")
		return [
			["item_code", "物品"],
			["item_name", "名称"],
			["stock_uom", "库存单位"],
			["warehouse", "库位"],
			["batch_no", "批次"],
			["baseline_qty", "账面数量"],
			["actual_qty", "实点数量"],
			["review_state", "核对状态"],
			["reason", "说明"],
		];
	return [
		["item_code", "物品"],
		["item_name", "名称"],
		["qty", "填写数量"],
		["uom", "单位"],
		["transfer_qty", "库存数量"],
		["transfer_uom", "库存单位"],
		["s_warehouse", "来源"],
		["t_warehouse", "去向"],
		["batch_no", "批次"],
	];
});
const tableColumns = computed<DataColumn[]>(() =>
	rowColumns.value.map(([key, label], index) => ({
		id: key,
		label,
		required: index === 0,
		defaultVisible: true,
	})),
);
const tableRows = computed<DataTableRecord[]>(() =>
	rows.value.map((row, index) => ({
		kind: "record",
		id: String(row.name || row.item_code || index),
		value: row as unknown as Record<string, unknown>,
	})),
);
const services = useOptionalInventoryServices();
const reference = useOptionalReferenceData();
const itemMetadata = ref<Record<string, { item_name: string; image?: string }>>({});
let metadataGeneration = 0;
let disposed = false;
onBeforeUnmount(() => {
	disposed = true;
	metadataGeneration++;
});
watch(
	() => ({
		account: reference?.user || "",
		codes: [...new Set(rows.value.map((row) => String(row.item_code || "")).filter(Boolean))],
	}),
	async ({ account, codes }) => {
		const generation = ++metadataGeneration;
		itemMetadata.value = {};
		if (!services || !codes.length || !account) return;
		try {
			const result = await services.call<
				Record<string, { item_name: string; image?: string }>
			>("catalog.item_display_summaries", {
				item_codes: codes,
			});
			if (!disposed && generation === metadataGeneration && account === reference?.user)
				itemMetadata.value = result;
		} catch {
			// Summary names are optional; inaccessible Items fall back to their codes.
		}
	},
	{ immediate: true },
);
const preferenceTableId = computed(() => {
	const kind = props.kind
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return `recovery-summary.${kind || "record"}`;
});
const tablePrefs =
	services && reference
		? useColumnPreferences(preferenceTableId, tableColumns, reference, services)
		: undefined;
function format(value: JsonValue | undefined, key?: string): string {
	if (value === undefined || value === null || value === "") return "未填写";
	if (typeof value === "boolean") return value ? "是" : "否";
	if (typeof value === "string" || typeof value === "number") {
		const label = key ? recoveryLabels[key]?.[String(value)] : undefined;
		return label || String(value);
	}
	return Array.isArray(value) ? `${value.length} 项` : "已填写";
}
function valueOf(row: Record<string, JsonValue>, key: string) {
	return format(row[key], key);
}
function recoveryCell(row: Record<string, unknown>, key: string) {
	if (key === "item_name")
		return String(
			itemMetadata.value[String(row.item_code || "")]?.item_name ||
				row.item_name ||
				row.item_code ||
				"未填写",
		);
	return valueOf(row as Record<string, JsonValue>, key);
}
async function copy() {
	try {
		if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
		await navigator.clipboard.writeText(props.copyText);
		copyFailed.value = false;
		showToast("恢复数据已复制");
	} catch {
		copyFailed.value = true;
		requestAnimationFrame(() => {
			fallback.value?.focus();
			fallback.value?.select();
		});
	}
}
</script>
<template>
	<section class="recovery-summary" aria-label="恢复输入摘要">
		<dl v-if="fields.length" class="info-grid">
			<div v-for="field in fields" :key="field.key">
				<dt>{{ field.label }}</dt>
				<dd class="content-long-text">{{ field.value }}</dd>
			</div>
		</dl>
		<DataTable
			v-if="rows.length"
			ariaLabel="恢复摘要明细"
			table-class="browse-table recovery-summary-table"
			:columns="tableColumns"
			:rows="tableRows"
			:column-preferences="tablePrefs"
		>
			<template #cell="{ column, row }">
				<ItemLine
					v-if="column.id === 'item_name' && row.item_code"
					:item="{
						code: String(row.item_code),
						name: String(
							itemMetadata[String(row.item_code)]?.item_name ||
								row.item_name ||
								row.item_code,
						),
						image: String(
							itemMetadata[String(row.item_code)]?.image ||
								row.ti_display_image ||
								'',
						),
					}"
				/>
				<LocationEndpoint
					v-else-if="['s_warehouse', 't_warehouse'].includes(String(column.id))"
					:warehouse="String(row[column.id] || '')"
					:kind="String(row.ti_movement_kind || row.kind || '')"
					:borrower="String(row.ti_borrower || '')"
					:role="column.id === 's_warehouse' ? '来源位置' : '去向位置'"
				/>
				<span v-else class="content-long-text">{{
					recoveryCell(row, String(column.id))
				}}</span>
			</template>
		</DataTable>
		<p
			v-if="pendingUploadReselection || values.pendingUploadReselection === true"
			class="muted"
		>
			待上传文件需要重新选择；文件内容不包含在恢复输入中。
		</p>
		<div class="recovery-summary-actions">
			<slot />
			<UiButton @click="copy">复制完整恢复数据</UiButton>
		</div>
		<p v-if="copyFailed" role="alert">无法自动复制。下方文字可完整选中并复制：</p>
		<textarea
			v-if="copyFailed"
			ref="fallback"
			class="recovery-copy-fallback"
			readonly
			:value="copyText"
			rows="8"
			aria-label="完整恢复数据"
		/>
	</section>
</template>
<style scoped>
.recovery-summary {
	display: grid;
	gap: 12px;
	min-width: 0;
}
.recovery-summary-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
}
.recovery-copy-fallback {
	width: 100%;
	min-height: 12rem;
	font: 12px/1.5 monospace;
}
.recovery-summary-table td {
	vertical-align: top;
}
</style>
