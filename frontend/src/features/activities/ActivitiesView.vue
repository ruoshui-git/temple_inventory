<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import { siteDateTime } from "../../lib/nativeTime";
import { computed, ref } from "vue";
import ActivityEditor from "./ActivityEditor.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import FilterPanel from "../../components/ui/FilterPanel.vue";
import Overlay from "../../components/ui/Overlay.vue";
import QuickExport from "../../components/QuickExport.vue";
import { movementLabels } from "../../lib/filterPresentation";
import { quantityText } from "../dashboard/useDashboardController";
import type { ReportQuery } from "../../lib/reportContract";
import type { useActivitiesController } from "./useActivitiesController";
const activityEditor = ref<InstanceType<typeof ActivityEditor>>();
defineExpose({
	requestLeave: () => activityEditor.value?.requestLeave() ?? Promise.resolve(true),
});
const movementActionsOpen = ref(false),
	moreActionsOpen = ref(false);
const props = withDefaults(
	defineProps<{
		controller: ReturnType<typeof useActivitiesController>;
		mode: "list" | "detail" | "form";
		name?: string;
		recoveryId?: string;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{ openExport: [query: ReportQuery] }>();
const {
	reference,
	scopeError,
	inheritedChips,
	state,
	tab,
	recordSearch,
	recordType,
	recordStatus,
	recordPeriod,
	current,
	detail,
	filtered,
	filteredRecords,
	records,
	loans,
	report,
	projection,
	loading,
	error,
	busy,
	deleteOpen,
	loadDetail,
	archive,
	remove,
	clear,
	clearSecondary,
	secondaryChips,
	activityMovementCounts,
	activityTypeLabel,
	relatedLoan,
	showSettlements,
	canWrite,
	canDelete,
	open,
	saved,
	edit,
	cancel,
	newActivity,
	linked,
	movement,
	removeSecondary,
	chip,
	more,
} = props.controller;
const page = computed(() => `activity-${props.mode}`);
const variant = computed(() => props.name || "new");
const isEditing = computed(() => !!props.name);
function tabKey(event: KeyboardEvent) {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	tab.value =
		event.key === "Home"
			? "records"
			: event.key === "End"
				? "loans"
				: tab.value === "records"
					? "loans"
					: "records";
	const buttons = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
		'[role="tab"]',
	);
	buttons[tab.value === "records" ? 0 : 1]?.focus();
}
</script>
<template>
	<section class="preview-page preview-activities">
		<p v-if="scopeError" role="alert">{{ scopeError }}</p>
		<div v-if="mode !== 'form' && inheritedChips.length" class="compact-filter-chips">
			<UiButton
				v-for="chip in inheritedChips"
				:key="chip.key"
				:title="chip.label"
				@click="chip.remove()"
				>{{ chip.label }} ×</UiButton
			>
		</div>
		<PageHeader
			><div>
				<h1 tabindex="-1">
					{{
						page === "activity-list"
							? "活动"
							: page === "activity-form"
								? isEditing
									? "编辑活动"
									: "新建活动"
								: current?.title || "活动不可用"
					}}
				</h1>
			</div>
			<template #actions
				><QuickExport
					v-if="page !== 'activity-form'"
					:query="report"
					:active="active"
					@open-full="emit('openExport', $event)"
				/>
				<UiButton v-if="page === 'activity-list'" variant="primary" @click="newActivity"
					>新建活动</UiButton
				></template
			></PageHeader
		>
		<ActivityEditor
			ref="activityEditor"
			v-if="page === 'activity-form'"
			class="surface form-section"
			:activity-id="name"
			:recovery-id="recoveryId"
			@saved="saved"
			@cancel="cancel"
		/>
		<template v-else-if="page === 'activity-list'">
			<section class="surface form-section">
				<div class="report-inline-controls">
					<label class="preview-field"
						>搜索活动<input
							v-model="state.search"
							placeholder="名称、编号、说明或备注" /></label
					><label class="preview-field"
						>状态<select v-model="state.status">
							<option value="active">进行中</option>
							<option value="archived">已归档</option>
							<option value="all">全部</option>
						</select></label
					><SearchSelect
						label="活动类型"
						v-model="state.typeId"
						:options="reference.activityTypes"
					/><PeriodFilter
						:today="reference.siteDate"
						v-model="state.period"
						label="开始日期"
						:context="`${page}/${variant}`"
						:active="active"
					/><UiButton @click="clear">清空筛选</UiButton>
				</div>

				<div class="compact-filter-toolbar">
					<FilterPanel
						label="更多筛选"
						:count="secondaryChips.length"
						:context="`${page}/${variant}`"
						:active="active"
					>
						<div class="preview-filter-fields">
							<label class="preview-field"
								>流动类型<select v-model="state.kind">
									<option value="">全部</option>
									<option
										v-for="(label, kind) in movementLabels"
										:key="kind"
										:value="kind"
									>
										{{ label }}
									</option>
								</select></label
							><label class="preview-field"
								>关联记录<select v-model="state.presence">
									<option value="all">全部</option>
									<option value="yes">有记录</option>
									<option value="no">无记录</option>
								</select></label
							><label class="preview-choice-label"
								><input
									type="checkbox"
									v-model="state.outstanding"
								/>有未归还借用</label
							>
						</div>
						<template #footer
							><span role="status">{{ projection.result.total }} 个活动</span
							><UiButton @click="clearSecondary">清空筛选</UiButton></template
						>
					</FilterPanel>
					<FilterPanel label="排序" :context="`${page}/${variant}`" :active="active">
						<label class="preview-field"
							>排序<select v-model="state.sort">
								<option value="updated">最近更新优先</option>
								<option value="title">名称</option>
								<option value="start">开始日期</option>
							</select></label
						>
					</FilterPanel>
				</div>
				<div
					v-if="secondaryChips.length"
					class="compact-filter-chips"
					aria-label="已应用次要筛选"
				>
					<UiButton
						v-for="chip in secondaryChips"
						:key="chip.key"
						variant="ghost"
						:aria-label="`移除${chip.label}`"
						@click="removeSecondary(chip.key)"
						>{{ chip.label }} <span aria-hidden="true">×</span></UiButton
					>
				</div>
			</section>
			<p v-if="projection.result.snapshot" role="status">
				{{ projection.result.total }} 个活动 · 流动标签为终身已提交单据数
			</p>
			<p v-if="projection.result.loading" role="status">正在加载活动…</p>
			<p v-else-if="projection.result.error" role="alert">
				{{ projection.result.error }}<UiButton @click="projection.refresh">重试</UiButton>
			</p>
			<div v-else class="activity-list">
				<article
					v-for="activity in filtered"
					:key="activity.id"
					:data-browse-row="activity.id"
					class="surface activity-card"
				>
					<div>
						<UiButton
							variant="ghost"
							:disabled="projection.result.stale"
							@click="open(activity.id)"
							>{{ activity.title }}</UiButton
						>
						<p class="muted">
							{{ activity.id }} · {{ activityTypeLabel(activity.typeId) }}
						</p>
					</div>
					<dl class="preview-info-grid">
						<div>
							<dt>日期</dt>
							<dd>
								{{ activity.start || "未设日期"
								}}{{ activity.end ? " 至 " + activity.end : "" }}
							</dd>
						</div>
						<div>
							<dt>状态</dt>
							<dd>{{ activity.status === "archived" ? "已归档" : "进行中" }}</dd>
						</div>
						<div>
							<dt>更新（站点时间）</dt>
							<dd>{{ siteDateTime(activity.modified) }}</dd>
						</div>
					</dl>
					<div class="form-actions">
						<UiButton
							v-for="count in activityMovementCounts(activity.id)"
							:key="count.kind"
							@click="chip(activity.id, count.kind)"
							>{{ movementLabels[count.kind] }} {{ count.count }}</UiButton
						><span v-if="activity.has_outstanding" class="badge warning"
							>有未归还借用</span
						>
					</div>
				</article>
				<p
					v-if="
						projection.mainTable.value?.initialized &&
						!projection.result.loading &&
						!projection.result.error &&
						!projection.result.total
					"
					class="surface form-section"
				>
					没有符合条件的活动。可清空筛选或新建活动。
				</p>
			</div>
			<UiButton
				v-if="projection.mainTable.value?.next != null"
				@click="more"
				:loading="projection.mainTable.value?.loading"
				>加载更多</UiButton
			>
		</template>
		<template v-else-if="current">
			<div class="form-actions">
				<UiButton v-if="canWrite" :disabled="busy" @click="edit">编辑</UiButton>
				<UiButton v-if="current.status === 'active'" @click="movementActionsOpen = true"
					>新建流动</UiButton
				>
				<Overlay
					v-if="movementActionsOpen"
					title="新建流动"
					@close="movementActionsOpen = false"
				>
					<div class="form-actions">
						<UiButton
							v-for="kind in [
								'Receive',
								'Issue',
								'Transfer',
								'Loan',
								'Return',
								'Damage',
								'Loss',
								'Repair',
								'Disposal',
							]"
							:key="kind"
							@click="
								movementActionsOpen = false;
								movement(kind);
							"
							>{{ movementLabels[kind] }}</UiButton
						>
					</div>
				</Overlay>
				<UiButton @click="moreActionsOpen = true">更多操作</UiButton>
				<Overlay v-if="moreActionsOpen" title="更多操作" @close="moreActionsOpen = false">
					<div class="form-actions">
						<UiButton :disabled="busy || !canWrite" @click="archive">{{
							current.status === "archived" ? "恢复活动" : "归档活动"
						}}</UiButton
						><UiButton
							variant="danger"
							:disabled="busy || !canDelete"
							@click="
								moreActionsOpen = false;
								deleteOpen = true;
							"
							>删除活动</UiButton
						>
					</div>
					<p>删除需要没有任何关联记录；有关联记录时请归档。</p>
				</Overlay>
			</div>
			<p v-if="error" role="alert">{{ error }}</p>
			<section class="surface form-section">
				<h2>活动概览</h2>
				<dl class="preview-info-grid">
					<div>
						<dt>编号</dt>
						<dd>{{ current.id }}</dd>
					</div>
					<div>
						<dt>类型</dt>
						<dd>{{ activityTypeLabel(current.typeId) }}</dd>
					</div>
					<div>
						<dt>开始 / 结束</dt>
						<dd>
							{{ current.start || "未设日期" }} / {{ current.end || "未设日期" }}
						</dd>
					</div>
					<div>
						<dt>状态</dt>
						<dd>{{ current.status === "archived" ? "已归档" : "进行中" }}</dd>
					</div>
					<div>
						<dt>创建（站点时间）</dt>
						<dd>{{ current.owner }} · {{ siteDateTime(current.created) }}</dd>
					</div>
					<div>
						<dt>更新（站点时间）</dt>
						<dd>{{ current.modifiedBy }} · {{ siteDateTime(current.modified) }}</dd>
					</div>
				</dl>
				<p class="preview-long-text">{{ current.description || "未填写说明" }}</p>
				<h3>直接关联 · 终身已提交流动</h3>
				<div class="activity-movement-totals">
					<p v-for="count in activityMovementCounts(current.id)" :key="count.kind">
						{{ movementLabels[count.kind] }} {{ count.count }} 份 ·
						{{
							quantityText(
								(detail?.movement_totals || [])
									.filter((row) => row.kind === count.kind)
									.map((row) => ({
										qty: Number(row.stock_qty),
										uom: String(row.stock_uom),
									})),
							)
						}}
					</p>
				</div>
				<p>
					当前未归还：{{ detail?.outstanding_line_count || 0 }} 行 ·
					{{
						quantityText(
							(detail?.loan_totals || []).map((row) => ({
								qty: Number(row.outstanding),
								uom: String(row.stock_uom),
							})),
						)
					}}
				</p>

				<details>
					<summary>详细备注</summary>
					<div class="preview-long-text activity-notes">
						{{ current.notes || "未填写备注" }}
					</div>
				</details>
			</section>
			<div class="form-actions" role="tablist" aria-label="活动相关资料" @keydown="tabKey">
				<UiButton
					role="tab"
					id="activity-records-tab"
					aria-controls="activity-records-panel"
					:tabindex="tab === 'records' ? 0 : -1"
					:aria-selected="tab === 'records'"
					@click="tab = 'records'"
					>关联记录</UiButton
				><UiButton
					role="tab"
					id="activity-loans-tab"
					aria-controls="activity-loans-panel"
					:tabindex="tab === 'loans' ? 0 : -1"
					:aria-selected="tab === 'loans'"
					@click="tab = 'loans'"
					>借用结余</UiButton
				>
			</div>
			<section
				v-if="tab === 'records'"
				id="activity-records-panel"
				aria-labelledby="activity-records-tab"
				class="surface form-section"
				role="tabpanel"
			>
				<div class="report-inline-controls">
					<label class="preview-field"
						>搜索关联记录<input v-model="recordSearch" /></label
					><PeriodFilter
						:today="reference.siteDate"
						v-model="recordPeriod"
						label="记账日期"
					/><label class="preview-field"
						>流动类型<select v-model="recordType">
							<option value="">全部</option>
							<option
								v-for="(label, kind) in movementLabels"
								:key="kind"
								:value="kind"
							>
								{{ label }}
							</option>
						</select></label
					><label class="preview-field"
						>单据状态<select v-model="recordStatus">
							<option value="1">已提交</option>
							<option value="0">草稿</option>
							<option value="2">已取消</option>
							<option value="all">全部</option>
						</select></label
					>
				</div>
				<p v-if="relatedLoan">
					原借用：{{ relatedLoan }}
					<UiButton @click="relatedLoan = ''">清除原借用限制</UiButton>
				</p>
				<article
					v-for="(row, index) in filteredRecords"
					:key="index"
					:data-browse-row="String(records[index]?.id)"
					class="activity-record"
				>
					<UiButton variant="ghost" @click="linked(row.name, row.documentType)"
						>{{ row.documentType || "Stock Entry" }} / {{ row.name }}</UiButton
					>
					<p>
						{{ row.date }} {{ row.postingTime || "未记录时间" }} ·
						{{ movementLabels[row.kind] }} ·
						{{ ["草稿", "已提交", "已取消"][row.docstatus] }} · {{ row.relationship }}
					</p>
					<p>
						{{ row.itemName }} · {{ row.qty }} {{ row.uom }} ·
						{{ row.batch || "无批次" }}
					</p>
					<p>{{ row.from }} → {{ row.to }}</p>
					<p v-if="row.loanName">
						原借用
						<UiButton @click="linked(row.loanName!)">{{ row.loanName }}</UiButton>
					</p>
				</article>
				<p
					v-if="
						projection.mainTable.value?.initialized &&
						!projection.result.loading &&
						!projection.result.error &&
						!filteredRecords.length
					"
				>
					没有符合条件的关联记录
				</p>
				<p class="muted">附件通过各单据的详情查看。</p>
			</section>
			<section
				v-else
				id="activity-loans-panel"
				aria-labelledby="activity-loans-tab"
				class="surface form-section"
				role="tabpanel"
			>
				<article
					v-for="line in loans"
					:key="line.lineId"
					:data-browse-row="line.lineId"
					class="activity-record"
				>
					<UiButton @click="linked(line.loanName)">{{ line.loanName }}</UiButton>
					<p>
						{{ line.code }} · {{ line.uom }} · 借用 {{ line.qty }} · 正常归还
						{{ line.returned }} · 损坏 {{ line.damaged }} · 遗失 {{ line.lost }} ·
						未归还 {{ line.outstanding }}
					</p>
					<UiButton @click="showSettlements(line.loanName)">查看结算记录</UiButton>
				</article>
				<p
					v-if="
						projection.mainTable.value?.initialized &&
						!projection.result.loading &&
						!projection.result.error &&
						!loans.length
					"
				>
					暂无借用结余
				</p>
			</section>
		</template>
		<p v-else-if="loading" role="status">正在读取活动…</p>
		<p v-else role="alert">
			{{ error || "活动不存在或不可访问。" }} <UiButton @click="loadDetail">重试</UiButton>
		</p>
		<template v-if="page === 'activity-detail'">
			<p v-if="projection.result.loading" role="status">正在更新相关资料…</p>
			<p v-if="projection.result.error" role="alert">
				{{ projection.result.error }} <UiButton @click="projection.refresh">重试</UiButton>
			</p>
			<p v-if="projection.mainTable.value?.error" role="alert">
				{{ projection.mainTable.value.error }}
			</p>
			<UiButton
				v-if="projection.mainTable.value?.next != null"
				:disabled="projection.mainTable.value.loading"
				@click="more"
				>加载更多</UiButton
			>
		</template>
		<Overlay v-if="deleteOpen" title="删除活动" @close="deleteOpen = false"
			><p>删除活动「{{ current?.title }}」？已有任何引用的活动不能删除。</p>
			<template #footer
				><UiButton @click="deleteOpen = false">取消</UiButton
				><UiButton variant="danger" :disabled="busy" @click="remove"
					>确认删除</UiButton
				></template
			></Overlay
		>
	</section>
</template>
