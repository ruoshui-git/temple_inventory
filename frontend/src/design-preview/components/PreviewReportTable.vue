<script setup lang="ts">
import { computed, ref, watch } from "vue";
import PreviewUiButton from "./PreviewUiButton.vue";
import type { ReportTable } from "../reportModel";
const props = defineProps<{ table: ReportTable; limit?: number }>();
const loaded = ref(30);
const visibleLimit = computed(() => props.limit ?? loaded.value);
watch(
	() => props.table.rows,
	() => {
		loaded.value = 30;
	},
);
const labels: Record<string, string> = {
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
	kind: "类型代码",
	operation: "操作",
	status: "状态",
	docstatus: "状态代码",
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
</script>
<template>
	<div class="report-table-wrap" tabindex="0" :aria-label="table.label + ' · 可横向滚动'">
		<table>
			<caption>
				{{
					table.label
				}}
				·
				{{
					table.rows.length
				}}
				行完整结果 · 显示
				{{
					Math.min(visibleLimit, table.rows.length)
				}}
				行
			</caption>
			<thead>
				<tr>
					<th v-for="column in table.columns" :key="column">
						{{ labels[column] || column }}
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="(row, index) in table.rows.slice(0, visibleLimit)" :key="index">
					<td v-for="column in table.columns" :key="column">
						{{
							typeof row[column] === "boolean"
								? row[column]
									? "是"
									: "否"
								: row[column] === "" || row[column] === undefined
									? "未填写"
									: row[column]
						}}
					</td>
				</tr>
			</tbody>
		</table>
		<p v-if="!table.rows.length" class="muted">没有符合条件的记录</p>
	</div>
	<PreviewUiButton
		v-if="limit === undefined && visibleLimit < table.rows.length"
		@click="loaded += 30"
		>加载更多 · {{ table.label }}</PreviewUiButton
	>
</template>
