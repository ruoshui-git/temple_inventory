<script setup lang="ts">
import { useOptionalReferenceData } from "../../services/contracts";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { nativeStatusLabel } from "../../lib/nativeLabels";
import { siteDateTime } from "../../lib/nativeTime";
import { formatQuantity } from "../../lib/formatQuantity";
import { computed, ref, watch, useSlots } from "vue";
import UiButton from "./UiButton.vue";
import NativeStatusBadge from "./NativeStatusBadge.vue";
import type { ReportTable } from "../../lib/reportContract";
const props = withDefaults(
	defineProps<{
		table: ReportTable;
		limit?: number;
		total?: number;
		loading?: boolean;
		initialized?: boolean;
		error?: string;
		documentLinks?: boolean;
	}>(),
	{ documentLinks: true, initialized: true },
);
const emit = defineEmits<{
	loadMore: [];
	retry: [];
	openDocument: [doctype: string, name: string];
}>();
const reference = useOptionalReferenceData();
const slots = useSlots();
const visibleColumns = computed(() => props.table.columns.filter((column) => column !== "id"));
const loaded = ref(30);
const visibleLimit = computed(
	() => props.limit ?? (props.total === undefined ? loaded.value : props.table.rows.length),
);
watch(
	() => props.table.rows,
	() => {
		loaded.value = 30;
	},
);
const labels: Record<string, string> = {
	posting_timestamp: "入账时间",
	time: "时间",
	loan_status: "整笔借用状态",
	doctype: "记录类型",
	document: "记录编号",
	document_id: "记录标识",
	line_name: "明细编号",
	bundle_line: "批次明细编号",
	item_code: "物品编号",
	item_name: "物品名称",
	stock_qty: "库存数量",
	available_effect: "可用库存变化",
	stock_uom: "库存单位",
	entered_qty: "填写数量",
	entered_uom: "填写单位",
	conversion_factor: "记录换算率",
	warehouse: "位置",
	warehouse_label: "位置名称",
	source_warehouse: "来源位置",
	destination_warehouse: "目标位置",
	origin_warehouse: "原存放位置",
	batch_no: "批次",
	expiry_date: "到期日期",
	manufacturing_date: "生产日期",
	remaining_days: "剩余天数",
	activity_title: "活动名称",
	activity_type: "活动类型编号",
	activity_type_label: "活动类型",
	original_loan: "原借出编号",
	original_loan_line: "原借出明细",
	original_activity: "原借出活动",
	original_activity_title: "原借出活动名称",
	outcome: "结算结果",
	outcome_key: "结清情况",
	baseline_qty: "账面数量",
	actual_qty: "已核对实点",
	difference: "调整差异",
	review_state: "核对状态",
	count_scope: "盘点范围",
	baseline_timestamp: "账面基准时间",
	period_from: "期间开始",
	period_to: "期间结束",
	native_running_qty: "原生流水余额",
	item_count: "物品种数",
	document_count: "单据数",
	allocation_count: "明细条数",
	has_outstanding: "有未归还借用",
	start_date: "开始日期",
	end_date: "结束日期",
	balance_at: "结余快照",
	recorded_by: "系统录入账户",
	amended_from: "修订原记录",
	file_name: "文件名",
	parent_doctype: "附件记录类型",
	snapshot: "快照时间",
	type: "仓库类型",
	state: "附件状态",
	outstandingLines: "未归还明细数",
	groupLabel: "分组名称",
	itemIds: "物品编码",
	loanName: "原借用编号",
	code: "物品编码",
	uom: "单位",
	qty: "借用数量",
	location: "库位",
	batch: "批次",
	quantities: "数量（按单位）",
	reviewedLines: "已核对行数",
	unreviewedLines: "未核对行数",
	reversalOf: "冲销原单据",
	documentType: "单据类型",
	documentId: "单据编号",
	lineId: "明细编号",
	postingDate: "日期",
	postingTime: "时间",
	kind: "流动类型",
	operation: "操作",
	status: "状态",
	docstatus: "状态",
	itemId: "物品编码",
	item: "物品",
	category: "类别",
	stockQty: "库存数量",
	stockUom: "库存单位",
	enteredQty: "填写数量",
	enteredUom: "填写单位",
	conversionFactor: "记录换算率",
	sourceLocationId: "来源库位",
	locationId: "库位",
	batchId: "批次",
	activityId: "活动编号",
	activity: "活动",
	activityTypeId: "活动类型编号",
	activityType: "活动类型",
	borrower: "借用方",
	source: "来源",
	purpose: "用途",
	recorder: "记录人",
	handler: "经手人",
	reviewer: "鉴证人",
	notes: "详细备注",
	loanId: "原借用编号",
	loanLineId: "原借用明细",
	relationship: "关联来源",
	group: "分组",
	lines: "明细数",
	available: "可用",
	loaned: "借出",
	damaged: "损坏",
	lost: "遗失",
	total: "合计",
	borrowed: "借用",
	returned: "正常归还",
	outstanding: "未归还",
	opening: "期初",
	incoming: "流入",
	outgoing: "流出",
	adjustment: "调整",
	closing: "期末",
	baseline: "账面",
	actual: "实点",
	variance: "有符号差异",
	reviewed: "已核对",
	reason: "原因",
	expiry: "到期日期",
	manufacturingDate: "生产日期",
	remainingDays: "剩余天数",
	title: "名称",
	start: "开始日期",
	end: "结束日期",
	description: "简短说明",
	owner: "创建人",
	created: "创建时间",
	modified: "更新时间",
	modifiedBy: "修改人",
	movementCounts: "终身已提交单据数",
	itemLines: "物品行数",
	date: "日期",
	date_time: "日期 / 时间",
	quantity: "数量 / 单位",
	id: "标识",
	balance: "权威基准余额",
	fileId: "文件编号",
	fileName: "文件名",
	label: "名称",
	parentId: "上级编号",
	isGroup: "分组节点",
	tracksBatch: "批次管理",
	tracksExpiry: "效期管理",
	factor: "换算率",
	barcode: "条码",
};
function cell(column: string, value: unknown, row: Record<string, unknown>) {
	if (["source_warehouse", "destination_warehouse"].includes(column) && !value) return "外部";
	if (value === "" || value === undefined || value === null) return "";
	if (column === "docstatus") return nativeStatusLabel(value);
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
		kind: {
			Receive: "入库",
			Issue: "出库",
			Transfer: "调拨",
			Loan: "借出",
			Return: "归还",
			Damage: "损坏",
			Loss: "遗失",
			Repair: "修复",
			Disposal: "报废",
			Reconcile: "盘点调整",
			Opening: "期初库存",
		},
		docstatus: { "0": "草稿", "1": "已提交", "2": "已取消" },
		status: { Active: "进行中", Archived: "已归档" },
		doctype: {
			"Stock Entry": "库存流动",
			"Stock Reconciliation": "库存调整",
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
function stockEffect(row: Record<string, unknown>) {
	if (Number(row.docstatus) === 0 || Number(row.docstatus) === 2) return 0;
	return Number(row.available_effect || 0);
}
function quantityTone(column: string, row: Record<string, unknown>) {
	if (row[column] === null || row[column] === undefined || row[column] === "") return "";
	if (!["stock_qty", "available_effect"].includes(column) || row.available_effect === undefined)
		return "";
	const value = stockEffect(row);
	return value > 0
		? "stock-effect is-increase"
		: value < 0
			? "stock-effect is-decrease"
			: "stock-effect is-neutral";
}
function quantityEffectLabel(row: Record<string, unknown>) {
	const effect = stockEffect(row),
		unit = String(row.stock_uom || "");
	return effect > 0
		? `可用库存增加 ${effect} ${unit}`
		: effect < 0
			? `可用库存减少 ${Math.abs(effect)} ${unit}`
			: `可用库存不变 · ${unit}`;
}
</script>
<template>
	<div
		class="report-table-wrap"
		:data-browse-scroll="'table:' + table.id"
		tabindex="0"
		:aria-label="table.label + ' · 可横向滚动'"
	>
		<table>
			<caption>
				{{
					table.label
				}}
				·
				{{
					!table.rows.length && (loading || initialized === false || error)
						? "—"
						: (total ?? table.rows.length)
				}}
				行完整结果 · 显示
				{{
					Math.min(visibleLimit, table.rows.length)
				}}
				行
			</caption>
			<thead>
				<tr>
					<th v-for="column in visibleColumns" :key="column">
						{{ labels[column] || column }}
					</th>
					<th v-if="slots.actions">操作</th>
				</tr>
			</thead>
			<tbody>
				<tr
					v-for="(row, index) in table.rows.slice(0, visibleLimit)"
					:key="String(row.id ?? index)"
					:data-browse-row="table.id + ':' + String(row.id ?? index)"
				>
					<td v-for="column in visibleColumns" :key="column">
						<button
							v-if="
								documentLinks !== false &&
								column === 'document' &&
								row.doctype &&
								row.document
							"
							class="text-button"
							@click="
								emit('openDocument', String(row.doctype), String(row.document))
							"
						>
							{{ row.document }}
						</button>
						<NativeStatusBadge
							v-else-if="column === 'docstatus'"
							:status="row[column]"
						/>
						<template v-else>
							<span
								:class="quantityTone(column, row)"
								:title="
									quantityTone(column, row)
										? quantityEffectLabel(row)
										: undefined
								"
								>{{ cell(column, row[column], row)
								}}<span v-if="quantityTone(column, row)" class="sr-only">{{
									quantityEffectLabel(row)
								}}</span></span
							>
						</template>
					</td>
					<td v-if="slots.actions">
						<slot name="actions" :row="row" :index="index" />
					</td>
				</tr>
			</tbody>
		</table>
		<p v-if="loading || (initialized === false && !error)" role="status">
			{{ table.rows.length ? "正在更新，保留上次结果…" : "正在读取记录…" }}
		</p>
		<p v-else-if="!error && !table.rows.length" class="muted">没有符合条件的记录</p>
	</div>
	<p v-if="error" role="alert">
		{{ error }} <UiButton @click="emit('retry')">重试加载</UiButton>
	</p>
	<UiButton
		v-if="total !== undefined && table.rows.length < total && limit === undefined"
		:loading="loading"
		@click="emit('loadMore')"
		>加载更多 · {{ table.label }}</UiButton
	>
	<UiButton
		v-if="total === undefined && limit === undefined && visibleLimit < table.rows.length"
		@click="loaded += 30"
		>加载更多 · {{ table.label }}</UiButton
	>
</template>
