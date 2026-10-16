<script setup lang="ts">
import { installActivitiesReviewFixtures } from "./activitiesReviewFixtures";
import { computed, reactive, ref, watch, onActivated } from "vue";
import { activities, activityTypes, activityTypeLabel } from "./activityData";
import {
	activityPermissions,
	activityLoanLines,
	activityMovementCounts,
	relatedActivityRecords,
	deleteActivity,
	setActivityArchived,
} from "./activityModel";
import { reviewSession, createDraft, type OperationKind } from "./reviewModel";
import { movementLabels, inPeriod, quantityText } from "./browseModel";
import { activityUi } from "./activityUiState";
import { newReportQuery } from "./reportModel";
import PreviewActivityEditor from "./components/PreviewActivityEditor.vue";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewSearchSelect from "./components/PreviewSearchSelect.vue";
import PreviewPeriodFilter from "./components/PreviewPeriodFilter.vue";
import PreviewQuickReport from "./components/PreviewQuickReport.vue";

const props = defineProps<{ page: string; variant: string; active?: boolean }>();
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
}>();
const state = activityUi;
const isEditing = computed(
	() => props.variant === "edit" || props.variant.startsWith("edit-ACT-"),
);
function selectRouteActivity() {
	if (props.page === "activity-detail" && props.variant.startsWith("ACT-"))
		state.selected = props.variant;
	if (props.page === "activity-form" && props.variant.startsWith("edit-ACT-"))
		state.selected = props.variant.slice(5);
}
watch(() => [props.page, props.variant], selectRouteActivity, { immediate: true });
onActivated(selectRouteActivity);
watch(
	() => props.variant,
	(variant) => {
		if (variant === "large") installActivitiesReviewFixtures();
	},
	{ immediate: true },
);
const current = computed(() => activities.find((row) => row.id === state.selected));
const error = ref(""),
	loadState = ref<"ready" | "loading" | "error">("ready"),
	limit = ref(12),
	tab = computed({ get: () => state.detailTab, set: (value) => (state.detailTab = value) }),
	recordSearch = computed({
		get: () => state.relatedSearch,
		set: (value) => (state.relatedSearch = value),
	}),
	recordType = computed({
		get: () => state.relatedKind,
		set: (value) => (state.relatedKind = value),
	}),
	recordStatus = computed({
		get: () => state.relatedStatus,
		set: (value) => (state.relatedStatus = value),
	}),
	recordPeriod = computed({
		get: () => state.relatedPeriod,
		set: (value) => (state.relatedPeriod = value),
	});
const records = computed(() => (current.value ? relatedActivityRecords(current.value.id) : []));
const filteredRecords = computed(() =>
	records.value.filter(
		(row) =>
			(!recordType.value || row.kind === recordType.value) &&
			(recordStatus.value === "all" || row.docstatus === Number(recordStatus.value)) &&
			inPeriod(row.date, recordPeriod.value) &&
			`${row.name} ${row.itemName} ${row.code}`
				.toLocaleLowerCase()
				.includes(recordSearch.value.toLocaleLowerCase()),
	),
);
const loans = computed(() => (current.value ? activityLoanLines(current.value.id) : []));
const filtered = computed(() =>
	activities
		.filter((activity) => {
			const counts = activityMovementCounts(activity.id);
			return (
				(state.status === "all" || activity.status === state.status) &&
				(!state.typeId || activity.typeId === state.typeId) &&
				(state.period.key === "all" ||
					(!!activity.start && inPeriod(activity.start, state.period))) &&
				`${activity.id} ${activity.title} ${activity.description} ${activity.notes} ${activityTypeLabel(activity.typeId)}`
					.toLocaleLowerCase()
					.includes(state.search.toLocaleLowerCase()) &&
				(!state.kind || counts.some((row) => row.kind === state.kind)) &&
				(state.presence === "all" ||
					relatedActivityRecords(activity.id).length > 0 ===
						(state.presence === "yes")) &&
				(!state.outstanding ||
					activityLoanLines(activity.id).some((line) => line.outstanding > 0))
			);
		})
		.sort((a, b) =>
			state.sort === "title"
				? a.title.localeCompare(b.title, "zh")
				: state.sort === "start"
					? a.start.localeCompare(b.start)
					: b.modified.localeCompare(a.modified),
		),
);
const report = computed(() => {
	const query = newReportQuery("activities");
	query.sortBy =
		state.sort === "title" ? "name" : state.sort === "updated" ? "modified" : "date";
	query.sort = state.sort === "updated" ? "desc" : "asc";
	query.scope.activity = props.page === "activity-detail" ? state.selected : "";
	if (props.page === "activity-detail") {
		query.view = tab.value === "records" ? "records" : "loans";
		query.relatedPeriod = { ...recordPeriod.value };
		query.relatedSearch = recordSearch.value;
		query.scope.kinds = recordType.value ? [recordType.value] : [];
		query.statuses = recordStatus.value === "all" ? [0, 1, 2] : [Number(recordStatus.value)];
	}
	query.scope.period =
		props.page === "activity-detail" ? { key: "all", from: "", to: "" } : { ...state.period };
	query.search = props.page === "activity-detail" ? "" : state.search;
	query.typeId = props.page === "activity-detail" ? "" : state.typeId;
	query.activityKind = props.page === "activity-detail" ? "" : state.kind;
	query.relatedPresence = props.page === "activity-detail" ? "all" : state.presence;
	query.outstandingOnly = props.page === "activity-detail" ? false : state.outstanding;
	query.activityStatus = props.page === "activity-detail" ? "all" : state.status;
	return query;
});
function go(page: string, variant: string) {
	emit("navigate", page, variant);
}
function open(id: string) {
	resetRelatedFilters();
	state.relatedKind = "";
	state.detailTab = "records";
	state.selected = id;
	go("activity-detail", state.selected);
}
function saved(id: string) {
	state.selected = id;
	emit("notify", "活动已保存（本次预览会话）");
	go("activity-detail", state.selected);
}
function clear() {
	Object.assign(state, {
		search: "",
		status: "active",
		typeId: "",
		period: { key: "all", from: "", to: "" },
		kind: "",
		presence: "all",
		outstanding: false,
		sort: "updated",
	});
	limit.value = 12;
}
function movement(kind: OperationKind) {
	if (!current.value || current.value.status === "archived") return;
	const draft = createDraft(kind, `ACTIVITY-MOVEMENT-${Date.now()}`);
	draft.activity = current.value.id;
	reviewSession.selectedDraftName = draft.name;
	go("movement-form", kind);
}
function archive() {
	error.value = setActivityArchived(state.selected, current.value?.status !== "archived");
}
function remove() {
	error.value = deleteActivity(state.selected);
	if (!error.value) {
		emit("notify", "活动已删除（模拟）");
		go("activity-list", "active");
	}
}
function linked(name: string) {
	reviewSession.selectedMovementName = name;
	go("movement-records", "selected");
}
function chip(id: string, kind: string) {
	resetRelatedFilters();
	state.selected = id;
	recordType.value = kind;
	tab.value = "records";
	go("activity-detail", state.selected);
}
function resetRelatedFilters() {
	recordSearch.value = "";
	recordStatus.value = "1";
	recordPeriod.value = { key: "all", from: "", to: "" };
}
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
		<header class="browse-heading">
			<div>
				<span class="eyebrow">ACTIVITIES / 更多</span>
				<h1>
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
			<div class="form-actions">
				<PreviewUiButton
					v-if="page === 'activity-list'"
					variant="primary"
					@click="go('activity-form', 'new')"
					>新建活动</PreviewUiButton
				><PreviewQuickReport
					v-if="page !== 'activity-form'"
					:query="report"
					:active="active"
					@navigate="go"
					@notify="emit('notify', $event)"
				/>
			</div>
		</header>
		<PreviewActivityEditor
			v-if="page === 'activity-form'"
			class="surface form-section"
			:activity-id="isEditing ? state.selected : undefined"
			@saved="saved"
			@cancel="
				go(
					isEditing ? 'activity-detail' : 'activity-list',
					isEditing ? state.selected : 'active',
				)
			"
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
					><PreviewSearchSelect
						label="活动类型"
						v-model="state.typeId"
						:options="
							activityTypes.map((row) => ({ value: row.id, label: row.label }))
						"
					/><PreviewPeriodFilter
						v-model="state.period"
						label="开始日期"
					/><PreviewUiButton @click="clear">清空筛选</PreviewUiButton>
				</div>
				<details>
					<summary>更多筛选与排序</summary>
					<div class="report-inline-controls">
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
						><label class="preview-field"
							>排序<select v-model="state.sort">
								<option value="updated">最近更新优先</option>
								<option value="title">名称</option>
								<option value="start">开始日期</option>
							</select></label
						>
					</div>
				</details>
			</section>
			<p role="status">{{ filtered.length }} 个活动 · 流动标签为终身已提交单据数</p>
			<p v-if="loadState === 'loading'" role="status">正在加载活动…</p>
			<p v-else-if="loadState === 'error'" role="alert">
				活动加载失败<PreviewUiButton @click="loadState = 'ready'">重试</PreviewUiButton>
			</p>
			<div v-else class="activity-list">
				<article
					v-for="activity in filtered.slice(0, limit)"
					:key="activity.id"
					class="surface activity-card"
				>
					<div>
						<PreviewUiButton variant="ghost" @click="open(activity.id)">{{
							activity.title
						}}</PreviewUiButton>
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
							<dt>更新</dt>
							<dd>{{ activity.modified }}</dd>
						</div>
					</dl>
					<div class="form-actions">
						<PreviewUiButton
							v-for="count in activityMovementCounts(activity.id)"
							:key="count.kind"
							@click="chip(activity.id, count.kind)"
							>{{ movementLabels[count.kind] }} {{ count.count }}</PreviewUiButton
						><span
							v-if="
								activityLoanLines(activity.id).some((line) => line.outstanding > 0)
							"
							class="badge warning"
							>有未归还借用</span
						>
					</div>
				</article>
				<p v-if="!filtered.length" class="surface form-section">
					没有符合条件的活动。可清空筛选或新建活动。
				</p>
			</div>
			<PreviewUiButton v-if="limit < filtered.length" @click="limit += 12"
				>加载更多</PreviewUiButton
			>
			<details>
				<summary>预览状态</summary>
				<label class="preview-field"
					>列表状态<select v-model="loadState">
						<option value="ready">正常</option>
						<option value="loading">加载中</option>
						<option value="error">失败</option>
					</select></label
				>
			</details>
		</template>
		<template v-else-if="current">
			<div class="form-actions">
				<PreviewUiButton @click="go('activity-form', `edit-${state.selected}`)"
					>编辑</PreviewUiButton
				>
				<details v-if="current.status === 'active'">
					<summary>新建流动</summary>
					<div class="form-actions">
						<PreviewUiButton
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
							] as OperationKind[]"
							:key="kind"
							@click="movement(kind)"
							>{{ movementLabels[kind] }}</PreviewUiButton
						>
					</div>
				</details>
				<details>
					<summary>更多操作</summary>
					<div class="form-actions">
						<PreviewUiButton @click="archive">{{
							current.status === "archived" ? "恢复活动" : "归档活动"
						}}</PreviewUiButton
						><PreviewUiButton variant="danger" @click="remove"
							>删除活动</PreviewUiButton
						>
					</div>
					<p>删除需要没有任何关联记录；有关联记录时请归档。</p>
				</details>
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
						<dt>创建</dt>
						<dd>{{ current.owner }} · {{ current.created }}</dd>
					</div>
					<div>
						<dt>更新</dt>
						<dd>{{ current.modifiedBy }} · {{ current.modified }}</dd>
					</div>
				</dl>
				<p class="preview-long-text">{{ current.description || "未填写说明" }}</p>
				<h3>直接关联 · 已提交流动</h3>
				<div class="activity-movement-totals">
					<p v-for="count in activityMovementCounts(current.id)" :key="count.kind">
						{{ movementLabels[count.kind] }} {{ count.count }} 份 ·
						{{
							quantityText(
								records.filter(
									(row) =>
										row.activity === current!.id &&
										row.docstatus === 1 &&
										row.kind === count.kind,
								),
							)
						}}
					</p>
				</div>
				<p>
					当前未归还：{{ loans.filter((line) => line.outstanding > 0).length }} 行 ·
					{{
						quantityText(
							loans.map((line) => ({ qty: line.outstanding, uom: line.uom })),
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
				<PreviewUiButton
					role="tab"
					id="activity-records-tab"
					aria-controls="activity-records-panel"
					:tabindex="tab === 'records' ? 0 : -1"
					:aria-selected="tab === 'records'"
					@click="tab = 'records'"
					>关联记录</PreviewUiButton
				><PreviewUiButton
					role="tab"
					id="activity-loans-tab"
					aria-controls="activity-loans-panel"
					:tabindex="tab === 'loans' ? 0 : -1"
					:aria-selected="tab === 'loans'"
					@click="tab = 'loans'"
					>借用结余</PreviewUiButton
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
					><PreviewPeriodFilter v-model="recordPeriod" label="记账日期" /><label
						class="preview-field"
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
				<article
					v-for="(row, index) in filteredRecords"
					:key="index"
					class="activity-record"
				>
					<PreviewUiButton variant="ghost" @click="linked(row.name)"
						>{{ row.documentType || "Stock Entry" }} / {{ row.name }}</PreviewUiButton
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
						<PreviewUiButton @click="linked(row.loanName!)">{{
							row.loanName
						}}</PreviewUiButton>
					</p>
				</article>
				<p v-if="!filteredRecords.length">没有符合条件的关联记录</p>
				<p class="muted">附件通过各单据的详情查看。</p>
			</section>
			<section
				v-else
				id="activity-loans-panel"
				aria-labelledby="activity-loans-tab"
				class="surface form-section"
				role="tabpanel"
			>
				<article v-for="line in loans" :key="line.lineId" class="activity-record">
					<PreviewUiButton @click="linked(line.loanName)">{{
						line.loanName
					}}</PreviewUiButton>
					<p>
						{{ line.code }} · {{ line.uom }} · 借用 {{ line.qty }} · 正常归还
						{{ line.returned }} · 损坏 {{ line.damaged }} · 遗失 {{ line.lost }} ·
						未归还 {{ line.outstanding }}
					</p>
					<div class="form-actions">
						<PreviewUiButton
							v-for="name in [
								...new Set(
									records
										.filter((row) => row.loanName === line.loanName)
										.map((row) => row.name),
								),
							]"
							:key="name"
							@click="linked(name)"
							>结算 {{ name }}</PreviewUiButton
						>
					</div>
				</article>
				<p v-if="!loans.length">暂无借用结余</p>
			</section>
			<details>
				<summary>预览权限状态</summary>
				<label class="preview-choice-label"
					><input type="checkbox" v-model="activityPermissions.write" />可编辑</label
				><label class="preview-choice-label"
					><input
						type="checkbox"
						:checked="activityPermissions.hiddenReferences.includes(current.id)"
						@change="
							activityPermissions.hiddenReferences =
								activityPermissions.hiddenReferences.includes(current.id)
									? activityPermissions.hiddenReferences.filter(
											(id) => id !== current!.id,
										)
									: [...activityPermissions.hiddenReferences, current.id]
						"
					/>模拟不可见引用阻止删除</label
				>
			</details>
		</template>
		<p v-else role="alert">活动不存在或不可访问。</p>
	</section>
</template>
