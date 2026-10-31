<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import PageHeader from "../../components/ui/PageHeader.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { siteDateTime } from "../../lib/nativeTime";
import { computed, ref } from "vue";
import { nextTableSort } from "../../composables/useArrayTableSort";
import ActivityEditor from "./ActivityEditor.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import Overlay from "../../components/ui/Overlay.vue";
import QuickExport from "../../components/QuickExport.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import { movementLabels } from "../../lib/presentationLabels";
import { periodLabels } from "../../lib/sitePeriod";
import type { ReportQuery } from "../../lib/reportContract";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import { removeGroupByField } from "../../lib/groupBy";
import { groupLabels } from "../../lib/reportContract";
import { useConfirm } from "../../services/confirm";
import type { useActivitiesController } from "./useActivitiesController";
import DataTable from "../../components/ui/DataTable.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
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
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import DetailPopover from "../../components/ui/DetailPopover.vue";
import { activityLoansTarget, activityMovementTarget } from "./activityRoutes";
import { activityColumns as activityColumnDefinitions } from "./activityColumns";
import { exportFields } from "../../lib/exportColumns";
import { sortByUnit, unitLabel } from "../../lib/units";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/formatQuantity";
const { isMobile } = useResponsiveLayout();
const activityEditor = ref<InstanceType<typeof ActivityEditor>>();
const filterSheetOpen = ref(false);
const expandedActivityKinds = ref(new Set<string>());
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
const confirm = useConfirm().confirm;
const {
	reference,
	scopeError,
	inheritedChips,
	state,
	current,
	detail,
	filtered,
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
	more,
} = props.controller;
async function confirmActivityDelete() {
	if (
		!(await confirm({
			title: "删除活动？",
			message: `删除活动「${current.value?.title || ""}」？已有任何引用的活动不能删除。`,
			confirmLabel: "确认删除",
			tone: "danger",
		}))
	)
		return;
	deleteOpen.value = false;
	await props.controller.remove();
}
function resetActivityFilters() {
	clear();
	state.search = "";
	state.period = { key: "all", from: "", to: "" };
	state.sort = "updated";
	state.sortDirection = "desc";
	report.value.groupBy = [];
}
const page = computed(() => `activity-${props.mode}`);
const variant = computed(() => props.name || "new");
const isEditing = computed(() => !!props.name);
const activityColumns = activityColumnDefinitions;
const activityRows = computed<DataTableRecord[]>(() =>
	filtered.value.map((activity) => ({
		kind: "record",
		id: activity.id,
		value: activity as unknown as Record<string, unknown>,
	})),
);
function sortActivity(column: string) {
	const sort = column === "title" ? "title" : column === "start_date" ? "start" : "updated";
	const next = nextTableSort(
		sort,
		state.sort,
		state.sortDirection,
		sort === "updated" ? "desc" : "asc",
	);
	state.sort = next.field;
	state.sortDirection = next.direction;
}
function activityKindCounts(id: string) {
	return [...activityMovementCounts(id)].sort((left, right) => right.count - left.count);
}
function activityTarget(id: string, kind?: string) {
	return activityMovementTarget(id, kind);
}
function movementQuantities(kind: string) {
	const totals = (detail.value?.movement_totals || [])
		.filter((row) => row.kind === kind)
		.map((row) => ({ uom: String(row.stock_uom || ""), qty: Number(row.stock_qty || 0) }));
	const byUnit = new Map<string, number>();
	for (const row of totals) byUnit.set(row.uom, (byUnit.get(row.uom) || 0) + row.qty);
	const sorted = sortByUnit([...byUnit], ([uom]) => uom);
	return { shown: sorted.slice(0, 3), remaining: Math.max(0, sorted.length - 3), total: sorted };
}
function toggleActivityKind(kind: string) {
	const expanded = new Set(expandedActivityKinds.value);
	if (expanded.has(kind)) expanded.delete(kind);
	else expanded.add(kind);
	expandedActivityKinds.value = expanded;
}
function outstandingQuantities() {
	const byUnit = new Map<string, number>();
	for (const row of detail.value?.loan_totals || []) {
		const unit = String(row.stock_uom || "");
		byUnit.set(unit, (byUnit.get(unit) || 0) + Number(row.outstanding || 0));
	}
	return sortByUnit([...byUnit], ([unit]) => unit);
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
	? useColumnPreferences(
			"activities.list",
			computed(() => activityColumns),
			reference,
			services,
		)
	: undefined;
const activityExportColumns = computed(() => {
	const visible = activityPrefs?.visible.value.length
		? activityPrefs.visible.value
		: activityColumns
				.filter((column) => column.defaultVisible !== false)
				.map((column) => String(column.id));
	const order = activityPrefs?.order.value.length
		? activityPrefs.order.value
		: activityColumns.map((column) => String(column.id));
	return exportFields(activityColumns, order, visible);
});
</script>
<template>
	<ReturnToTop :active="props.active" :hidden="isMobile && filterSheetOpen" />
	<section class="page activities-page">
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
					title="活动"
					:active="active"
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
			@filter-open="filterSheetOpen = $event"
			:filter-count="secondaryChips.length + 3"
		>
			<template #actions>
				<BrowseOverflowMenu>
					<QuickExport
						:query="report"
						table="metadata"
						:columns="activityExportColumns"
						title="活动"
						:active="active"
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
				<div class="browse-filter-fields">
					<label class="form-field"
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
						label="活动日期"
						embedded
					/>
					<small
						>按活动起止日期与所选范围重叠筛选；未填写开始或结束日期视为持续活动。</small
					>
					<label class="form-field"
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
					<label class="form-field"
						>关联记录<select v-model="state.presence">
							<option value="all">全部</option>
							<option value="yes">有记录</option>
							<option value="no">无记录</option>
						</select></label
					>
					<label class="form-choice-label"
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
				<UiButton
					v-if="
						(mode === 'list' && report.groupBy.length) ||
						inheritedChips.length ||
						secondaryChips.length
					"
					variant="ghost"
					@click="resetActivityFilters"
					>清除全部</UiButton
				>
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
			<BrowseResultSummary
				v-if="projection.result.snapshot"
				:label="`${projection.result.total} 个活动 · 标签数字为全部已提交单据，不随日期筛选`"
				:metrics="[]"
			/>
			<div class="activity-list-scroll" data-browse-scroll="activities">
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
							projection.mainTable.value?.initialized ||
							activityGroupRoot?.initialized,
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
						report.groupBy.length
							? projection.groups.progress().loaded
							: filtered.length
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
						report.groupBy.length
							? projection.groups.retry()
							: projection.refresh(true)
					"
					@toggle-group="projection.groups.toggleGroup"
					@load-more="report.groupBy.length ? projection.groups.loadMore() : more()"
					@sort="sortActivity"
				>
					<template #cell="{ column, row }">
						<RouterLink
							v-if="column.id === 'title'"
							class="browse-row-link"
							:to="{
								name: 'activity-detail',
								params: { name: String(row.id || '') },
							}"
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
						<div v-else-if="column.id === 'actions'" class="activity-kind-summary">
							<RouterLink
								v-for="count in activityKindCounts(String(row.id)).slice(0, 3)"
								:key="count.kind"
								:to="activityTarget(String(row.id), count.kind)"
								>{{ movementLabels[count.kind] }} {{ count.count }}</RouterLink
							>
							<DetailPopover
								v-if="activityKindCounts(String(row.id)).length > 3"
								:label="`${String(row.title || '活动')}的全部流动类型`"
								trigger-class="activity-kind-more"
								:trigger-text="`+${activityKindCounts(String(row.id)).length - 3}`"
							>
								<RouterLink
									v-for="count in activityKindCounts(String(row.id))"
									:key="count.kind"
									:to="activityTarget(String(row.id), count.kind)"
									class="activity-kind-popover-link"
									>{{ movementLabels[count.kind] || "其他类型" }}
									{{ count.count }}</RouterLink
								>
							</DetailPopover>
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
								>加载更多此分组 ·
								{{ projection.groups.progress(group.id).loaded }} /
								{{ projection.groups.progress(group.id).total }}</UiButton
							>
						</div>
					</template>
				</DataTable>
			</div>
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
								confirmActivityDelete();
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
				<dl class="info-grid">
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
				<p class="content-long-text">{{ current.description || "未填写说明" }}</p>
				<h3>货物流动</h3>
				<div class="activity-movement-tiles">
					<div
						v-for="count in activityKindCounts(current.id)"
						:key="count.kind"
						class="activity-movement-card"
					>
						<RouterLink
							class="activity-movement-tile"
							:to="activityTarget(current.id, count.kind)"
						>
							<strong>{{ movementLabels[count.kind] || "其他类型" }}</strong>
							<span class="activity-movement-tile-quantities">
								<b
									v-for="[uom, qty] in movementQuantities(count.kind).shown"
									:key="uom"
								>
									{{ formatQuantityWithUnit(qty, uom) }}
								</b>
								<template v-if="expandedActivityKinds.has(count.kind)">
									<b
										v-for="[uom, qty] in movementQuantities(
											count.kind,
										).total.slice(3)"
										:key="`extra-${uom}`"
										class="activity-movement-expanded-unit"
									>
										{{ formatQuantityWithUnit(qty, uom) }}
									</b>
								</template>
							</span>
						</RouterLink>
						<div class="activity-movement-meta-line">
							<span class="activity-movement-tile-count"
								>{{ count.count }} 份记录</span
							>
							<button
								v-if="movementQuantities(count.kind).remaining"
								type="button"
								class="activity-movement-disclosure"
								:aria-expanded="expandedActivityKinds.has(count.kind)"
								@click="toggleActivityKind(count.kind)"
							>
								{{
									expandedActivityKinds.has(count.kind)
										? "收起"
										: `+${movementQuantities(count.kind).remaining} 单位`
								}}
							</button>
						</div>
					</div>
					<RouterLink
						class="activity-movement-tile activity-outstanding-tile"
						:to="activityLoansTarget(current.id)"
					>
						<strong>当前未归还</strong>
						<span class="activity-movement-tile-quantities">
							<b v-for="[uom, qty] in outstandingQuantities()" :key="uom">
								{{ formatQuantityWithUnit(qty, uom) }}
							</b>
						</span>
						<span class="activity-movement-tile-count"
							>{{ detail?.outstanding_line_count || 0 }} 行未归还</span
						>
					</RouterLink>
				</div>
				<nav class="activity-detail-links" aria-label="活动记录">
					<RouterLink :to="activityTarget(current.id)">查看全部记录</RouterLink>
					<RouterLink :to="activityLoansTarget(current.id)">查看借用</RouterLink>
				</nav>

				<details>
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />详细备注
					</summary>
					<div class="content-long-text activity-notes">
						{{ current.notes || "未填写备注" }}
					</div>
				</details>
			</section>
		</template>
		<SkeletonBlock v-else-if="loading" variant="detail" :count="3" :rows="4" />
		<p v-else role="alert">
			{{ error || "活动不存在或不可访问。" }} <UiButton @click="loadDetail">重试</UiButton>
		</p>
	</section>
</template>
