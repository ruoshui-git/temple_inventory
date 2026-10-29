<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { computed, ref, watch } from "vue";
import type { NativeRecordsController, NativeRecord } from "./useNativeRecords";
import type { RecoverySnapshot } from "../../lib/browserRecovery";
import type { ReportQuery } from "../../lib/reportContract";
import { movementLabels } from "../../lib/presentationLabels";
import { enumPresentationLabel } from "../../lib/presentationLabels";
import UiButton from "../../components/ui/UiButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import QuickExport from "../../components/QuickExport.vue";
import FilterRailEdge from "../../components/ui/FilterRailEdge.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import BrowseSplitButton from "../../components/ui/BrowseSplitButton.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import { operationLabels } from "../../lib/presentationLabels";
import InventoryIcon from "../../components/InventoryIcon.vue";
import { kindIcons } from "../../lib/kindIcons";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import FilterDisclosure from "../../components/ui/FilterDisclosure.vue";
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
import { summarizeItems } from "../../lib/itemSummary";
import { sortByUnit, unitLabel } from "../../lib/units";
import { formatQuantityWithUnit } from "../../lib/formatQuantity";
import { relativeTime } from "../../lib/nativeTime";
import RemoteSelect from "../../components/ui/RemoteSelect.vue";
import { useFilterChoices } from "../references/useFilterChoices";
const filterChoices = useFilterChoices();
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
	newOperation: [kind: string];
}>();
const c = props.controller;
const createOptions = computed(() =>
	(Object.keys(operationLabels) as (keyof typeof operationLabels)[])
		.filter((kind) => kind !== "Receive" && c.reference.operations[kind])
		.map((kind) => ({
			kind,
			label: operationLabels[kind]!,
			icon: kindIcons[kind as keyof typeof kindIcons].icon,
		})),
);
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
const filterSheetOpen = ref(false);
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
				"Stock Reconciliation": kindIcons.Reconcile.label,
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
function resetDraftFilters(includeSearch = false) {
	kindFilter.value = "";
	typeFilter.value = "all";
	draftSort.value = "recent";
	if (includeSearch) draftSearch.value = "";
}
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
		const firstName = String(
			first?.item_name ||
				first?.displayName ||
				first?.name ||
				first?.code ||
				first?.item_code ||
				"",
		).trim();
		const location =
			first?.location || first?.warehouse || first?.t_warehouse || values.ti_warehouse;
		const count = codes.size || lines.length;
		const summary = firstName
			? count > 1
				? `${firstName} 等 ${count} 种物品`
				: firstName
			: summarizeItems([], count);
		return `${summary}${location ? ` → ${warehouseLabel(location, c.reference.warehouses)}` : ""}`;
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
const personRoleLabels: Record<string, string> = {
	any: "任一角色",
	recorder: "记录人",
	handler: "经手人",
	reviewer: "鉴证人",
};
const loadPeople = (search: string, start: number, signal: AbortSignal) =>
	filterChoices.loadPeople(search, start, signal, query.value.person.role);
function setPersonName(name: string) {
	query.value.person = { ...query.value.person, name, ...(name ? {} : { role: "any" }) };
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
			summary: `${row.item_name ? (row.whole.item_count > 1 ? `${row.item_name} 等 ${row.whole.item_count} 种物品` : row.item_name) : summarizeItems([], row.whole.item_count)}${destination ? ` → ${destination}` : ""}`,
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
	sortByUnit(row.whole.quantities, (value) => value.uom)
		.map((value) => formatQuantityWithUnit(Number(value.qty), value.uom))
		.join(" · ");
const aggregates = (row: NativeRecord, key: "gains" | "losses" | "quantities") => {
	const values =
		(
			row.whole as typeof row.whole & {
				gains?: { uom: string; qty: number }[];
				losses?: { uom: string; qty: number }[];
			}
		)[key] || [];
	return (
		sortByUnit(values, (value) => value.uom)
			.map((value) => {
				const quantity = Number(value.qty);
				const formatted = formatQuantityWithUnit(Math.abs(quantity), value.uom);
				return `${quantity > 0 ? "+" : quantity < 0 ? "−" : ""}${formatted}`;
			})
			.join("；") || "—"
	);
};
const countScope = (row: NativeRecord) => {
	const raw = (row.whole as typeof row.whole & { scope?: string }).scope || "";
	try {
		const names = JSON.parse(raw) as string[];
		return names.map((name) => warehouseLabel(name, c.reference.warehouses)).join("、") || "—";
	} catch {
		return raw || "—";
	}
};
const services = useOptionalInventoryServices();
const tableColumns = computed<DataColumn[]>(() =>
	props.mode === "counts"
		? [
				{
					id: "document",
					label: "编号",
					required: true,
					defaultVisible: true,
					kind: "primary",
					className: "count-record-id-column",
				},
				{ id: "count_kind", label: "类型", defaultVisible: true },
				{ id: "status", label: "状态", defaultVisible: true, kind: "status" },
				{ id: "count_scope", label: "盘点范围", defaultVisible: true },
				{ id: "line_count", label: "行数", defaultVisible: false, align: "end" },
				{ id: "item_count", label: "物品种数", defaultVisible: true, align: "end" },
				{ id: "gains", label: "增加", defaultVisible: true },
				{ id: "losses", label: "减少", defaultVisible: true },
				{ id: "net", label: "净差异", defaultVisible: true },
				{ id: "date", label: "日期", defaultVisible: true, sortable: true, kind: "date" },
				{ id: "activity_title", label: "活动", defaultVisible: true },
			]
		: [
				{ id: "document", label: "记录", required: true, defaultVisible: true },
				{
					id: "kind",
					label: "类型 / 状态",
					defaultVisible: true,
					className: "native-record-kind-status",
				},
				{ id: "activity_title", label: "活动 / 借用人", defaultVisible: true },
				{ id: "summary", label: "整份记录", defaultVisible: true },
				{ id: "date", label: "记账日期", defaultVisible: true, sortable: true },
				{ id: "actions", label: "操作", required: true, defaultVisible: true },
			],
);
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
function activityLabel(row: Record<string, unknown>) {
	return row.activity_title || (props.mode === "drafts" ? row.borrower : "") || "—";
}
</script>
<template>
	<ReturnToTop :active="active" :hidden="isMobile && filterSheetOpen" />
	<section class="page browse-page">
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
				<BrowseOverflowMenu>
					<UiButton
						@click="
							c.load();
							c.readLocal();
						"
						icon="refresh"
						>刷新</UiButton
					>
				</BrowseOverflowMenu>
				<BrowseSplitButton
					label="新建"
					kind="Receive"
					:icon="kindIcons.Receive.icon"
					:options="createOptions"
					@select="emit('newOperation', $event)"
				/>
			</template>
			<template #filters>
				<div class="browse-filter-fields">
					<div data-filter-field="kindFilter">
						<label class="form-field"
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
						<label class="form-field"
							>类型<select v-model="typeFilter">
								<option value="all">全部</option>
								<option value="server">草稿单据</option>
								<option value="browser">浏览器暂存</option>
							</select></label
						>
					</div>
					<div data-filter-field="draftSort">
						<label class="form-field"
							>排序<select v-model="draftSort">
								<option value="recent">最近更新</option>
								<option value="operation">操作名称</option>
							</select></label
						>
					</div>
					<UiButton @click="resetDraftFilters()" class="browse-filter-clear"
						>清空筛选</UiButton
					>
				</div>
			</template>
			<template #chips="{ editFilter }">
				<BrowseChip
					v-if="kindFilter"
					:label="`操作：${kindFilter}`"
					:icon="kindIcons[kindFilter as keyof typeof kindIcons]?.icon"
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
				<UiButton
					v-if="
						draftSearch || kindFilter || typeFilter !== 'all' || draftSort !== 'recent'
					"
					variant="ghost"
					@click="resetDraftFilters(true)"
					>清除全部</UiButton
				>
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
			@filter-open="filterSheetOpen = $event"
		>
			<template #actions>
				<BrowseOverflowMenu>
					<UiButton
						@click="
							c.load();
							c.readLocal();
						"
						icon="refresh"
						>刷新</UiButton
					>
					<QuickExport :query="query" title="单据" :active="active" />
				</BrowseOverflowMenu>
				<UiButton variant="primary" icon="count" @click="emit('newCount')"
					>新建盘点</UiButton
				>
			</template>
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
				<FilterDisclosure
					label="人员"
					field="person"
					:summary="query.person.name || '不限'"
				>
					<RemoteSelect
						label="人员"
						:model-value="query.person.name"
						:context="query.person.role"
						:load="loadPeople"
						@update:model-value="setPersonName($event)"
					/>
					<label class="form-field"
						>角色<select
							v-model="query.person.role"
							aria-label="人员角色"
							:disabled="!query.person.name"
						>
							<option
								v-for="(label, role) in personRoleLabels"
								:key="role"
								:value="role"
							>
								{{ label }}
							</option>
						</select></label
					>
				</FilterDisclosure>
				<div data-filter-field="groupBy" tabindex="-1">
					<GroupByFilter
						v-model="query.groupBy"
						:dataset="query.dataset"
						:view="query.view"
					/>
				</div>
				<FilterDisclosure
					label="记账日期"
					field="period"
					:summary="sitePeriodSummary(scope.period, c.reference.siteDate)"
				>
					<PeriodFilter
						v-model="scope.period"
						:today="c.reference.siteDate"
						label="记账日期"
						embedded
					/>
				</FilterDisclosure>
				<FilterDisclosure
					v-if="mode === 'counts'"
					label="状态"
					field="status"
					:summary="
						query.statuses
							.map((status) => ['草稿', '已提交', '已取消'][status])
							.join('、') || '未选择'
					"
				>
					<label class="form-field"
						>状态<select v-model="query.statuses">
							<option :value="[1]">已提交</option>
							<option :value="[0]">草稿</option>
							<option :value="[2]">已取消</option>
							<option :value="[0, 1, 2]">全部状态</option>
						</select></label
					>
				</FilterDisclosure>
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
				<UiButton
					v-if="query.groupBy.length || scopeChips.length || extraChips.length"
					variant="ghost"
					@click="c.reset"
					>清除全部</UiButton
				>
			</template>
			<span v-if="initialized" class="browse-result-count">{{ total }} 份记录</span>
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
						<div class="draft-entry-heading">
							<span class="draft-type-tag" :class="`is-${entry.type}`"
								><InventoryIcon
									:name="entry.type === 'server' ? 'document' : 'device'"
								/>{{ entry.type === "server" ? "草稿单据" : "浏览器暂存" }}</span
							>
							<button
								v-if="
									entry.server || (entry.local && c.localSupported(entry.local))
								"
								type="button"
								class="browse-row-link draft-title-link"
								@click="
									entry.server
										? open(entry.server)
										: emit('recover', entry.local!)
								"
							>
								{{
									entry.server
										? `${entry.label} · ${entry.server.document}`
										: entry.label
								}}
							</button>
							<strong v-else>{{ entry.label }}</strong>
						</div>
						<div class="draft-entry-meta">
							<span :title="entry.summary">{{ entry.summary }}</span>
							<time :datetime="entry.updatedAt" :title="entry.absolute">{{
								relativeTime(entry.updatedAt)
							}}</time>
						</div>
						<div v-if="entry.local" class="draft-entry-recovery">
							<DisclosureSection title="查看详情" summary="此浏览器暂存的输入">
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
							<UiButton
								v-if="entry.server"
								variant="secondary"
								class="draft-continue-action"
								size="compact"
								@click="open(entry.server)"
								>继续编辑</UiButton
							>
							<UiButton
								v-else-if="entry.local && c.localSupported(entry.local)"
								variant="secondary"
								class="draft-continue-action"
								size="compact"
								@click="emit('recover', entry.local)"
								>继续编辑</UiButton
							>
							<UiButton
								v-if="entry.server?.docstatus === 0"
								variant="danger"
								size="compact"
								@click="deleteTarget = entry.server"
								>删除</UiButton
							>
							<UiButton
								v-else-if="entry.local"
								variant="danger"
								size="compact"
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
			<div class="browse-body">
				<aside
					v-if="sidebarOpen && !isMobile"
					class="browse-filter-rail browse-filter-rail"
				>
					<div class="filter-rail-heading">
						<h3>类别与仓库</h3>
						<FilterRailEdge
							:open="true"
							:active="scope.categories.length + scope.warehouses.length > 0"
							@toggle="toggleSidebar"
						/>
					</div>
					<BrowseFilters
						v-model="scope"
						:fields="['categories', 'warehouses']"
						hide-activity
					/>
				</aside>
				<FilterRailEdge
					v-if="!sidebarOpen && !isMobile"
					:open="false"
					:active="scope.categories.length + scope.warehouses.length > 0"
					@toggle="toggleSidebar"
				/>
				<div class="browse-results">
					<DataTable
						data-browse-scroll="records"
						ariaLabel="库存记录"
						:table-class="
							mode === 'counts' ? 'browse-table count-records-table' : 'browse-table'
						"
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
								><small v-if="mode !== 'counts'">{{
									enumPresentationLabel("doctype", row.doctype)
								}}</small>
								<NativeStatusBadge
									v-if="mode !== 'counts'"
									class="native-record-mobile-status"
									:status="Number(row.docstatus)"
								/>
							</button>
							<template v-else-if="column.id === 'count_kind'">{{
								row.kind === "Opening" ? "期初库存" : "盘点调整"
							}}</template>
							<NativeStatusBadge
								v-else-if="column.id === 'status'"
								:status="Number(row.docstatus)"
							/>
							<template v-else-if="column.id === 'count_scope'">{{
								countScope(nativeRow(row))
							}}</template>
							<template v-else-if="column.id === 'line_count'">{{
								nativeRow(row).whole.line_count
							}}</template>
							<template v-else-if="column.id === 'item_count'">{{
								nativeRow(row).whole.item_count
							}}</template>
							<template v-else-if="column.id === 'gains'">{{
								aggregates(nativeRow(row), "gains")
							}}</template>
							<template v-else-if="column.id === 'losses'">{{
								aggregates(nativeRow(row), "losses")
							}}</template>
							<span v-else-if="column.id === 'net'" title="增加与减少相抵后的净值">
								{{ aggregates(nativeRow(row), "quantities") }}
							</span>
							<template v-else-if="column.id === 'kind'">
								<InventoryIcon
									v-if="row.kind"
									:name="
										kindIcons[String(row.kind) as keyof typeof kindIcons]
											?.icon || 'movement'
									"
								/>
								{{
									row.kind
										? movementLabels[String(row.kind)] || "其他类型"
										: "库存单据"
								}}
								·
								<NativeStatusBadge :status="Number(row.docstatus)" />
							</template>
							<template v-else-if="column.id === 'activity_title'">{{
								activityLabel(row)
							}}</template>
							<div v-else-if="column.id === 'summary'" class="native-record-summary">
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
									v-if="nativeRow(row).docstatus === 0"
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
:deep(.count-records-table :is(th, td).count-record-id-column) {
	min-width: 240px;
	white-space: nowrap;
}
:deep(.count-records-table td.count-record-id-column) {
	overflow: visible;
}
:deep(.count-records-table td.count-record-id-column > :first-child) {
	display: inline-flex;
	width: max-content;
	max-width: none;
	overflow: visible;
	text-overflow: clip;
	white-space: nowrap;
}
:deep(.count-records-table td.count-record-id-column .browse-row-link) {
	display: inline-flex;
	width: max-content;
	max-width: none;
	overflow: visible;
	text-overflow: clip;
	white-space: nowrap;
	-webkit-line-clamp: unset;
}
:deep(.count-records-table td.count-record-id-column .browse-row-link strong) {
	display: inline;
	width: auto;
	max-width: none;
	overflow: visible;
	text-overflow: clip;
	white-space: nowrap;
	-webkit-line-clamp: unset;
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
	grid-template-columns: minmax(0, 1.4fr) minmax(9rem, 1fr) auto auto;
	align-items: center;
	gap: var(--p-space-2) var(--p-space-3);
	padding: var(--p-space-3) 0;
	border-top: 1px solid var(--p-border);
}
.draft-entry > * {
	min-width: 0;
}
.draft-entry-meta time {
	color: var(--p-muted);
	font-size: var(--p-small);
}
.draft-entry-heading {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
}
.draft-title-link {
	min-height: 0;
	padding: 0;
	color: var(--p-accent-strong);
	font-size: 0.92rem;
	font-weight: 650;
}
.draft-entry-meta > span {
	display: block;
	min-width: 0;
	overflow: hidden;
	color: var(--p-muted);
	text-overflow: ellipsis;
	white-space: nowrap;
}
.draft-entry-recovery {
	grid-column: 1 / -1;
}
.draft-entry > .browse-row-actions {
	grid-column: 4;
	grid-row: 1;
	flex-wrap: nowrap;
	white-space: nowrap;
	opacity: 1;
}
.draft-entry > .browse-row-actions :deep(.ui-button--danger) {
	color: var(--p-danger);
	border-color: var(--p-danger);
	background: var(--p-danger-bg);
}
.draft-entry > .browse-row-actions :deep(.draft-continue-action) {
	color: var(--p-ink);
	border-color: var(--p-control-border);
	background: var(--p-surface);
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
@media (max-width: 1023px) {
	.drafts-explainer {
		margin-top: 8px;
		color: var(--p-muted);
		font-size: 0.84rem;
	}
	.draft-entry {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		padding-block: 10px;
	}
	.draft-entry-heading {
		grid-column: 1 / -1;
	}
	.draft-entry-meta {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 6px;
	}
	.draft-entry-meta time {
		flex: none;
		white-space: nowrap;
	}
	.draft-entry-recovery {
		grid-column: 1 / -1;
	}
	.draft-entry-heading strong,
	.draft-entry-meta > span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.draft-entry-heading strong {
		font-size: 0.92rem;
	}
	.draft-entry-meta {
		color: var(--p-muted);
		font-size: 0.78rem;
	}
	.draft-entry .browse-row-actions {
		grid-column: 2;
		grid-row: 2;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
	}
}
@media (max-width: 600px) {
	.draft-entry .browse-row-actions :deep(.ui-button) {
		min-height: 44px;
		padding-inline: 8px;
		font-size: 0.78rem;
	}
}
</style>
