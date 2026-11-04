<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import PageHeader from "../../components/ui/PageHeader.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { formatSiteDateTime } from "../../lib/nativeTime";
import { computed, ref, watch } from "vue";
import { nextTableSort } from "../../composables/useArrayTableSort";
import ActivityEditor from "./ActivityEditor.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import Overlay from "../../components/ui/Overlay.vue";
import QuickExport from "../../components/QuickExport.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import BrowseSplitButton from "../../components/ui/BrowseSplitButton.vue";
import { movementLabels } from "../../lib/presentationLabels";
import { periodLabels } from "../../lib/sitePeriod";
import type { ReportQuery } from "../../lib/reportContract";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import { removeGroupByField } from "../../lib/groupBy";
import { groupImpliedColumns } from "../../lib/groupColumns";
import { groupLabels } from "../../lib/reportContract";
import { useConfirm } from "../../services/confirm";
import type { useActivitiesController } from "./useActivitiesController";
import DataTable from "../../components/ui/DataTable.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import BrowseCard from "../../components/ui/BrowseCard.vue";
import BrowseLoadMore from "../../components/ui/BrowseLoadMore.vue";
import ViewModeToggle from "../../components/ui/ViewModeToggle.vue";
import ColumnSettings from "../../components/ui/ColumnSettings.vue";
import CardFields from "../../components/ui/CardFields.vue";
import BrowseEmpty from "../../components/ui/BrowseEmpty.vue";
import RowFieldsSheet from "../../components/ui/RowFieldsSheet.vue";
import ActivityCell from "./ActivityCell.vue";
import { partitionCardColumns, ROW_FIELD_LIMIT } from "../../lib/cardLayout";
import { orderedVisibleColumns } from "../../lib/dataTable";
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
import { activityLoansTarget, activityMovementTarget } from "./activityRoutes";
import { activityColumns as activityColumnDefinitions } from "./activityColumns";
import { exportFields } from "../../lib/exportColumns";
import { sortByUnit, unitLabel } from "../../lib/units";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/formatQuantity";
const exportMenu = ref<{ open(): void }>();
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
	atDefaults,
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
	view,
	viewOptions,
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
// The 列表 row shows the same visible fields, in the same order, as the table; 关联流动 is an
// action and never a row field.
const rowFields = computed(() =>
	partitionCardColumns(
		orderedVisibleColumns(activityColumns, activityPrefs),
		{ title: "title", status: "status", omit: ["actions"] },
		ROW_FIELD_LIMIT,
	),
);
// 列表 rows are the phone layout for an ungrouped list; the table owns every other case.
const rowsLayout = computed(
	() => isMobile.value && view.value === "list" && !report.value.groupBy.length,
);
const activityEmptyText = "没有符合条件的活动。可恢复默认筛选或新建活动。";
// The 更多 sheet's row; cleared when the page is inactive or switches mode, so it never reappears.
const detailsRow = ref<Record<string, unknown>>();
watch(
	() => [props.active, props.mode],
	() => {
		detailsRow.value = undefined;
	},
);
function openDetailsRow() {
	const row = detailsRow.value;
	detailsRow.value = undefined;
	if (row) open(String(row.id));
}
</script>
<template>
	<ReturnToTop :active="props.active" :hidden="isMobile && filterSheetOpen" />
	<section class="page activities-page">
		<p v-if="scopeError" role="alert">{{ scopeError }}</p>
		<PageHeader v-if="page !== 'activity-list'"
			><div>
				<h1 tabindex="-1">
					{{
						page === "activity-form"
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
				/> </template
		></PageHeader>
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
			:filter-count="secondaryChips.length + inheritedChips.length"
		>
			<template #actions>
				<QuickExport
					ref="exportMenu"
					:show-trigger="false"
					:query="report"
					table="metadata"
					:columns="activityExportColumns"
					title="活动"
					:active="active"
				/>
				<BrowseOverflowMenu>
					<RouterLink :to="{ name: 'activity-types' }">管理活动类型</RouterLink>
					<UiButton icon="export" @click="exportMenu?.open()">导出</UiButton>
				</BrowseOverflowMenu>
				<BrowseSplitButton
					label="新建活动"
					kind="Activity"
					icon="calendar"
					:options="[]"
					@select="newActivity"
				/>
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
					<UiButton v-if="!atDefaults" @click="clear">恢复默认</UiButton>
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
				<UiButton v-if="!atDefaults" variant="ghost" @click="resetActivityFilters"
					>恢复默认</UiButton
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
			<!-- Phones stack the controls under the summary label, so the phone label stays short;
			     the note that badge counts ignore the date filter is shown on desktop only. -->
			<BrowseResultSummary
				v-if="projection.result.snapshot"
				:label="
					isMobile
						? `${projection.result.total} 个活动`
						: `${projection.result.total} 个活动 · 标签数字为全部已提交单据，不随日期筛选`
				"
				:metrics="[]"
				><template #controls>
					<ViewModeToggle
						v-if="!report.groupBy.length"
						v-model="view"
						ariaLabel="活动显示方式"
						:options="viewOptions"
					/>
					<ColumnSettings
						v-if="activityPrefs && rowsLayout"
						:preferences="activityPrefs"
						:columns="activityColumns"
					/> </template
			></BrowseResultSummary>
			<SkeletonBlock
				v-if="rowsLayout && projection.result.loading && !projection.result.snapshot"
				variant="list"
				:rows="5"
			/>
			<div v-if="rowsLayout && projection.result.snapshot" class="activity-row-list">
				<BrowseCard
					v-for="entry in activityRows"
					:key="entry.id"
					:row-key="entry.id"
					variant="row"
					:selecting="false"
					:selected="false"
					select-label="打开活动"
					@open="open(entry.id)"
				>
					<div class="activity-row-content">
						<strong data-clamp>{{ String(entry.value.title || "") }}</strong
						><span
							v-if="rowFields.status"
							class="browse-badge"
							:class="
								entry.value.status === 'archived' ? 'is-neutral' : 'is-success'
							"
							>{{ entry.value.status === "archived" ? "已归档" : "进行中" }}</span
						>
						<CardFields
							variant="row"
							:fields="rowFields.fields"
							:overflow="rowFields.overflow"
							:row="entry.value"
							@more="detailsRow = entry.value"
						>
							<template #cell="{ column, row }">
								<ActivityCell
									:column="column"
									:row="row"
									:type-label="activityTypeLabel"
									:kind-counts="activityKindCounts"
								/>
							</template>
						</CardFields>
					</div>
				</BrowseCard>
			</div>
			<BrowseEmpty
				v-if="
					rowsLayout &&
					projection.result.snapshot &&
					!projection.result.loading &&
					!projection.result.error &&
					!activityRows.length
				"
				:text="activityEmptyText"
			/>
			<RowFieldsSheet
				v-if="detailsRow && rowsLayout"
				:title="String(detailsRow.title || '')"
				:columns="rowFields.all"
				:row="detailsRow"
				@close="detailsRow = undefined"
				@open="openDetailsRow"
			>
				<template #cell="{ column, row }">
					<ActivityCell
						:column="column"
						:row="row"
						:type-label="activityTypeLabel"
						:kind-counts="activityKindCounts"
					/>
				</template>
			</RowFieldsSheet>
			<BrowseLoadMore
				v-if="
					isMobile &&
					!report.groupBy.length &&
					view === 'list' &&
					projection.mainTable.value
				"
				:has-more="projection.mainTable.value.next !== null"
				:loaded-count="projection.mainTable.value.rows.length"
				:total-count="projection.mainTable.value.total"
				:loading="projection.mainTable.value.loading"
				:error="projection.mainTable.value.error"
				@load-more="projection.loadTable(projection.mainTable.value, true)"
				@retry="projection.loadTable(projection.mainTable.value, true, true)"
			/>
			<div class="activity-list-scroll" data-browse-scroll="activities">
				<DataTable
					sticky-header
					v-if="!isMobile || view === 'table' || report.groupBy.length"
					ariaLabel="活动列表"
					table-class="browse-table"
					:columns="activityColumns"
					:rows="activityEntries"
					:suppressed-columns="groupImpliedColumns(report.groupBy)"
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
					:empty-text="activityEmptyText"
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
						<ActivityCell
							:column="column"
							:row="row"
							:type-label="activityTypeLabel"
							:kind-counts="activityKindCounts"
						/>
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
						<dd>{{ current.owner }} · {{ formatSiteDateTime(current.created) }}</dd>
					</div>
					<div>
						<dt>更新（站点时间）</dt>
						<dd>
							{{ current.modifiedBy }} · {{ formatSiteDateTime(current.modified) }}
						</dd>
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
