<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import PageHeader from "../../components/ui/PageHeader.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { siteDateTime } from "../../lib/nativeTime";
import { computed, ref } from "vue";
import ActivityEditor from "./ActivityEditor.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import Overlay from "../../components/ui/Overlay.vue";
import QuickExport from "../../components/QuickExport.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import { movementLabels } from "../../lib/filterPresentation";
import { periodLabels } from "../../lib/sitePeriod";
import { quantityText } from "../dashboard/useDashboardController";
import { formatQuantity } from "../../lib/formatQuantity";
import type { ReportQuery } from "../../lib/reportContract";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import { removeGroupByField } from "../../lib/groupBy";
import { groupLabels } from "../../lib/reportContract";
import type { useActivitiesController } from "./useActivitiesController";
import DataTable from "../../components/ui/DataTable.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import type {
	DataColumn,
	DataTableEntry,
	DataTableGroup,
	DataTableRecord,
} from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { reportColumnLabels } from "../../lib/reportCells";
import { useOptionalInventoryServices } from "../../services/contracts";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import { RouterLink } from "vue-router";
import RecordRef from "../../components/ui/RecordRef.vue";
import ItemLine from "../../components/ui/ItemLine.vue";
const activityEditor = ref<InstanceType<typeof ActivityEditor>>();
defineExpose({
	requestLeave: () => activityEditor.value?.requestLeave() ?? Promise.resolve(true),
	breadcrumbLabel: () => activityEditor.value?.breadcrumbLabel() || current.value?.title,
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
	recordKinds,
	setRecordKinds,
	recordSort,
	recordSortDirection,
	setRecordSort,
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
	clearRelated,
	chip,
	more,
} = props.controller;
const isRelatedTabSelected = (value: "records" | "loans") => tab.value === value;
const page = computed(() => `activity-${props.mode}`);
const variant = computed(() => props.name || "new");
const recordDateChip = computed(() => {
	if (recordPeriod.value.key === "all") return "";
	const value = recordPeriod.value;
	return value.key === "custom"
		? [value.from, value.to].filter(Boolean).join(" – ") || "日期待补全"
		: periodLabels[value.key];
});
const isEditing = computed(() => !!props.name);
const activityColumns = computed<DataColumn[]>(() => [
	{
		id: "title",
		label: "活动",
		required: true,
		defaultVisible: true,
		sortable: true,
		sortField: "title",
		minWidth: "210px",
	},
	{ id: "typeId", label: "类型", defaultVisible: true, minWidth: "130px" },
	{
		id: "period",
		label: "日期",
		defaultVisible: true,
		sortable: true,
		sortField: "start_date",
		minWidth: "170px",
	},
	{ id: "status", label: "状态", defaultVisible: true, minWidth: "100px" },
	{
		id: "modified",
		label: "更新（站点时间）",
		defaultVisible: true,
		sortable: true,
		sortField: "modified",
		minWidth: "170px",
	},
	{ id: "actions", label: "关联流动", required: true, defaultVisible: true, minWidth: "220px" },
]);
const activityRows = computed<DataTableRecord[]>(() =>
	filtered.value.map((activity) => ({
		kind: "record",
		id: activity.id,
		value: activity as unknown as Record<string, unknown>,
	})),
);
const relatedColumns: DataColumn[] = [
	{ id: "document", label: "记录", sortable: true, minWidth: "190px" },
	{ id: "date", label: "日期", sortable: true, minWidth: "150px" },
	{ id: "kind", label: "类型", minWidth: "110px" },
	{ id: "status", label: "状态", minWidth: "100px" },
	{ id: "item", label: "物品", minWidth: "180px" },
	{ id: "quantity", label: "数量", minWidth: "120px" },
	{ id: "route", label: "来源 → 去向", minWidth: "220px" },
];
const relatedRows = computed<DataTableRecord[]>(() =>
	filteredRecords.value.map((row, index) => ({
		kind: "record",
		id: String(records.value[index]?.id || `${row.documentType}:${row.name}`),
		value: row as unknown as Record<string, unknown>,
	})),
);
function sortActivity(column: string) {
	const sort = column === "title" ? "title" : column === "start_date" ? "start" : "updated";
	if (state.sort === sort) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
	else {
		state.sort = sort;
		state.sortDirection = sort === "updated" ? "desc" : "asc";
	}
}
function sortRelated(column: string) {
	setRecordSort(column);
}
const activityEntries = computed<DataTableEntry[]>(() =>
	report.value.groupBy.length ? projection.groups.entries.value : activityRows.value,
);
const activityGroupRoot = computed(() => projection.groups.pages.value["[[],null]"]);
function activityGroupSummary(group: DataTableGroup) {
	const row = group.value || {};
	return ["document_count", "item_count", "allocation_count", "stock_uom"]
		.filter((key) => row[key] !== undefined)
		.map((key) => `${reportColumnLabels[key] || key} ${row[key]}`)
		.join(" · ");
}
const services = useOptionalInventoryServices();
const activityPrefs = services
	? useColumnPreferences("activities.list", activityColumns, reference, services)
	: undefined;
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
		<PageHeader v-if="page !== 'activity-list'"
			><div>
				<h1 tabindex="-1">
					{{
						page === "activity-list"
							? "活动"
							: page === "activity-form"
								? isEditing
									? "编辑活动"
									: "新建活动"
								: current?.title || (loading ? "正在加载活动…" : "活动不可用")
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
		<BrowseToolbar
			v-else
			title="活动"
			:summary="
				projection.mainTable.value?.initialized
					? `活动 · ${projection.result.total} 个`
					: ''
			"
			v-model:search="state.search"
			search-label="搜索活动"
			:active="active"
			:filter-count="secondaryChips.length + 3"
		>
			<template #actions>
				<BrowseOverflowMenu>
					<QuickExport
						:query="report"
						:active="active"
						@open-full="emit('openExport', $event)"
					/>
				</BrowseOverflowMenu>
				<UiButton variant="primary" @click="newActivity">新建活动</UiButton>
			</template>
			<template #filters>
				<div v-if="mode === 'list'" data-filter-field="groupBy" tabindex="-1">
					<GroupByFilter
						v-if="mode === 'list'"
						v-model="report.groupBy"
						:dataset="report.dataset"
						:view="report.view"
					/>
				</div>
				<div class="preview-filter-fields">
					<label class="preview-field"
						>状态<select v-model="state.status">
							<option value="active">进行中</option>
							<option value="archived">已归档</option>
							<option value="all">全部</option>
						</select></label
					>
					<SearchSelect
						label="活动类型"
						v-model="state.typeId"
						:options="reference.activityTypes"
					/>
					<PeriodFilter
						:today="reference.siteDate"
						v-model="state.period"
						label="开始日期"
						embedded
					/>
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
					>
					<label class="preview-field"
						>关联记录<select v-model="state.presence">
							<option value="all">全部</option>
							<option value="yes">有记录</option>
							<option value="no">无记录</option>
						</select></label
					>
					<label class="preview-choice-label"
						><input type="checkbox" v-model="state.outstanding" />有未归还借用</label
					>
					<UiButton @click="clear">清空筛选</UiButton>
				</div>
			</template>
			<template #chips="{ editFilter }">
				<BrowseChip
					v-for="(group, index) in mode === 'list' ? report.groupBy : []"
					:key="`group:${group}`"
					:label="`分组：${groupLabels[group] || group}`"
					@edit="editFilter('groupBy')"
					@remove="
						report.groupBy = removeGroupByField(
							report.dataset,
							report.view,
							report.groupBy,
							index,
						)
					"
				/>
				<BrowseChip
					v-for="chip in inheritedChips"
					:key="chip.key"
					:label="chip.label"
					@edit="editFilter(chip.field)"
					@remove="chip.remove()"
				/>
				<BrowseChip
					v-for="chip in secondaryChips"
					:key="chip.key"
					:label="chip.label"
					@edit="editFilter()"
					@remove="removeSecondary(chip.key)"
				/>
			</template>
		</BrowseToolbar>
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
			<p v-if="projection.result.snapshot" role="status">
				{{ projection.result.total }} 个活动 · 流动标签为终身已提交单据数
			</p>
			<DataTable
				ariaLabel="活动列表"
				table-class="browse-table"
				:columns="activityColumns"
				:rows="activityEntries"
				:sort-by="report.sortBy"
				:sort-direction="report.sort"
				:column-preferences="activityPrefs"
				:loading="
					projection.result.loading ||
					Boolean(report.groupBy.length && activityGroupRoot?.loading)
				"
				:initialized="
					Boolean(
						projection.mainTable.value?.initialized || activityGroupRoot?.initialized,
					)
				"
				:error="
					report.groupBy.length
						? activityGroupRoot?.error || projection.result.error
						: projection.result.error
				"
				:retained="Boolean(filtered.length && projection.result.loading)"
				:has-more="
					report.groupBy.length
						? projection.groups.hasMore()
						: projection.mainTable.value?.next != null
				"
				:loaded-count="
					report.groupBy.length ? projection.groups.progress().loaded : filtered.length
				"
				:total-count="
					report.groupBy.length
						? projection.groups.progress().total
						: (projection.mainTable.value?.total ?? filtered.length)
				"
				:loading-more="
					report.groupBy.length
						? Boolean(activityGroupRoot?.loading && activityGroupRoot.rows.length)
						: Boolean(projection.mainTable.value?.loading && filtered.length)
				"
				:row-attributes="(row) => ({ 'data-browse-row': String(row.id) })"
				empty-text="没有符合条件的活动。可清空筛选或新建活动。"
				@retry="
					report.groupBy.length ? projection.groups.retry() : projection.refresh(true)
				"
				@toggle-group="projection.groups.toggleGroup"
				@load-more="report.groupBy.length ? projection.groups.loadMore() : more()"
				@sort="sortActivity"
			>
				<template #cell="{ column, row }">
					<RouterLink
						v-if="column.id === 'title'"
						:to="{ name: 'activity-detail', params: { name: String(row.id || '') } }"
						>{{ String(row.title || "") }}</RouterLink
					>
					<template v-else-if="column.id === 'typeId'">{{
						activityTypeLabel(String(row.typeId || ""))
					}}</template>
					<template v-else-if="column.id === 'period'"
						>{{ row.start || "未设日期"
						}}{{ row.end ? " 至 " + row.end : "" }}</template
					>
					<template v-else-if="column.id === 'status'"
						>{{ row.status === "archived" ? "已归档" : "进行中"
						}}<span v-if="row.has_outstanding" class="badge warning">
							· 有未归还借用</span
						></template
					>
					<template v-else-if="column.id === 'modified'">{{
						siteDateTime(String(row.modified || ""))
					}}</template>
					<div v-else-if="column.id === 'actions'" class="form-actions">
						<UiButton
							v-for="count in activityMovementCounts(String(row.id))"
							:key="count.kind"
							@click="chip(String(row.id), count.kind)"
							>{{ movementLabels[count.kind] }} {{ count.count }}</UiButton
						>
					</div>
				</template>
				<template #group="{ group }">
					<div class="report-group-details">
						{{ activityGroupSummary(group) }}
						<UiButton v-if="group.error" @click="projection.groups.retry(group.id)"
							>重试</UiButton
						>
						<UiButton
							v-if="projection.groups.hasMore(group.id)"
							:loading="group.loading"
							@click="projection.groups.loadMore(group.id)"
							>加载更多此分组 · {{ projection.groups.progress(group.id).loaded }} /
							{{ projection.groups.progress(group.id).total }}</UiButton
						>
					</div>
				</template>
			</DataTable>
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
						<UiButton
							:disabled="!canWrite"
							:loading="busy"
							loading-label="正在更新活动…"
							@click="archive"
							>{{
								current.status === "archived" ? "恢复活动" : "归档活动"
							}}</UiButton
						><UiButton
							variant="danger"
							:disabled="!canDelete"
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
						{{ movementLabels[count.kind] || "其他类型" }} {{ count.count }} 份 ·
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
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />详细备注
					</summary>
					<div class="preview-long-text activity-notes">
						{{ current.notes || "未填写备注" }}
					</div>
				</details>
			</section>
			<section
				v-if="tab === 'records'"
				id="activity-records-panel"
				aria-labelledby="activity-records-tab"
				class="surface form-section"
				role="tabpanel"
				aria-label="关联记录"
			>
				<div
					class="browse-tabs"
					role="tablist"
					aria-label="活动相关资料"
					@keydown="tabKey"
				>
					<button
						type="button"
						role="tab"
						id="activity-records-tab"
						aria-controls="activity-records-panel"
						:tabindex="isRelatedTabSelected('records') ? 0 : -1"
						:aria-selected="isRelatedTabSelected('records')"
						@click="tab = 'records'"
					>
						关联记录
					</button>
					<button
						type="button"
						role="tab"
						id="activity-loans-tab"
						aria-controls="activity-loans-panel"
						:tabindex="isRelatedTabSelected('loans') ? 0 : -1"
						:aria-selected="isRelatedTabSelected('loans')"
						@click="tab = 'loans'"
					>
						借用结余
					</button>
				</div>
				<BrowseToolbar
					embedded
					title="活动关联记录"
					summary="关联记录"
					v-model:search="recordSearch"
					search-label="搜索关联记录"
					:active="active"
					:filter-count="
						Number(recordPeriod.key !== 'all') +
						Number(recordKinds.length > 0) +
						inheritedChips.length
					"
				>
					<template #filters>
						<div class="preview-filter-fields">
							<details
								class="browse-filter-disclosure"
								data-filter-field="relatedPeriod"
							>
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" />
									记账日期<small>{{ recordDateChip || "不限" }}</small>
								</summary>
								<PeriodFilter
									:today="reference.siteDate"
									v-model="recordPeriod"
									label="记账日期"
									field-key="relatedPeriod"
									embedded
								/>
							</details>
							<BrowseFilters
								:model-value="report.scope"
								:movement="true"
								:records="true"
								:fields="['kinds']"
								disclosure-mode
								@update:model-value="setRecordKinds($event.kinds)"
							/>
							<details
								v-if="relatedLoan"
								class="browse-filter-disclosure"
								data-filter-field="loan"
							>
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" />原借用<small>{{
										relatedLoan
									}}</small>
								</summary>
								<label class="preview-field"
									>原借用单号<input v-model="relatedLoan"
								/></label>
								<UiButton variant="ghost" @click="relatedLoan = ''"
									>清除原借用限制</UiButton
								>
							</details>
							<UiButton class="browse-filter-clear" @click="clearRelated"
								>清空筛选</UiButton
							>
						</div>
					</template>
					<template #chips="{ editFilter }">
						<BrowseChip
							v-if="recordDateChip"
							:label="`记账日期：${recordDateChip}`"
							@edit="editFilter('relatedPeriod')"
							@remove="recordPeriod = { key: 'all', from: '', to: '' }"
						/>
						<BrowseChip
							v-for="kind in recordKinds"
							:key="kind"
							:label="`流动类型：${movementLabels[kind] || kind}`"
							@edit="editFilter('kinds')"
							@remove="setRecordKinds(recordKinds.filter((value) => value !== kind))"
						/>
						<BrowseChip
							v-if="recordSearch"
							:label="`搜索：${recordSearch}`"
							@edit="editFilter('search')"
							@remove="recordSearch = ''"
						/>
						<BrowseChip
							v-for="chip in inheritedChips"
							:key="chip.key"
							:label="chip.label"
							@edit="editFilter(chip.field)"
							@remove="chip.remove()"
						/>
					</template>
				</BrowseToolbar>
				<DataTable
					ariaLabel="活动关联记录"
					:columns="relatedColumns"
					:rows="relatedRows"
					:sort-by="recordSort"
					:sort-direction="recordSortDirection"
					:loading="projection.mainTable.value?.loading"
					:initialized="projection.mainTable.value?.initialized"
					:error="projection.mainTable.value?.error"
					:has-more="projection.mainTable.value?.next != null"
					:loading-more="projection.mainTable.value?.loading"
					:loaded-count="projection.mainTable.value?.rows.length"
					:total-count="projection.mainTable.value?.total"
					@sort="sortRelated"
					@load-more="more"
					@retry="projection.refresh(true)"
				>
					<template #cell="{ column, row }">
						<RecordRef
							v-if="column.id === 'document'"
							:kind="String(row.kind || row.documentType || 'Activity')"
							:identity="String(row.borrower || row.itemName || row.name || '')"
							:document-name="String(row.name || '')"
							:status="String(row.docstatus || '')"
							@open="
								linked(
									String(row.name || ''),
									String(row.documentType || 'Stock Entry'),
								)
							"
						/>
						<template v-else-if="column.id === 'date'">{{
							siteDateTime(`${row.date} ${row.postingTime || ""}`) || "未记录时间"
						}}</template>
						<template v-else-if="column.id === 'kind'">{{
							movementLabels[String(row.kind || "")] || "其他类型"
						}}</template>
						<NativeStatusBadge
							v-else-if="column.id === 'status'"
							:status="row.docstatus"
						/>
						<ItemLine
							v-else-if="column.id === 'item'"
							:item="{
								code: String(row.code || ''),
								name: String(row.itemName || row.code || ''),
								image: String(row.image || ''),
							}"
							><template #secondary>{{ row.code }}</template></ItemLine
						>
						<template v-else-if="column.id === 'quantity'"
							>{{ formatQuantity(Number(row.qty || 0)) }} {{ row.uom }}</template
						>
						<template v-else-if="column.id === 'route'"
							>{{ row.from }} → {{ row.to }}</template
						>
					</template>
				</DataTable>
				<p class="muted">附件通过各单据的详情查看。</p>
			</section>
			<section
				v-else
				id="activity-loans-panel"
				aria-labelledby="activity-loans-tab"
				class="surface form-section"
				role="tabpanel"
				aria-label="借用结余"
			>
				<div
					class="browse-tabs"
					role="tablist"
					aria-label="活动相关资料"
					@keydown="tabKey"
				>
					<button
						type="button"
						role="tab"
						id="activity-records-tab"
						aria-controls="activity-records-panel"
						:tabindex="isRelatedTabSelected('records') ? 0 : -1"
						:aria-selected="isRelatedTabSelected('records')"
						@click="tab = 'records'"
					>
						关联记录
					</button>
					<button
						type="button"
						role="tab"
						id="activity-loans-tab"
						aria-controls="activity-loans-panel"
						:tabindex="isRelatedTabSelected('loans') ? 0 : -1"
						:aria-selected="isRelatedTabSelected('loans')"
						@click="tab = 'loans'"
					>
						借用结余
					</button>
				</div>
				<article
					v-for="line in loans"
					:key="line.lineId"
					:data-browse-row="line.lineId"
					class="activity-record"
				>
					<RecordRef
						kind="Loan"
						:identity="
							line.borrower || line.date
								? `${line.borrower || '借用方未知'} ${line.date.slice(5)}`
								: line.loanName
						"
						:document-name="line.loanName"
						@open="linked(String(line.loanName || ''))"
					/>
					<ItemLine
						:item="{
							code: String(line.code || ''),
							name: String(line.name || line.code || ''),
							image: String(line.image || ''),
						}"
					/>
					<dl class="ti-fields">
						<div>
							<dt>单位</dt>
							<dd>{{ line.uom }}</dd>
						</div>
						<div>
							<dt>借用</dt>
							<dd>{{ line.qty }} {{ line.uom }}</dd>
						</div>
						<div>
							<dt>完好归还</dt>
							<dd>{{ line.returned }} {{ line.uom }}</dd>
						</div>
						<div>
							<dt>损坏</dt>
							<dd>{{ line.damaged }} {{ line.uom }}</dd>
						</div>
						<div>
							<dt>遗失</dt>
							<dd>{{ line.lost }} {{ line.uom }}</dd>
						</div>
						<div>
							<dt>未归还</dt>
							<dd>{{ line.outstanding }} {{ line.uom }}</dd>
						</div>
					</dl>
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
		<SkeletonBlock v-else-if="loading" variant="detail" :count="3" :rows="4" />
		<p v-else role="alert">
			{{ error || "活动不存在或不可访问。" }} <UiButton @click="loadDetail">重试</UiButton>
		</p>
		<template v-if="page === 'activity-detail'">
			<SkeletonBlock
				v-if="projection.result.loading && !projection.mainTable.value?.initialized"
				variant="lines"
				:count="3"
			/>
			<p v-if="projection.result.error" role="alert">
				{{ projection.result.error }}
				<UiButton @click="projection.refresh(true)">重试</UiButton>
			</p>
			<p v-if="projection.mainTable.value?.error" role="alert">
				{{ projection.mainTable.value.error }}
			</p>
		</template>
		<Overlay v-if="deleteOpen" title="删除活动" @close="deleteOpen = false"
			><p>删除活动「{{ current?.title }}」？已有任何引用的活动不能删除。</p>
			<template #footer
				><UiButton @click="deleteOpen = false">取消</UiButton
				><UiButton
					variant="danger"
					:loading="busy"
					loading-label="正在删除活动…"
					@click="remove"
					>确认删除</UiButton
				></template
			></Overlay
		>
	</section>
</template>
