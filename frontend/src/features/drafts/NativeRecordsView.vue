<script setup lang="ts">
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { computed, watch } from "vue";
import type { NativeRecordsController, NativeRecord } from "./useNativeRecords";
import type { RecoverySnapshot } from "../../lib/browserRecovery";
import type { ReportQuery } from "../../lib/reportContract";
import { movementLabels } from "../../lib/filterPresentation";
import { enumPresentationLabel } from "../../lib/presentationLabels";
import UiButton from "../../components/ui/UiButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import QuickExport from "../../components/QuickExport.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import { removeGroupByField } from "../../lib/groupBy";
import { groupLabels } from "../../lib/reportContract";
import { sitePeriodSummary } from "../../lib/sitePeriod";
import { clearScopeField, scopeFilterFieldChips } from "../../lib/filterPresentation";
import { useFilterRailPreference } from "../../composables/useFilterRailPreference";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import DataTable from "../../components/ui/DataTable.vue";
import type {
	DataColumn,
	DataTableEntry,
	DataTableGroup,
	DataTableRecord,
} from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { reportColumnLabels } from "../../lib/reportCells";
import { useOptionalInventoryServices } from "../../services/contracts";
const props = withDefaults(
	defineProps<{
		controller: NativeRecordsController;
		mode: "drafts" | "counts";
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	openDocument: [doctype: string, name: string];
	recover: [entry: RecoverySnapshot];
	newCount: [];
	openExport: [query: ReportQuery];
}>();
const c = props.controller;
const {
	query,
	groups,
	scope,
	rows,
	loading,
	initialized,
	stale,
	total,
	next,
	error,
	routeError,
	deleteTarget,
	deleteBusy,
	deleteError,
	localEntries,
	localError,
	localTarget,
	extraChips,
} = c;
const scopeChips = computed(() => scopeFilterFieldChips(scope.value, c.reference));
const {
	open: sidebarOpen,
	toggle: toggleSidebar,
	saveError: sidebarSaveError,
	retry: retrySidebarSave,
} = useFilterRailPreference(`native-records.${props.mode}`, c.reference, false);
const { isMobile } = useResponsiveLayout();
function removeScopeChip(chip: (typeof scopeChips.value)[number]) {
	clearScopeField(scope.value, chip.field);
}
watch(
	() => props.active,
	(value) => {
		if (!value) {
			deleteTarget.value = undefined;
			localTarget.value = undefined;
		}
	},
);
function open(row: NativeRecord) {
	emit("openDocument", String(row.doctype), String(row.document));
}
function localTitle(entry: RecoverySnapshot) {
	if (entry.editorKind === "Stock Entry")
		return movementLabels[String(entry.values.kind || "")] || "库存操作";
	return (
		(
			{
				"Stock Reconciliation": "盘点",
				Item: "物品",
				"Inventory Activity": "活动",
				Warehouse: "仓库资料",
			} as Record<string, string>
		)[entry.editorKind] || entry.editorKind
	);
}
const quantities = (row: NativeRecord) =>
	row.whole.quantities.map((value) => `${value.qty} ${value.uom}`).join(" · ");
const services = useOptionalInventoryServices();
const tableColumns = computed<DataColumn[]>(() => [
	{ id: "document", label: "记录", required: true, defaultVisible: true, minWidth: "180px" },
	{ id: "kind", label: "类型 / 状态", defaultVisible: true, minWidth: "150px" },
	{ id: "activity_title", label: "活动 / 借用人", defaultVisible: true, minWidth: "150px" },
	{ id: "summary", label: "整份记录", defaultVisible: true, minWidth: "240px" },
	{ id: "date", label: "记账日期", defaultVisible: true, sortable: true, minWidth: "150px" },
	{ id: "actions", label: "操作", required: true, defaultVisible: true, minWidth: "150px" },
]);
const tableRows = computed<DataTableRecord[]>(() =>
	rows.value.map((row) => ({
		kind: "record",
		id: row.id,
		value: row as unknown as Record<string, unknown>,
	})),
);
const browseRows = computed<DataTableEntry[]>(() =>
	query.value.groupBy.length ? groups.entries.value : tableRows.value,
);
const groupRoot = computed(() => groups.pages.value["[[],null]"]);
function groupSummary(group: DataTableGroup) {
	const row = group.value || {};
	return ["item_count", "document_count", "allocation_count", "stock_uom"]
		.filter((key) => row[key] !== undefined)
		.map((key) => `${reportColumnLabels[key] || key} ${row[key]}`)
		.join(" · ");
}
const tablePrefs =
	services && !routeError.value
		? useColumnPreferences(`native-records.${props.mode}`, tableColumns, c.reference, services)
		: undefined;
function nativeRow(row: Record<string, unknown>): NativeRecord {
	return row as unknown as NativeRecord;
}
</script>
<template>
	<section class="preview-page preview-browse-page">
		<BrowseToolbar
			:title="mode === 'drafts' ? '草稿' : '盘点调整'"
			:summary="mode === 'drafts' ? '草稿' : '盘点调整'"
			v-model:search="query.search"
			:search-label="mode === 'drafts' ? '搜索草稿、物品或活动' : '搜索盘点记录或物品'"
			:active="active"
			:filter-count="scopeChips.length + extraChips.filter((chip) => !chip.fixed).length + 1"
			:sidebar-open="sidebarOpen"
			:sidebar-save-error="sidebarSaveError"
			:retry-sidebar-save="retrySidebarSave"
			sidebar-available
			@sidebar="toggleSidebar"
		>
			<template #actions
				><UiButton
					@click="
						c.load();
						c.readLocal();
					"
					>刷新</UiButton
				>
				<QuickExport
					:query="query"
					:active="active"
					@open-full="emit('openExport', $event)"
				/>
				<UiButton
					v-if="
						mode === 'counts' &&
						c.reference.capabilities['Stock Reconciliation']?.create
					"
					variant="primary"
					@click="emit('newCount')"
					>新建盘点</UiButton
				></template
			>
			<template #subtitle>
				<p class="browse-subtitle">
					{{
						mode === "drafts"
							? "原生草稿可在 ERPNext 和本应用继续填写，尚未改变库存。"
							: "仅显示实际保存的原生盘点调整；数量一致的盘点不产生记录。"
					}}
				</p>
			</template>
			<template #filters>
				<BrowseFilters
					v-model="scope"
					disclosure-mode
					:movement="mode === 'drafts'"
					records
					:hierarchy-in-rail="sidebarOpen && !isMobile"
				/>
				<div data-filter-field="groupBy" tabindex="-1">
					<GroupByFilter
						v-model="query.groupBy"
						:dataset="query.dataset"
						:view="query.view"
					/>
				</div>
				<details class="browse-filter-disclosure" data-filter-field="period">
					<summary>
						记账日期
						<small>{{ sitePeriodSummary(scope.period, c.reference.siteDate) }}</small>
					</summary>
					<PeriodFilter
						v-model="scope.period"
						:today="c.reference.siteDate"
						label="记账日期"
						embedded
					/>
				</details>
				<details
					v-if="mode === 'counts'"
					class="browse-filter-disclosure"
					data-filter-field="status"
				>
					<summary>
						状态
						<small>{{
							query.statuses
								.map((status) => ["草稿", "已提交", "已取消"][status])
								.join("、") || "未选择"
						}}</small>
					</summary>
					<label class="preview-field"
						>状态<select v-model="query.statuses">
							<option :value="[1]">已提交</option>
							<option :value="[0]">草稿</option>
							<option :value="[2]">已取消</option>
							<option :value="[0, 1, 2]">全部状态</option>
						</select></label
					>
				</details>
				<UiButton @click="c.clear">清空筛选</UiButton>
			</template>
			<template #chips="{ editFilter }">
				<BrowseChip
					v-for="(group, index) in query.groupBy"
					:key="`group:${group}`"
					:label="`分组：${groupLabels[group] || group}`"
					@edit="editFilter('groupBy')"
					@remove="
						query.groupBy = removeGroupByField(
							query.dataset,
							query.view,
							query.groupBy,
							index,
						)
					"
				/>
				<BrowseChip
					v-for="chip in scopeChips"
					:key="chip.key"
					:label="chip.label"
					@edit="editFilter(chip.field)"
					@remove="removeScopeChip(chip)"
				/>
				<BrowseChip
					v-for="chip in extraChips"
					:key="chip.key"
					:label="chip.label"
					:removable="!chip.fixed"
					@edit="editFilter(chip.field)"
					@remove="Object.assign(query, chip.reset)"
				/>
			</template>
			<div class="browse-toolbar browse-sort-only">
				<label class="preview-field"
					>排序<select v-model="query.sortBy">
						<option value="date">记账日期</option>
						<option value="identity">编号</option>
					</select></label
				>
				<label class="preview-field"
					>顺序<select v-model="query.sort">
						<option value="desc">降序</option>
						<option value="asc">升序</option>
					</select></label
				>
				<span v-if="initialized" class="browse-result-count">{{ total }} 份原生记录</span>
			</div>
		</BrowseToolbar>
		<p v-if="routeError" class="utility-error" role="alert">{{ routeError }}</p>
		<template v-else>
			<div class="preview-browse-body">
				<aside
					v-if="sidebarOpen && !isMobile"
					class="preview-filter-rail browse-filter-rail"
				>
					<h3>类别与仓库</h3>
					<BrowseFilters
						v-model="scope"
						:fields="['categories', 'warehouses']"
						hide-activity
					/>
				</aside>
				<div class="preview-browse-results">
					<DataTable
						data-browse-scroll="records"
						ariaLabel="原生记录"
						table-class="browse-table"
						:columns="tableColumns"
						:rows="browseRows"
						:column-preferences="tablePrefs"
						:sort-by="query.sortBy"
						:sort-direction="query.sort"
						:loading="loading || Boolean(query.groupBy.length && groupRoot?.loading)"
						loading-text="正在读取原生记录…"
						:initialized="Boolean(initialized || groupRoot?.initialized)"
						:error="query.groupBy.length ? groupRoot?.error || error : error"
						:stale="query.groupBy.length ? Boolean(groupRoot?.stale) : stale"
						:retained="
							Boolean(
								query.groupBy.length
									? groupRoot?.rows.length &&
											groupRoot.loading &&
											groupRoot.stale
									: rows.length && loading && stale,
							)
						"
						:has-more="query.groupBy.length ? groups.hasMore() : next !== null"
						:loaded-count="
							query.groupBy.length ? groups.progress().loaded : rows.length
						"
						:total-count="query.groupBy.length ? groups.progress().total : total"
						:loading-more="
							query.groupBy.length
								? Boolean(groupRoot?.loading && groupRoot.rows.length)
								: loading && rows.length > 0
						"
						:row-attributes="
							(row) => ({
								'data-browse-row': `${String(row.doctype)}:${String(row.document)}`,
							})
						"
						empty-text="没有符合条件的原生记录"
						@sort="
							(field) => {
								query.sortBy = field as ReportQuery['sortBy'];
								c.load();
							}
						"
						@toggle-group="groups.toggleGroup"
						@retry="query.groupBy.length ? groups.retry() : c.retry()"
						@load-more="query.groupBy.length ? groups.loadMore() : c.load(true)"
					>
						<template #cell="{ column, row }">
							<button
								v-if="column.id === 'document'"
								class="browse-row-link"
								@click="open(nativeRow(row))"
							>
								<strong>{{ row.document }}</strong
								><small>{{ enumPresentationLabel("doctype", row.doctype) }}</small>
							</button>
							<template v-else-if="column.id === 'kind'">
								{{
									row.kind
										? movementLabels[String(row.kind)] || "其他类型"
										: "原生单据"
								}}
								·
								<NativeStatusBadge :status="Number(row.docstatus)" />
							</template>
							<template v-else-if="column.id === 'activity_title'">{{
								row.activity_title || row.borrower || "—"
							}}</template>
							<div v-else-if="column.id === 'summary'">
								{{ nativeRow(row).whole.line_count }} 行 ·
								{{ nativeRow(row).whole.item_count }} 种物品
								<small class="record-quantity">{{
									quantities(nativeRow(row))
								}}</small>
								<small
									v-if="
										nativeRow(row).allocation_count !==
										nativeRow(row).whole.line_count
									"
									class="record-quantity"
									>符合筛选的明细：{{ nativeRow(row).allocation_count }}</small
								>
							</div>
							<template v-else-if="column.id === 'date'"
								>{{ row.date }} {{ String(row.time || "").slice(0, 5) }}</template
							>
							<div v-else-if="column.id === 'actions'" class="browse-row-actions">
								<button class="browse-link" @click="open(nativeRow(row))">
									{{ nativeRow(row).whole.editable ? "继续填写" : "查看记录" }}
								</button>
								<button
									v-if="nativeRow(row).whole.can_delete"
									class="browse-link is-danger-text"
									:disabled="!c.canDelete(nativeRow(row))"
									@click="
										deleteError = '';
										deleteTarget = nativeRow(row);
									"
								>
									删除
								</button>
							</div>
						</template>
						<template #group="{ group }">
							<div class="report-group-details">
								{{ groupSummary(group) }}
								<UiButton v-if="group.error" @click="groups.retry(group.id)"
									>重试</UiButton
								>
								<UiButton
									v-if="groups.hasMore(group.id)"
									:loading="group.loading"
									@click="groups.loadMore(group.id)"
									>加载更多此分组 · {{ groups.progress(group.id).loaded }} /
									{{ groups.progress(group.id).total }}</UiButton
								>
							</div>
						</template>
					</DataTable>
				</div>
			</div>
		</template>
		<section v-if="mode === 'drafts'" class="surface form-section browser-recovery-list">
			<h2>此浏览器的未完成输入</h2>
			<p>
				仅当前浏览器与账户可用，未保存为原生草稿，也没有预留或改变库存。重新打开后需核对原记录，再选择恢复。待上传文件须重新选择。
			</p>
			<p v-if="localError" class="utility-error" role="alert">{{ localError }}</p>
			<p v-else-if="!localEntries.length">没有保留的未完成输入。</p>
			<article
				v-for="entry in localEntries"
				:key="entry.editorId"
				class="browser-recovery-entry"
			>
				<div>
					<strong>{{ localTitle(entry) }}</strong
					><small
						>{{
							entry.identity?.name ||
							entry.values.editingCode ||
							entry.values.editingActivity ||
							entry.values.editingWarehouse ||
							"尚无原生记录"
						}}
						· {{ entry.updatedAt }}</small
					>
				</div>
				<div class="browse-row-actions">
					<UiButton v-if="c.localSupported(entry)" @click="emit('recover', entry)"
						>打开并核对</UiButton
					><UiButton variant="danger" @click="localTarget = entry">放弃此输入</UiButton>
				</div>
				<details>
					<summary>查看恢复摘要</summary>
					<RecoverySummary
						:kind="entry.editorKind"
						:values="entry.values"
						:copy-text="JSON.stringify(entry.values, null, 2)"
						:pending-upload-reselection="entry.pendingUploadReselection"
					/>
				</details>
			</article>
		</section>
		<Overlay
			v-if="deleteTarget && active"
			title="删除这份原生草稿？"
			:dismissible="!deleteBusy"
			@close="!deleteBusy && (deleteTarget = undefined)"
			><p>
				将删除
				{{ deleteTarget.document }}。已保留的浏览器输入会单独保留；此操作不会改变库存。
			</p>
			<p v-if="deleteError" role="alert" class="utility-error">{{ deleteError }}</p>
			<template #footer
				><UiButton :disabled="deleteBusy" @click="deleteTarget = undefined"
					>保留草稿</UiButton
				><UiButton variant="danger" :disabled="deleteBusy" @click="c.removeNative">{{
					deleteBusy ? "正在删除…" : "删除草稿"
				}}</UiButton></template
			></Overlay
		>
		<Overlay
			v-if="localTarget && active"
			title="放弃这份浏览器输入？"
			@close="localTarget = undefined"
			><p>仅移除此版本的未完成输入。请先复制需要保留的内容。</p>
			<template #footer
				><UiButton @click="localTarget = undefined">保留输入</UiButton
				><UiButton variant="danger" @click="c.removeLocal">放弃此输入</UiButton></template
			></Overlay
		>
	</section>
</template>
<style scoped>
.record-quantity,
.browser-recovery-entry small {
	display: block;
	color: var(--p-muted);
}
.browser-recovery-list {
	margin-top: var(--p-section-gap, 24px);
}
.browser-recovery-entry {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	padding-block: 16px;
	border-top: 1px solid var(--p-border);
}
.browser-recovery-entry > div:first-child {
	flex: 1 1 240px;
	min-width: 0;
	overflow-wrap: anywhere;
}
.browser-recovery-entry details {
	flex-basis: 100%;
	min-width: 0;
}
</style>
