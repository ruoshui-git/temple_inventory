<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import { useReferenceData } from "../../services/contracts";
import { nativeStatusLabel } from "../../lib/nativeLabels";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { siteDateTime } from "../../lib/nativeTime";
import { computed } from "vue";
import type { ReportQuery } from "../../lib/reportContract";
import type { LoanDetail, SettlementAction } from "./useLoanDetail";
import UiButton from "../../components/ui/UiButton.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import Attachments from "../../components/Attachments.vue";
import QuickExport from "../../components/QuickExport.vue";
const props = withDefaults(defineProps<{ controller: LoanDetail; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	back: [];
	openDocument: [doctype: string, name: string];
	item: [code: string];
	activity: [name: string];
	settle: [name: string, action: SettlementAction];
	openExport: [query: ReportQuery];
}>();
const c = props.controller;
const reference = useReferenceData();
const { loan, loading, error, files, status, metrics } = c;
const actions = [
	["returned", "登记归还"],
	["damaged", "登记损坏归还"],
	["lost", "记录遗失"],
] as const;
const deskLink = computed(() =>
	loan.value ? `/app/stock-entry/${encodeURIComponent(loan.value.name)}` : "",
);
function settle(action: SettlementAction) {
	if (loan.value && c.canSettle(action)) emit("settle", loan.value.name, action);
}
</script>
<template>
	<section class="browse-page">
		<PageHeader
			><h1 tabindex="-1">借用详情</h1>
			<template #back><UiButton @click="emit('back')">返回</UiButton></template
			><template #actions
				><QuickExport
					v-if="loan"
					:query="c.exportQuery.value"
					:active="active"
					@open-full="emit('openExport', $event)" /></template
		></PageHeader>
		<p v-if="loading" role="status">正在读取借出记录与当前结余…</p>
		<p v-if="error" class="notice-bar danger" role="alert">
			{{ error }} <UiButton @click="c.load">重新读取</UiButton>
		</p>
		<article v-if="loan" class="browse-detail-card">
			<div class="browse-card-heading">
				<div>
					<span class="eyebrow"
						>{{ loan.name }} · {{ loan.posting_date }}
						{{ loan.posting_time?.slice(0, 5) }}</span
					>
					<h2>{{ loan.ti_borrower }}</h2>
					<UiButton
						variant="ghost"
						size="compact"
						v-if="loan.activity_title"
						@click="emit('activity', loan.ti_activity)"
					>
						{{ loan.activity_title }}
					</UiButton>
					<p v-else class="muted">
						{{ loan.ti_activity ? `活动 ${loan.ti_activity}` : "未关联活动" }}
					</p>
				</div>
				<span
					class="browse-badge"
					:class="
						c.hasOutstanding.value
							? 'is-warning'
							: loan.docstatus === 1
								? 'is-success'
								: ''
					"
					>{{ nativeStatusLabel(loan.docstatus)
					}}{{ loan.docstatus === 1 ? ` · ${status}` : "" }}</span
				>
			</div>
			<p class="browse-note">
				借出日期为原记录日期；结余按当前已提交且未取消的处理记录计算。{{
					loan.balance_at ? `结余快照（站点时间） ${siteDateTime(loan.balance_at)}` : ""
				}}
			</p>
			<div
				v-for="line in loan.items"
				:key="line.name"
				:data-browse-row="line.name"
				class="browse-loan-line"
			>
				<div>
					<UiButton variant="ghost" size="compact" @click="emit('item', line.item_code)">
						<strong>{{ line.item_name || line.item_code }}</strong>
					</UiButton>
					<small>{{ line.item_code }}</small>
				</div>
				<div>
					<span
						>借出 {{ line.transfer_qty }} · 未结清 {{ line.outstanding_qty }} ·
						完好归还 {{ line.outcomes.Returned }} · 损坏 {{ line.outcomes.Damaged }} ·
						遗失 {{ line.outcomes.Lost }} {{ line.stock_uom }}</span
					>
					<details>
						<summary>存放明细与单位换算</summary>
						<small
							>原存放
							{{
								warehouseLabel(
									line.s_warehouse,
									reference.warehouses,
									line.s_warehouse_label,
								)
							}}
							→ 实际借出位置
							{{
								warehouseLabel(
									line.t_warehouse,
									reference.warehouses,
									line.t_warehouse_label,
								)
							}}</small
						>
						<small
							>填写 {{ line.qty }} {{ line.uom }} · 1 {{ line.uom }} =
							{{ line.conversion_factor }} {{ line.stock_uom }}</small
						>
						<div
							v-for="allocation in line.allocations"
							:key="allocation.batch_no"
							class="browse-note"
						>
							{{ allocation.batch_no ? `批次 ${allocation.batch_no}` : "不分批次" }}
							· 借出 {{ allocation.borrowed_qty }} · 未结清
							{{ allocation.outstanding_qty }} · 完好归还
							{{ allocation.outcomes.Returned }} · 损坏
							{{ allocation.outcomes.Damaged }} · 遗失 {{ allocation.outcomes.Lost }}
							{{ line.stock_uom }}
						</div>
					</details>
				</div>
			</div>
			<details>
				<summary>按库存单位汇总</summary>
				<QuantitySummary :metrics="metrics" />
			</details>
			<details>
				<summary>处理历史（{{ c.history.result.total }} 条明细）</summary>
				<h2>处理历史</h2>
				<MovementHistoryTable
					mode="handling"
					include-item
					:rows="c.history.result.rows"
					:total="c.history.result.total"
					:next="c.history.result.next"
					:loading="c.history.result.loading"
					:initialized="c.history.result.initialized"
					:error="c.history.result.error"
					:stale="c.history.result.stale"
					:history-complete="c.history.result.historyComplete"
					@load-more="c.history.loadMore"
					@retry="c.history.refresh"
					@open-document="(doctype, name) => emit('openDocument', doctype, name)"
					@open-item="emit('item', $event)"
				/>
			</details>
			<details>
				<summary>附件（{{ files.files.length }}）</summary>
				<h2>附件</h2>
				<p v-if="files.error.value" role="alert">
					{{ files.error.value }} <UiButton @click="c.loadFiles()">重试</UiButton>
				</p>
				<Attachments :controller="files" mode="display" />
			</details>
			<details>
				<summary>记录资料</summary>
				<dl class="browse-detail-grid">
					<div
						v-for="(value, label) in {
							用途: loan.ti_purpose_text,
							记录人: loan.ti_recorder_name,
							经办人: loan.ti_handler_name,
							复核人: loan.ti_reviewer_name,
							系统录入账户: loan.owner,
							备注: loan.remarks,
							修订自: loan.amended_from,
						}"
						:key="label"
					>
						<dt>{{ label }}</dt>
						<dd class="preview-long-text">{{ value || "未填写" }}</dd>
					</div>
				</dl>
			</details>
			<div class="browse-actions">
				<UiButton
					v-for="[action, label] in actions.filter(([action]) => c.canSettle(action))"
					:key="action"
					:variant="action === 'returned' ? 'primary' : undefined"
					@click="settle(action)"
					>{{ label }}</UiButton
				>
				<UiButton @click="emit('openDocument', 'Stock Entry', loan.name)">{{
					loan.docstatus === 0 ? "继续编辑草稿" : "查看记录生命周期"
				}}</UiButton>
				<a :href="deskLink" target="_blank" rel="noopener">在 ERPNext Desk 中打开</a>
			</div>
		</article>
	</section>
</template>

<style scoped>
.browse-card-heading > div,
.browse-loan-line > div {
	min-width: 0;
}
.browse-badge {
	flex-shrink: 0;
	white-space: nowrap;
}
.browse-loan-line small {
	display: block;
}
.browse-loan-line {
	overflow-wrap: anywhere;
}
@media (max-width: 1023px) {
	.browse-loan-line {
		flex-direction: column;
	}
}
</style>
