<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { computed, ref, watch } from "vue";
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
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
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
import AsyncRegion from "../../components/ui/AsyncRegion.vue";
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
import { warehouseLabel } from "../../lib/warehouseLabel";
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
type DraftListEntry = {
	id: string;
	type: "server" | "browser";
	kind: string;
	label: string;
	summary: string;
	updatedAt: string;
	absolute: string;
	server?: NativeRecord;
	local?: RecoverySnapshot;
};
const kindFilter = ref("");
const typeFilter = ref("all");
const draftSort = ref("recent");
const draftSearch = ref("");
function localSummary(entry: RecoverySnapshot) {
	const values = entry.values as Record<string, unknown>;
	if (entry.editorKind === "Stock Entry") {
		const lines = Array.isArray(values.items) ? values.items : [];
		if (!lines.length)
			return String(values.source || values.remarks || values.note || "尚未添加物品");
		const codes = new Set(
			lines
				.map((line) =>
					String(
						(line as Record<string, unknown>)?.code ||
							(line as Record<string, unknown>)?.item_code ||
							"",
					),
				)
				.filter(Boolean),
		);
		const first = lines[0] as Record<string, unknown> | undefined;
		const location =
			first?.location || first?.warehouse || first?.t_warehouse || values.ti_warehouse;
		return `${codes.size || lines.length} 种物品${location ? ` → ${warehouseLabel(location, c.reference.warehouses)}` : ""}`;
	}
	if (entry.editorKind === "Stock Reconciliation") {
		const lines = Array.isArray(values.ti_count_review) ? values.ti_count_review : [];
		const locations = Array.isArray(values.ti_count_warehouses)
			? values.ti_count_warehouses
			: [];
		return `盘点 ${lines.length} 种物品 · ${locations.length} 个库位`;
	}
	if (entry.editorKind === "Item") return String(values.name || values.editingCode || "新物品");
	if (entry.editorKind === "Inventory Activity")
		return String(values.title || values.editingActivity || "活动资料");
	if (entry.editorKind === "Warehouse")
		return String(values.label || values.editingWarehouse || "仓库资料");
	return "未完成输入";
}
function relativeTime(value: string) {
	const timestamp = new Date(value).getTime();
	if (!Number.isFinite(timestamp)) return value || "时间未知";
	const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	const days = Math.floor(hours / 24);
	return `${days} 天前`;
}
const draftEntries = computed<DraftListEntry[]>(() => {
	if (props.mode !== "drafts") return [];
	const server: DraftListEntry[] = rows.value.map((row) => {
		const kind = row.kind ? movementLabels[String(row.kind)] || "其他类型" : "库存操作";
		const branch =
			row.whole.branches.find((value) => value.destination) || row.whole.branches[0];
		const destination = branch?.destination
			? warehouseLabel(branch.destination, c.reference.warehouses)
			: "";
		return {
			id: `server:${row.id}`,
			type: "server",
			kind: String(row.kind || ""),
			label: kind,
			summary: `${row.whole.item_count} 种物品${destination ? ` → ${destination}` : ""}`,
			updatedAt: row.modified || `${row.date || ""} ${row.time || ""}`.trim(),
			absolute: row.modified || `${row.date || ""} ${row.time || ""}`.trim(),
			server: row,
		};
	});
	const browser: DraftListEntry[] = localEntries.value.map((entry) => ({
		id: `browser:${entry.editorId}`,
		type: "browser",
		kind: entry.editorKind,
		label: localTitle(entry),
		summary: localSummary(entry),
		updatedAt: entry.updatedAt,
		absolute: new Date(entry.updatedAt).toLocaleString("zh-CN"),
		local: entry,
	}));
	const search = draftSearch.value.trim().toLocaleLowerCase();
	return [...server, ...browser]
		.filter((entry) => !kindFilter.value || entry.label === kindFilter.value)
		.filter((entry) => typeFilter.value === "all" || entry.type === typeFilter.value)
		.filter(
			(entry) =>
				!search ||
				`${entry.label} ${entry.summary} ${entry.id}`.toLocaleLowerCase().includes(search),
		)
		.sort((a, b) =>
			draftSort.value === "operation"
				? a.label.localeCompare(b.label, "zh-CN")
				: new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		);
});
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
			v-if="mode === 'drafts'"
			title="草稿"
			:summary="initialized ? `草稿 · ${draftEntries.length} 份` : '草稿'"
			v-model:search="draftSearch"
			search-label="搜索草稿、物品或活动"
			:active="active"
			:filter-count="
				Number(Boolean(kindFilter)) +
				Number(typeFilter !== 'all') +
				Number(draftSort !== 'recent')
			"
		>
			<template #actions>
				<UiButton
					@click="
						c.load();
						c.readLocal();
					"
					>刷新</UiButton
				>
			</template>
			<template #filters>
				<div class="preview-filter-fields">
					<div data-filter-field="kindFilter">
						<label class="preview-field"
							>操作<select v-model="kindFilter">
								<option value="">全部操作</option>
								<option
									v-for="kind in [
										...new Set([
											...rows.map((row) =>
												row.kind
													? movementLabels[String(row.kind)] ||
														'其他类型'
													: '库存操作',
											),
											...localEntries.map(localTitle),
										]),
									]"
									:key="kind"
									:value="kind"
								>
									{{ kind }}
								</option>
							</select></label
						>
					</div>
					<div data-filter-field="typeFilter">
						<label class="preview-field"
							>类型<select v-model="typeFilter">
								<option value="all">全部</option>
								<option value="server">草稿单据</option>
								<option value="browser">浏览器暂存</option>
							</select></label
						>
					</div>
					<div data-filter-field="draftSort">
						<label class="preview-field"
							>排序<select v-model="draftSort">
								<option value="recent">最近更新</option>
								<option value="operation">操作名称</option>
							</select></label
						>
					</div>
					<UiButton
						@click="
							kindFilter = '';
							typeFilter = 'all';
							draftSort = 'recent';
							draftSearch = '';
						"
						class="browse-filter-clear"
						>清空筛选</UiButton
					>
				</div>
			</template>
			<template #chips="{ editFilter }">
				<BrowseChip
					v-if="kindFilter"
					:label="`操作：${kindFilter}`"
					@edit="editFilter('kindFilter')"
					@remove="kindFilter = ''"
				/>
				<BrowseChip
					v-if="typeFilter !== 'all'"
					:label="`类型：${typeFilter === 'server' ? '草稿单据' : '浏览器暂存'}`"
					@edit="editFilter('typeFilter')"
					@remove="typeFilter = 'all'"
				/>
				<BrowseChip
					v-if="draftSort !== 'recent'"
					label="排序：操作名称"
					@edit="editFilter('draftSort')"
					@remove="draftSort = 'recent'"
				/>
				<BrowseChip
					v-if="draftSearch"
					:label="`搜索：${draftSearch}`"
					@edit="editFilter()"
					@remove="draftSearch = ''"
				/>
			</template>
		</BrowseToolbar>
		<BrowseToolbar
			v-if="mode === 'counts'"
			title="盘点调整"
			summary="盘点调整"
			v-model:search="query.search"
			search-label="搜索盘点记录或物品"
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
					v-if="c.reference.capabilities['Stock Reconciliation']?.create"
					variant="primary"
					@click="emit('newCount')"
					>新建盘点</UiButton
				></template
			>
			<template #subtitle>
				<p class="browse-subtitle">
					{{ "仅显示实际保存的盘点调整；数量一致的盘点不产生记录。" }}
				</p>
			</template>
			<template #filters>
				<BrowseFilters
					v-model="scope"
					disclosure-mode
					:movement="false"
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
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />
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
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />
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
				<UiButton class="browse-filter-clear" @click="c.clear">清空筛选</UiButton>
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
				<span v-if="initialized" class="browse-result-count">{{ total }} 份记录</span>
			</div>
		</BrowseToolbar>
		<p v-if="routeError" class="utility-error" role="alert">{{ routeError }}</p>
		<div v-else-if="mode === 'drafts'" class="drafts-browser">
			<p class="drafts-explainer">草稿单据已保存到系统；浏览器暂存只保存在当前设备。</p>
			<DisclosureSection title="了解区别" summary="系统草稿与浏览器暂存的差异">
				<p>
					<InventoryIcon name="document" />
					<strong>草稿单据</strong>：已保存到系统的草稿，尚未改变库存；可在任何设备或
					ERPNext 中继续。
				</p>
				<p>
					<InventoryIcon name="device" />
					<strong>浏览器暂存</strong
					>：内容尚不完整，无法存为草稿单据，暂时保存在此浏览器；换设备或清除浏览器数据会丢失。
				</p>
			</DisclosureSection>
			<p v-if="localError" class="utility-error" role="alert">{{ localError }}</p>
			<AsyncRegion
				:loading="loading"
				:initialized="initialized"
				:stale="stale"
				:error="error"
				label="草稿刷新中。"
			>
				<template #skeleton><SkeletonBlock variant="list" :rows="5" /></template>
				<ul class="draft-entry-list">
					<li v-for="entry in draftEntries" :key="entry.id" class="draft-entry">
						<div class="draft-entry-main">
							<span class="draft-type-tag" :class="`is-${entry.type}`"
								><InventoryIcon
									:name="entry.type === 'server' ? 'document' : 'device'"
								/>{{ entry.type === "server" ? "草稿单据" : "浏览器暂存" }}</span
							>
							<strong>{{ entry.label }}</strong>
							<span>{{ entry.summary }}</span>
							<time :datetime="entry.updatedAt" :title="entry.absolute">{{
								relativeTime(entry.updatedAt)
							}}</time>
							<DisclosureSection
								v-if="entry.local"
								title="查看详情"
								summary="此浏览器暂存的输入"
							>
								<RecoverySummary
									:kind="entry.local.editorKind"
									:values="entry.local.values"
									:copy-text="JSON.stringify(entry.local.values, null, 2)"
									:pending-upload-reselection="
										entry.local.pendingUploadReselection
									"
								/>
							</DisclosureSection>
						</div>
						<div class="browse-row-actions">
							<UiButton v-if="entry.server" @click="open(entry.server)"
								>继续编辑</UiButton
							>
							<UiButton
								v-else-if="entry.local && c.localSupported(entry.local)"
								@click="emit('recover', entry.local)"
								>继续编辑</UiButton
							>
							<UiButton
								v-if="entry.server?.whole.can_delete"
								variant="danger"
								@click="deleteTarget = entry.server"
								>删除</UiButton
							>
							<UiButton
								v-else-if="entry.local"
								variant="danger"
								@click="localTarget = entry.local"
								>放弃</UiButton
							>
						</div>
					</li>
					<li v-if="initialized && !draftEntries.length" class="browse-empty">
						没有符合条件的草稿。
					</li>
				</ul>
			</AsyncRegion>
		</div>
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
						ariaLabel="库存记录"
						table-class="browse-table"
						:columns="tableColumns"
						:rows="browseRows"
						:column-preferences="tablePrefs"
						:sort-by="query.sortBy"
						:sort-direction="query.sort"
						:loading="loading || Boolean(query.groupBy.length && groupRoot?.loading)"
						loading-text="库存记录加载中…"
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
						empty-text="没有符合条件的记录"
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
										: "库存单据"
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
		<Overlay
			v-if="deleteTarget && active"
			title="删除这份草稿单据？"
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
.record-quantity {
	display: block;
	color: var(--p-muted);
}
.drafts-browser {
	display: grid;
	gap: var(--p-space-3);
}
.drafts-explainer,
.drafts-difference,
.draft-entry-list {
	margin: 0;
}
.drafts-difference {
	margin-block: var(--p-space-3);
}
.drafts-difference p {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	margin: var(--p-space-2) 0 0;
}
.drafts-difference svg {
	width: 18px;
	height: 18px;
}
.draft-entry-list {
	display: grid;
	padding: 0;
	list-style: none;
}
.draft-entry {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: var(--p-space-2) var(--p-space-3);
	padding: var(--p-space-3) 0;
	border-top: 1px solid var(--p-border);
}
.draft-entry-main {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 12px;
	min-width: 0;
	overflow-wrap: anywhere;
}
.draft-entry-main time {
	color: var(--p-muted);
	font-size: var(--p-small);
}
.draft-type-tag {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 3px 8px;
	border-radius: 999px;
	background: var(--p-soft);
	font-size: var(--p-small);
}
.draft-type-tag svg {
	width: 16px;
	height: 16px;
}
.draft-type-tag.is-browser {
	background: var(--p-warning-bg, var(--p-soft));
}
.draft-entry-details {
	flex: 1 0 100%;
	min-width: 0;
}
@media (max-width: 600px) {
	.draft-entry {
		grid-template-columns: minmax(0, 1fr);
	}
	.draft-entry .browse-row-actions {
		display: flex;
		flex-wrap: nowrap;
		justify-content: flex-end;
	}
}
</style>
