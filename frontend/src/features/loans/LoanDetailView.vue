<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import BackButton from "../../components/ui/BackButton.vue";
import { siteDateTime } from "../../lib/nativeTime";
import { computed } from "vue";
import type { ReportQuery } from "../../lib/reportContract";
import type { LoanDetail, SettlementAction } from "./useLoanDetail";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import Attachments from "../../components/Attachments.vue";
import QuickExport from "../../components/QuickExport.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import ItemImage from "../../components/ItemImage.vue";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import RecordRef from "../../components/ui/RecordRef.vue";
import LocationEndpoint from "../../components/ui/LocationEndpoint.vue";
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
const { loan, loading, error, files, status, metrics } = c;
const actions = [
	["returned", "登记归还"],
	["damaged", "登记损坏归还"],
	["lost", "记录遗失"],
] as const;
const deskLink = computed(() =>
	loan.value ? `/app/stock-entry/${encodeURIComponent(loan.value.name)}` : "",
);
const initialLoad = computed(() => loading.value && !loan.value);
function settle(action: SettlementAction) {
	if (loan.value && c.canSettle(action)) emit("settle", loan.value.name, action);
}
</script>
<template>
	<section class="browse-page">
		<PageHeader
			><h1 tabindex="-1">借用详情</h1>
			<template #back><BackButton @click="emit('back')" /></template
			><template #actions
				><QuickExport
					v-if="loan && !loading"
					:query="c.exportQuery.value"
					:active="active"
					@open-full="emit('openExport', $event)" /></template
		></PageHeader>
		<SkeletonBlock v-if="initialLoad" variant="detail" :count="3" :rows="5" />
		<p v-if="error" class="notice-bar danger" role="alert">
			{{ error }} <UiButton @click="c.load">重新读取</UiButton>
		</p>
		<article
			v-if="loan"
			class="browse-detail-card async-result-region"
			:class="{ 'is-refreshing': loading }"
			:aria-busy="loading ? 'true' : undefined"
		>
			<span v-if="loading" class="sr-only" role="status">借出结余刷新中。</span>
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
				<div class="loan-detail-status">
					<NativeStatusBadge :status="loan.docstatus" />
					<span v-if="loan.docstatus === 1" class="browse-badge is-warning">{{
						status
					}}</span>
				</div>
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
					<div class="loan-detail-item-identity">
						<ItemImage
							:item="{
								code: String(line.item_code || ''),
								name: String(
									line.ti_display_item_name ||
										line.item_name ||
										line.item_code ||
										'',
								),
								image: String(line.ti_display_image || ''),
							}"
							:thumbnail-size="24"
							:target-size="24"
						/>
						<span
							><UiButton
								variant="ghost"
								size="compact"
								@click="emit('item', line.item_code)"
								><strong>{{
									line.ti_display_item_name || line.item_name || line.item_code
								}}</strong></UiButton
							><small>{{ line.item_code }}</small></span
						>
					</div>
				</div>
				<div>
					<span
						>借出 {{ line.transfer_qty }} · 未结清 {{ line.outstanding_qty }} ·
						完好归还 {{ line.outcomes.Returned }} · 损坏 {{ line.outcomes.Damaged }} ·
						遗失 {{ line.outcomes.Lost }} {{ line.stock_uom }}</span
					>
					<DisclosureSection
						title="存放明细与单位换算"
						:summary="`按 ${line.stock_uom} 汇总`"
					>
						<small
							>原存放
							<LocationEndpoint
								:warehouse="line.s_warehouse"
								kind="Loan"
								role="来源位置" />
							→ 实际借出位置
							<LocationEndpoint
								:warehouse="line.t_warehouse"
								kind="Loan"
								:borrower="loan.ti_borrower"
								role="去向位置"
						/></small>
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
					</DisclosureSection>
				</div>
			</div>
			<DisclosureSection title="按库存单位汇总" :summary="`${metrics.length} 种库存单位`">
				<div class="detail-stat-grid">
					<QuantitySummary :metrics="metrics" />
				</div>
			</DisclosureSection>
			<DisclosureSection
				title="处理历史"
				:count="c.history.result.total"
				:summary="
					c.history.result.rows[0]?.date_time
						? `最近 ${String(c.history.result.rows[0].date_time).slice(0, 10)}`
						: undefined
				"
			>
				<MovementHistoryTable
					:show-status="false"
					mode="handling"
					include-item
					:rows="c.history.result.rows"
					:total="c.history.result.total"
					:next="c.history.result.next"
					:loading="c.history.result.loading"
					:initialized="c.history.result.initialized"
					:error="c.history.result.error"
					:stale="c.history.result.stale"
					:sort-by="c.history.sortBy.value"
					:sort-direction="c.history.sortDirection.value"
					:history-complete="c.history.result.historyComplete"
					@load-more="c.history.loadMore"
					@retry="c.history.refresh"
					@sort="c.history.setSort"
					@open-document="(doctype, name) => emit('openDocument', doctype, name)"
					@open-item="emit('item', $event)"
				/>
			</DisclosureSection>
			<DisclosureSection title="附件" :count="files.files.length">
				<p v-if="files.error.value" role="alert">
					{{ files.error.value }} <UiButton @click="c.loadFiles()">重试</UiButton>
				</p>
				<Attachments :controller="files" mode="display" />
			</DisclosureSection>
			<DisclosureSection title="记录资料">
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
			</DisclosureSection>
			<div class="browse-actions">
				<UiButton
					v-for="[action, label] in actions.filter(([action]) => c.canSettle(action))"
					:key="action"
					:variant="action === 'returned' ? 'primary' : undefined"
					@click="settle(action)"
					>{{ label }}</UiButton
				>
				<RecordRef
					kind="Loan"
					:identity="`${loan.ti_borrower || '未填写借用方'} ${loan.posting_date.slice(5)}`"
					:status="loan.docstatus"
					:document-name="loan.name"
					:tooltip="loan.docstatus === 0 ? '继续编辑草稿' : '查看借出记录'"
					@open="emit('openDocument', 'Stock Entry', loan.name)"
				/>
				<a :href="deskLink" target="_blank" rel="noopener">在 ERPNext Desk 中打开</a>
			</div>
		</article>
	</section>
</template>

<style scoped>
.loan-detail-status {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 6px;
}
</style>

<style scoped>
.browse-card-heading > div,
.browse-loan-line > div {
	min-width: 0;
}
.browse-loan-line > div:nth-child(2) {
	flex: 1;
}
.loan-detail-item-identity {
	display: flex;
	align-items: center;
	gap: var(--p-space-2);
}
.loan-detail-item-identity :deep(.item-image-button--compact-target) {
	width: 24px !important;
	height: 24px !important;
	min-height: 24px;
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
	.loan-detail-item-identity :deep(.item-image-button--compact-target) {
		width: 44px !important;
		height: 44px !important;
		min-height: 44px;
	}
}
</style>
