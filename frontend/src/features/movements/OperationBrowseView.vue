<script setup lang="ts">
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { useFilterRailPreference } from "../../composables/useFilterRailPreference";
import Scanner from "../../components/Scanner.vue";
import Overlay from "../../components/ui/Overlay.vue";
import RelatedLoanPreview from "../loans/RelatedLoanPreview.vue";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, onMounted, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import type { OperationBrowse, OperationGroup } from "./useOperationBrowse";
import type { ReportQuery } from "../../lib/reportContract";
import {
	clearScopeField,
	movementLabels,
	scopeFilterFieldChips,
} from "../../lib/filterPresentation";
import { sortableColumnLabels, sortableColumnsForView } from "../../lib/reportContract";
import { groupLabels } from "../../lib/reportContract";
import { removeGroupByField } from "../../lib/groupBy";
import { enumPresentationLabel } from "../../lib/presentationLabels";
import UiButton from "../../components/ui/UiButton.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import QuickExport from "../../components/QuickExport.vue";
import ItemGroup from "../../components/ItemGroup.vue";
import SortControl from "../../components/ui/SortControl.vue";
import { loanSummaryMetrics, movementSummaryMetrics } from "./movementSummary";
import OperationBrowseFilters from "./OperationBrowseFilters.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import DataTable from "../../components/ui/DataTable.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import type {
	DataColumn,
	DataTableEntry,
	DataTableGroup,
	DataTableRecord,
} from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { useOptionalInventoryServices } from "../../services/contracts";
import type { MovementHistoryPage } from "../../lib/reportContract";
import type { ReportRow } from "../../lib/reportContract";
import type { HistoryRow } from "./useMovementHistory";
import ItemImage from "../../components/ItemImage.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import { formatQuantity } from "../../lib/formatQuantity";
import { createRecoveryStore } from "../../lib/browserRecovery";
import { newReportQuery } from "../../lib/reportContract";
const props = withDefaults(
	defineProps<{
		controller: OperationBrowse;
		family: "movements" | "loans";
		records: boolean;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	switchView: [records: boolean, query: ReportQuery];
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
	settle: [name: string];
	openItem: [code: string];
	browse: [query: ReportQuery];
	openExport: [query: ReportQuery];
	newOperation: [kind: string];
}>();
const c = props.controller;
const {
	query,
	routeError,
	result,
	reference,
	scope,
	search,
	historyScope,
	extraChips,
	dimension,
	analysis,
	details,
} = c;
const { isMobile } = useResponsiveLayout();
const showMobileItemCards = computed(
	() =>
		isMobile.value &&
		!props.records &&
		query.value.groupBy.length === 1 &&
		query.value.groupBy[0] === "item",
);
const services = useOptionalInventoryServices();
const draftCount = ref(0);
async function refreshDraftCount() {
	if (!services || props.family !== "movements") return;
	const query = newReportQuery("movements");
	query.view = "records";
	query.statuses = [0];
	try {
		const page = await services.call<{ matched_count: number }>("browse.native_drafts", {
			query,
			start: 0,
			page_length: 1,
		});
		let localCount = 0;
		try {
			localCount = createRecoveryStore(reference.site, reference.user, localStorage)
				.list()
				.entries.filter((entry) => entry.editorKind === "Stock Entry").length;
		} catch {
			/* The server draft count remains available without browser storage. */
		}
		draftCount.value = page.matched_count + localCount;
	} catch {
		draftCount.value = 0;
	}
}
onMounted(() => void refreshDraftCount());
const operationColumns = computed<DataColumn[]>(() =>
	props.family === "movements"
		? [
				{
					id: "document",
					label: "记录",
					required: true,
					defaultVisible: true,
					sortable: true,
					sortField: "identity",
					minWidth: "190px",
				},
				{
					id: "kind",
					label: "类型",
					defaultVisible: true,
					sortable: true,
					minWidth: "110px",
				},
				{
					id: "date",
					label: "日期",
					defaultVisible: true,
					sortable: true,
					minWidth: "130px",
				},
				{ id: "source", label: "来源位置", defaultVisible: true, minWidth: "150px" },
				{ id: "destination", label: "去向位置", defaultVisible: true, minWidth: "150px" },
				{
					id: "quantities",
					label: "数量（按单位）",
					defaultVisible: true,
					minWidth: "150px",
				},
				{
					id: "docstatus",
					label: "状态",
					required: true,
					defaultVisible: true,
					minWidth: "100px",
				},
				{
					id: "related_loans",
					label: "关联借出",
					defaultVisible: true,
					minWidth: "140px",
				},
			]
		: [
				{
					id: "document",
					label: "记录",
					required: true,
					defaultVisible: true,
					sortable: true,
					sortField: "identity",
					minWidth: "190px",
				},
				{
					id: "borrower",
					label: "借用方",
					defaultVisible: true,
					sortable: true,
					minWidth: "130px",
				},
				{
					id: "activity_title",
					label: "活动",
					defaultVisible: true,
					sortable: true,
					minWidth: "140px",
				},
				{
					id: "date",
					label: "借出日期",
					defaultVisible: true,
					sortable: true,
					minWidth: "130px",
				},
				{ id: "source", label: "来源位置", defaultVisible: true, minWidth: "150px" },
				{ id: "destination", label: "去向位置", defaultVisible: true, minWidth: "150px" },
				{
					id: "quantities",
					label: "借出数量（按单位）",
					defaultVisible: true,
					minWidth: "150px",
				},
				{
					id: "outstanding",
					label: "未归还数量（按单位）",
					defaultVisible: true,
					minWidth: "160px",
				},
				{
					id: "status",
					label: "状态",
					required: true,
					defaultVisible: true,
					sortable: true,
					sortField: "loan_status",
					minWidth: "140px",
				},
				{
					id: "actions",
					label: "操作",
					required: true,
					defaultVisible: true,
					minWidth: "130px",
				},
			],
);
const operationRows = computed<DataTableRecord[]>(() =>
	result.rows.map((row) => ({
		kind: "record",
		id: row.id,
		value: row as unknown as Record<string, unknown>,
	})),
);
const operationTableRows = computed<DataTableEntry[]>(() =>
	query.value.groupBy.length ? c.groups.entries.value : operationRows.value,
);
const itemColumns = computed<DataColumn[]>(() =>
	props.family === "movements"
		? [
				{
					id: "document",
					label: "记录",
					required: true,
					defaultVisible: true,
					minWidth: "190px",
				},
				{
					id: "kind",
					label: "类型",
					defaultVisible: true,
					sortable: true,
					sortField: "kind",
					minWidth: "110px",
				},
				{
					id: "date",
					label: "日期",
					defaultVisible: true,
					sortable: true,
					sortField: "date",
					minWidth: "130px",
				},
				{ id: "source", label: "来源位置", defaultVisible: true, minWidth: "150px" },
				{ id: "destination", label: "去向位置", defaultVisible: true, minWidth: "150px" },
				{
					id: "quantities",
					label: "数量（按单位）",
					defaultVisible: true,
					sortable: true,
					sortField: "stock_qty",
					minWidth: "170px",
				},
				{ id: "docstatus", label: "状态", defaultVisible: true, minWidth: "100px" },
				{
					id: "related_loans",
					label: "关联借出 / 操作",
					required: true,
					defaultVisible: true,
					minWidth: "170px",
				},
			]
		: [
				{
					id: "document",
					label: "记录",
					required: true,
					defaultVisible: true,
					sortable: true,
					sortField: "document",
					minWidth: "180px",
				},
				{
					id: "kind",
					label: "类型",
					defaultVisible: true,
					sortable: true,
					sortField: "kind",
					minWidth: "110px",
				},
				{
					id: "date",
					label: "日期",
					defaultVisible: true,
					sortable: true,
					sortField: "date",
					minWidth: "130px",
				},
				{ id: "source", label: "来源位置", defaultVisible: true, minWidth: "150px" },
				{ id: "destination", label: "去向位置", defaultVisible: true, minWidth: "150px" },
				{
					id: "borrowed",
					label: "数量",
					defaultVisible: true,
					sortable: true,
					sortField: "borrowed",
					minWidth: "120px",
				},
				{ id: "status", label: "状态", defaultVisible: true, minWidth: "110px" },
				{ id: "actions", label: "操作", defaultVisible: true, minWidth: "120px" },
				{
					id: "outstanding",
					label: "未还数量",
					defaultVisible: true,
					sortable: true,
					sortField: "outstanding",
					minWidth: "120px",
				},
			],
);
function historyRecord(row: Record<string, unknown>, item: OperationGroup): DataTableRecord {
	const quantity = Number(row.quantity ?? row.stock_qty ?? row.borrowed ?? 0);
	const uom = String(row.stock_uom || item.stock_uom || "");
	const source = String(row.source_warehouse || row.source || "");
	const destination = String(row.destination_warehouse || row.destination || "");
	return {
		kind: "record",
		id: `history:${item.id}:${String(row.id || row.document || JSON.stringify(row))}`,
		value: {
			...row,
			date: row.date || String(row.date_time || "").split(" ")[0],
			history_record: true,
			item_code: item.item_code || row.item_code,
			item_name: item.item_name || row.item_name,
			whole: {
				...(row.whole as Record<string, unknown> | undefined),
				quantities: [{ uom, qty: quantity }],
				available_effects: [{ uom, qty: Number(row.available_effect || 0) }],
				branches: [{ source, destination }],
				outstanding:
					row.kind === "Loan" && row.outstanding != null
						? [{ uom, qty: Number(row.outstanding || 0) }]
						: [],
				original_loans: row.original_loans || [],
				loan_status: row.loan_status,
			},
		} as unknown as Record<string, unknown>,
	};
}
function itemHistoryRows(item: OperationGroup): DataTableEntry[] {
	if (!c.expanded.has(item.id)) return [];
	const detail = details[item.id];
	return (detail?.rows || []).map((row) => historyRecord(row as Record<string, unknown>, item));
}
const itemTableRows = computed<DataTableEntry[]>(() => {
	if (!query.value.groupBy.length) return itemHistoryRows(flatHistoryItem.value);
	return c.groups.entries.value.flatMap((entry) => {
		if (entry.kind !== "group") return [entry];
		const groupField = query.value.groupBy[entry.depth - 1];
		if (groupField !== "item") return [entry];
		const item = groupItem(entry);
		const expanded = c.expanded.has(item.id);
		return [
			{
				...entry,
				expanded,
				detailRow: expanded,
				loading: details[item.id]?.loading,
				error: details[item.id]?.error,
			},
			...itemHistoryRows(item),
		];
	});
});
const flatHistoryItem = computed<OperationGroup>(() => ({
	id: "flat-history-scope",
	document_count: 0,
	item_count: 0,
}));
const groupRoot = computed(() => c.groups.pages.value["[[],null]"]);
const mobileItemGroups = computed(() => {
	const rows = (groupRoot.value?.rows || []).filter((row) => row.row_grain === "group");
	return rows.map((row) => {
		const field = String(row.group_field || query.value.groupBy[0] || "");
		const rawLabel = String(row.group_label || "未分类");
		const group: DataTableGroup = {
			kind: "group" as const,
			id: row.id,
			parentId: row.parent_group_id || undefined,
			label: ["kind", "status", "docstatus", "outcome", "outcome_key"].includes(field)
				? enumPresentationLabel(field, rawLabel, query.value)
				: rawLabel,
			depth: row.group_depth || 1,
			count: Number(row.display_count ?? row.row_count ?? 0),
			countLabel: "明细条数",
			expanded: false,
			hasChildren: Boolean(row.has_children),
			value: row as Record<string, unknown>,
		};
		const item = groupItem(group);
		return {
			...group,
			expanded: c.expanded.has(item.id),
			loading: details[item.id]?.loading,
			error: details[item.id]?.error,
		};
	});
});
function toggleMobileItemGroup(group: DataTableGroup, open: boolean) {
	c.toggle(groupItem(group), open);
}
function operationRow(row: Record<string, unknown>): OperationGroup {
	const rawWhole = row.whole;
	if (row.row_grain === "record" && rawWhole && typeof rawWhole === "object") {
		const whole = rawWhole as Record<string, unknown>;
		const quantities = (value: unknown) =>
			Array.isArray(value)
				? value.flatMap((entry) =>
						entry && typeof entry === "object"
							? [
									{
										uom: String((entry as Record<string, unknown>).uom || ""),
										qty: Number((entry as Record<string, unknown>).qty || 0),
									},
								]
							: [],
					)
				: [];
		const branches = Array.isArray(whole.branches)
			? whole.branches.flatMap((entry) =>
					entry && typeof entry === "object"
						? [
								{
									source: String(
										(entry as Record<string, unknown>).source || "",
									),
									destination: String(
										(entry as Record<string, unknown>).destination || "",
									),
								},
							]
						: [],
				)
			: [];
		return {
			id: String(row.id || `${row.doctype || ""}:${row.document || ""}`),
			doctype: String(row.doctype || ""),
			document: String(row.document || ""),
			date: String(row.date || ""),
			kind: String(row.kind || ""),
			borrower: String(row.borrower || ""),
			activity_title: String(row.activity_title || ""),
			docstatus: Number(row.docstatus || 0),
			document_count: Number(row.document_count || 0),
			item_count: Number(row.item_count || 0),
			allocation_count: Number(row.allocation_count || 0),
			whole: {
				quantities: quantities(whole.quantities),
				available_effects: quantities(whole.available_effects),
				outstanding: quantities(whole.outstanding),
				item_count: Number(whole.item_count || 0),
				line_count: Number(whole.line_count || 0),
				branches,
				original_loans: Array.isArray(row.original_loans)
					? row.original_loans.map(String)
					: Array.isArray(
								(row.whole as Record<string, unknown> | undefined)?.original_loans,
						  )
						? ((row.whole as Record<string, unknown>).original_loans as unknown[]).map(
								String,
							)
						: [],
				loan_status: typeof whole.loan_status === "string" ? whole.loan_status : undefined,
			},
		};
	}
	return row as unknown as OperationGroup;
}
function groupSummary(group: DataTableGroup, includeCount = false) {
	const row = group.value || {};
	const parts: string[] = [];
	if (includeCount) parts.push(`明细条数 ${group.count}`);
	if (props.family === "loans") {
		const unit = String(row.stock_uom || "");
		if (row.borrowed !== undefined) parts.push(`借出 ${row.borrowed} ${unit}`.trim());
		if (row.outstanding !== undefined) parts.push(`未归还 ${row.outstanding} ${unit}`.trim());
	} else if (Array.isArray(row.quantity_breakdown)) {
		for (const entry of row.quantity_breakdown as Record<string, unknown>[]) {
			const quantity = Number(entry.stock_qty || 0);
			if (!quantity) continue;
			const parallel = (row.quantity_breakdown as Record<string, unknown>[]).some(
				(other) => other.kind === entry.kind && other.docstatus !== entry.docstatus,
			);
			const status = parallel
				? `（${entry.docstatus === 1 ? "已提交" : entry.docstatus === 2 ? "已取消" : "草稿"}）`
				: "";
			parts.push(
				`${movementLabels[String(entry.kind)] || "其他类型"}${status} ${quantity} ${row.stock_uom || ""}`.trim(),
			);
		}
	} else if (row.stock_qty !== undefined && row.stock_qty !== null) {
		parts.push(`${row.stock_qty} ${row.stock_uom || ""}`.trim());
	}
	return parts.join(" · ");
}
function openHistoryDocument(row: Record<string, unknown>) {
	if (row.kind === "Loan") emit("openLoan", String(row.document));
	else emit("openDocument", String(row.doctype), String(row.document));
}
function toggleItemGroup(id: string) {
	const itemId = id.startsWith("details:") ? id.slice("details:".length) : id;
	const row = result.rows.find((entry) => entry.id === itemId);
	if (row) c.toggle(row, !c.expanded.has(row.id));
}
function toggleDisclosure(id: string) {
	if (id.startsWith("details:") || !query.value.groupBy.length) {
		toggleItemGroup(id);
		return;
	}
	const entry = c.groups.entries.value.find(
		(candidate): candidate is DataTableGroup =>
			candidate.kind === "group" && candidate.id === id,
	);
	if (entry && isItemGroup(entry)) {
		const item = groupItem(entry);
		c.toggle(item, !c.expanded.has(item.id));
	} else void c.groups.toggleGroup(id);
}
function groupItem(group: DataTableGroup): OperationGroup {
	const value = group.value || {};
	const itemCode = String(value.item_code || value.code || "");
	const row = result.rows.find(
		(entry) =>
			(entry.id === value.id && value.id) ||
			(entry.item_code && entry.item_code === itemCode) ||
			(entry.item_name && entry.item_name === group.label),
	);
	return {
		...(row || {}),
		...value,
		id: String(row?.id || value.id || group.id),
		item_code: itemCode || row?.item_code || group.label,
		item_name: String(value.item_name || row?.item_name || group.label),
		image: String(value.image || row?.image || ""),
		document_count: Number(value.document_count || row?.document_count || group.count),
		item_count: Number(value.item_count || row?.item_count || 0),
	} as OperationGroup;
}
function isItemGroup(group: DataTableGroup) {
	return query.value.groupBy[group.depth - 1] === "item";
}
const operationPreferences = services
	? useColumnPreferences(
			`operations.${props.family}.records`,
			operationColumns,
			reference,
			services,
		)
	: undefined;
const itemPreferences = services
	? useColumnPreferences(`operations.${props.family}.items`, itemColumns, reference, services)
	: undefined;
function sortTable(field: string) {
	if (sortFields.value.some((option) => option.value === field)) sortRecords(field);
}
const {
	open: filtersOpen,
	toggle: toggleFilters,
	saveError: filtersSaveError,
	retry: retryFiltersSave,
} = useFilterRailPreference(
	`browse.${props.family}.${props.records ? "records" : "items"}`,
	reference,
	false,
);
const scanOpen = ref(false);
const analysisOpen = ref(false);
watch([() => props.active, isMobile], () => {
	scanOpen.value = false;
	analysisOpen.value = false;
	c.relatedLoans.close();
});
const outcomeLabels: Record<string, string> = {
	outstanding: "未归还",
	returned: "完好归还",
	damaged: "损坏归还",
	lost: "遗失",
};
const loanLabels: Record<string, string> = {
	Draft: "草稿",
	Cancelled: "已取消",
	Open: "未结清",
	Settled: "已结清",
	Closed: "已结清",
};
const dimensions: Record<string, string> = {
	category: "类别 / 单位",
	location: "来源位置 / 单位",
	activity: "活动",
	borrower: "借用方",
	month: "月份",
};
const scopeChips = computed(() => scopeFilterFieldChips(scope.value, reference));
function removeScopeChip(chip: (typeof scopeChips.value)[number]) {
	clearScopeField(scope.value, chip.field);
}
const analysisFields: Record<string, string> = {
	category: "category",
	location: "source_warehouse",
	activity: "activity_title",
	borrower: "borrower",
	month: "month",
};
const sortFields = computed(() =>
	sortableColumnsForView(props.family, props.records ? "records" : query.value.view).map(
		(field) => ({
			value: field,
			label: sortableColumnLabels[field] || field,
		}),
	),
);
function sortRecords(field: string) {
	if (query.value.sortBy === field)
		query.value.sort = query.value.sort === "asc" ? "desc" : "asc";
	else {
		query.value.sortBy = field;
		query.value.sort = "asc";
	}
}
const metrics = computed(() => {
	if (props.family === "movements") {
		return movementSummaryMetrics(result.totals);
	}
	return loanSummaryMetrics(result.totals, props.records);
});
function quantities(rows?: { uom: string; qty: number }[]) {
	return rows?.map((row) => `${row.qty} ${row.uom}`).join(" | ") || "";
}
function itemContext(row: OperationGroup) {
	const values = [row.item_code];
	if (row.category) values.push(row.category);
	values.push(`${row.document_count} 笔记录`, `最近 ${row.date || ""}`);
	return values.join(" · ");
}
function itemTotals(row: OperationGroup) {
	const groups =
		props.family === "movements"
			? movementSummaryMetrics(row.totals || [])
			: loanSummaryMetrics(row.totals || [], false);
	return groups.flatMap((group) =>
		group.quantities.map((quantity) => ({
			key: `${group.key}:${quantity.uom}:${quantity.status || ""}`,
			label: group.label,
			quantity,
			effect: "effect" in quantity ? quantity.effect : undefined,
		})),
	);
}
function effectLabel(effect: number, uom: string, status?: string) {
	if (status === "草稿" || status === "已取消") effect = 0;
	return effect > 0
		? `可用库存增加 ${effect} ${uom}`
		: effect < 0
			? `可用库存减少 ${Math.abs(effect)} ${uom}`
			: `可用库存不变 · ${uom}`;
}
function recordEffect(row: OperationGroup, uom: string) {
	if (row.docstatus === 0 || row.docstatus === 2) return 0;
	return Number(row.whole?.available_effects?.find((effect) => effect.uom === uom)?.qty || 0);
}
function recordEffectTone(row: OperationGroup, uom: string) {
	const effect = recordEffect(row, uom);
	return effect > 0
		? "stock-effect is-increase"
		: effect < 0
			? "stock-effect is-decrease"
			: "stock-effect is-neutral";
}
function recordEffectLabel(row: OperationGroup, uom: string) {
	return effectLabel(recordEffect(row, uom), uom);
}
function openedRecord(row: OperationGroup) {
	if (result.stale) return;
	props.family === "loans"
		? emit("openLoan", String(row.document))
		: emit("openDocument", String(row.doctype), String(row.document));
}
function switchView(records: boolean) {
	if (records === props.records) return;
	emit("switchView", records, c.viewQuery(records));
}
function movementHistoryRows(id: string): MovementHistoryPage["rows"] {
	return (details[id]?.rows || []) as unknown as MovementHistoryPage["rows"];
}
</script>
<template>
	<section class="browse-page">
		<ReturnToTop :active="active" :hidden="isMobile && filtersOpen" />
		<div class="preview-activity-browse">
			<BrowseToolbar
				:title="family === 'movements' ? '货物流动' : '借用'"
				v-model:search="search"
				:search-label="family === 'movements' ? '搜索货物流动' : '搜索借用'"
				:sidebar-open="filtersOpen"
				:sidebar-save-error="filtersSaveError"
				:retry-sidebar-save="retryFiltersSave"
				sidebar-available
				scannable
				:summary="family === 'movements' ? '货物流动' : '借用'"
				:active="active"
				:filter-count="extraChips.length + scopeChips.length"
				@scan="scanOpen = true"
				@sidebar="toggleFilters"
			>
				<template #actions
					><QuickExport
						:query="query"
						:active="active"
						@open-full="emit('openExport', $event)"
					/><template v-if="family === 'movements'"
						><a class="drafts-entry-link" href="/drafts"
							>草稿 <span>{{ draftCount }}</span></a
						>
						<UiButton
							v-if="reference.operations.Receive"
							variant="primary"
							icon="box"
							@click="emit('newOperation', 'Receive')"
							>入库</UiButton
						><UiButton
							v-if="reference.operations.Issue"
							icon="movement"
							@click="emit('newOperation', 'Issue')"
							>出库</UiButton
						><UiButton
							v-if="reference.operations.Transfer"
							icon="movement"
							@click="emit('newOperation', 'Transfer')"
							>调拨</UiButton
						></template
					><UiButton
						v-else-if="reference.operations.Loan"
						variant="primary"
						icon="loan"
						@click="emit('newOperation', 'Loan')"
						>登记借出</UiButton
					></template
				>
				<template #persistent
					><nav
						class="browse-view-switch"
						:aria-label="family === 'movements' ? '货物流动视图' : '借用视图'"
					>
						<button
							:aria-current="!records ? 'page' : undefined"
							@click="switchView(false)"
						>
							按物品</button
						><button
							:aria-current="records ? 'page' : undefined"
							@click="switchView(true)"
						>
							按记录
						</button>
					</nav></template
				>
				<template #filters>
					<OperationBrowseFilters
						:controller="c"
						:family="family"
						:records="records"
						:hierarchy-in-rail="filtersOpen && !isMobile"
					/>
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
						:label="chip.summary || chip.label"
						:removable="!chip.fixed"
						@edit="editFilter(chip.field)"
						@remove="Object.assign(query, chip.reset)"
					/>
				</template>
				<div class="browse-toolbar browse-sort-only">
					<SortControl
						v-model:field="query.sortBy"
						v-model:direction="query.sort"
						:fields="sortFields"
						:label="family === 'loans' ? '借用排序' : '流动排序'"
					/>
					<UiButton v-if="result.initialized && !records" @click="analysisOpen = true"
						>分析结果</UiButton
					>
				</div>
				<p v-if="routeError" role="alert">{{ routeError }}</p>
				<p v-if="family === 'loans'" class="browse-note">
					按借出日期筛选，显示当前结清情况。<UiButton
						variant="ghost"
						@click="emit('browse', c.loanHistory())"
						>查看期间借还流动</UiButton
					>
				</p>
			</BrowseToolbar>
			<section
				v-if="result.initialized"
				class="preview-activity-summary"
				aria-label="当前筛选汇总"
				aria-live="polite"
			>
				<p class="browse-result-count">
					筛选结果：{{ result.total }} {{ records ? "笔记录" : "种物品" }}
				</p>
				<details class="browse-summary-details">
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />
						数量分析：{{
							metrics
								.slice(0, 2)
								.flatMap((metric) =>
									metric.quantities
										.slice(0, 1)
										.map(
											(quantity) =>
												`${metric.label} ${quantity.qty} ${quantity.uom}`,
										),
								)
								.join(" · ")
						}}
						· 查看完整分析
					</summary>
					<QuantitySummary
						:metrics="metrics"
						:loading="result.loading || result.stale"
					/>
				</details>
			</section>
			<SkeletonBlock v-if="!records && result.loading" variant="lines" :count="5" />
			<p v-if="result.stale" class="notice-bar warning" role="status">
				上次结果 · 尚未更新，相关操作暂停。
			</p>
			<p v-if="!records && result.error" class="notice-bar danger" role="alert">
				{{ result.error }} <UiButton @click="c.retry">重试加载</UiButton>
			</p>
			<div class="preview-browse-body">
				<aside
					v-if="filtersOpen && !isMobile"
					class="preview-filter-rail browse-filter-rail"
				>
					<h3>筛选{{ family === "movements" ? "货物流动" : "借用" }}</h3>
					<BrowseFilters v-model="scope" :fields="['categories', 'warehouses']" />
				</aside>
				<div class="preview-browse-results">
					<Overlay
						v-if="analysisOpen && !records"
						title="分析当前结果"
						adaptive-creation
						@close="analysisOpen = false"
					>
						<label class="preview-field"
							>分组<select v-model="dimension">
								<option
									v-for="(label, value) in dimensions"
									:key="value"
									:value="value"
								>
									{{ label }}
								</option>
							</select></label
						>
						<ReportTable
							v-if="analysis"
							:preference-id="`operations.${family}.${query.view}.analysis.${dimension}`"
							:table="{
								id: 'operation-analysis',
								label: '完整筛选分组',
								columns: [
									analysisFields[dimension]!,
									family === 'loans' ? 'outcome_key' : 'kind',
									'docstatus',
									'item_count',
									'document_count',
									'stock_qty',
									'stock_uom',
								],
								rows: analysis.rows,
							}"
							:total="analysis.total"
							:loading="analysis.loading"
							:initialized="analysis.initialized"
							:error="analysis.error"
							@load-more="c.moreAnalysis"
							@retry="c.moreAnalysis"
						/>
						<SkeletonBlock v-else-if="result.loading" variant="list" :rows="4" />
						<p class="muted">
							基于完整筛选结果；一条记录涉及多个分组时，各组记录数不可相加。
						</p>
					</Overlay>
					<template v-if="showMobileItemCards">
						<ItemGroup
							v-for="group in mobileItemGroups"
							:key="group.id"
							:data-browse-row="group.id"
							:item="c.stockItem(groupItem(group))"
							:name="group.label"
							:context="groupSummary(group, true)"
							:expanded="group.expanded"
							@expanded="toggleMobileItemGroup(group, $event)"
						>
							<div class="mobile-group-actions">
								<UiButton
									:disabled="result.stale"
									@click="
										emit(
											'openItem',
											String(group.value?.item_code || group.label),
										)
									"
									>物品详情</UiButton
								>
							</div>
							<MovementHistoryTable
								v-if="
									family === 'movements' &&
									c.expanded.has(groupItem(group).id) &&
									details[groupItem(group).id]
								"
								:rows="movementHistoryRows(groupItem(group).id)"
								:total="details[groupItem(group).id]!.total"
								:next="details[groupItem(group).id]!.next"
								:loading="details[groupItem(group).id]!.loading"
								:error="details[groupItem(group).id]!.error"
								:initialized="details[groupItem(group).id]!.initialized"
								:stale="result.stale"
								:sort-by="c.detailSortBy(groupItem(group))"
								:sort-direction="c.detailSortDirection(groupItem(group))"
								@load-more="c.loadDetails(groupItem(group), true)"
								@retry="c.retryDetails(groupItem(group))"
								@sort="c.setDetailSort(groupItem(group), $event)"
								@open-document="
									(doctype, name) => emit('openDocument', doctype, name)
								"
								@open-loan="emit('openLoan', $event)"
							>
							</MovementHistoryTable>
							<p
								v-if="
									family === 'loans' &&
									historyScope === 'outstanding' &&
									details[groupItem(group).id]?.initialized &&
									!details[groupItem(group).id]?.rows.length
								"
								class="field-hint"
							>
								当前范围没有未结清借用记录。可在筛选中切换到“全部相关记录”查看历史。
							</p>
							<MovementHistoryTable
								v-else-if="
									family === 'loans' &&
									c.expanded.has(groupItem(group).id) &&
									details[groupItem(group).id]
								"
								:rows="details[groupItem(group).id]!.rows as HistoryRow[]"
								:total="details[groupItem(group).id]!.total"
								:next="details[groupItem(group).id]!.next"
								:loading="details[groupItem(group).id]!.loading"
								:error="details[groupItem(group).id]!.error"
								:initialized="details[groupItem(group).id]!.initialized"
								:stale="result.stale"
								:history-complete="details[groupItem(group).id]!.historyComplete"
								:sort-by="c.detailSortBy(groupItem(group))"
								:sort-direction="c.detailSortDirection(groupItem(group))"
								mode="loan-balance"
								@load-more="c.loadDetails(groupItem(group), true)"
								@retry="c.retryDetails(groupItem(group))"
								@sort="c.setDetailSort(groupItem(group), $event)"
								@open-document="
									(doctype, name) => emit('openDocument', doctype, name)
								"
								@open-loan="emit('openLoan', $event)"
							>
								<template #actions="{ row: contribution }">
									<UiButton
										v-if="
											contribution.kind === 'Loan' && contribution.can_settle
										"
										:disabled="
											result.stale ||
											details[groupItem(group).id]!.loading ||
											!reference.operations.Return
										"
										@click="emit('settle', String(contribution.document))"
										>登记归还</UiButton
									>
								</template>
							</MovementHistoryTable>
						</ItemGroup>
					</template>
					<p
						v-if="
							family === 'loans' &&
							!records &&
							!query.groupBy.length &&
							c.expanded.has(flatHistoryItem.id) &&
							historyScope === 'outstanding' &&
							details[flatHistoryItem.id]?.initialized &&
							!details[flatHistoryItem.id]?.rows.length
						"
						class="field-hint"
					>
						当前范围没有未结清借用记录。可在筛选中切换到“全部相关记录”查看历史。
					</p>
					<DataTable
						v-if="!records && !showMobileItemCards"
						data-browse-scroll="operation-items"
						ariaLabel="物品流动汇总"
						table-class="browse-table"
						:columns="itemColumns"
						:rows="itemTableRows"
						:column-preferences="itemPreferences"
						:loading="
							query.groupBy.length
								? Boolean(groupRoot?.loading)
								: result.loading || Boolean(details[flatHistoryItem.id]?.loading)
						"
						:initialized="
							query.groupBy.length
								? Boolean(groupRoot?.initialized)
								: result.initialized &&
									Boolean(details[flatHistoryItem.id]?.initialized)
						"
						:error="
							query.groupBy.length
								? groupRoot?.error || ''
								: details[flatHistoryItem.id]?.error || result.error
						"
						:stale="
							query.groupBy.length
								? Boolean(groupRoot?.stale)
								: result.stale || Boolean(details[flatHistoryItem.id]?.error)
						"
						:retained="
							Boolean(
								query.groupBy.length
									? groupRoot?.rows.length && groupRoot.loading
									: details[flatHistoryItem.id]?.rows.length &&
											details[flatHistoryItem.id]?.loading,
							)
						"
						:has-more="
							query.groupBy.length
								? c.groups.hasMore()
								: details[flatHistoryItem.id]?.next != null
						"
						:loaded-count="
							query.groupBy.length
								? c.groups.progress().loaded
								: details[flatHistoryItem.id]?.rows.length || 0
						"
						:total-count="
							query.groupBy.length
								? c.groups.progress().total
								: details[flatHistoryItem.id]?.total || 0
						"
						:loading-more="
							query.groupBy.length
								? Boolean(c.groups.pages.value['[[],null]']?.loading)
								: details[flatHistoryItem.id]?.loading &&
									details[flatHistoryItem.id]?.rows.length > 0
						"
						:row-attributes="(row) => ({ 'data-browse-row': String(row.id) })"
						:cell-class="
							(column, row) =>
								column === 'quantities' &&
								family === 'movements' &&
								row.history_record
									? recordEffectTone(
											operationRow(row),
											String(row.stock_uom || ''),
										)
									: ''
						"
						:row-label="
							(row) =>
								family === 'movements' && row.history_record
									? recordEffectLabel(
											operationRow(row),
											String(row.stock_uom || ''),
										)
									: undefined
						"
						empty-text="没有匹配的物品"
						:sort-by="c.detailSortBy(flatHistoryItem)"
						:sort-direction="c.detailSortDirection(flatHistoryItem)"
						@sort="c.setDetailSort(flatHistoryItem, $event)"
						@toggle-group="toggleDisclosure"
						@retry="
							query.groupBy.length
								? c.groups.retry()
								: c.retryDetails(flatHistoryItem)
						"
						@load-more="
							query.groupBy.length
								? c.groups.loadMore()
								: c.loadDetails(flatHistoryItem, true)
						"
					>
						<template #cell="{ column, row }">
							<template v-if="row.history_record">
								<button
									v-if="column.id === 'document'"
									class="browse-row-link"
									:disabled="result.stale"
									@click="openHistoryDocument(row)"
								>
									{{ row.document }}
								</button>
								<small v-if="column.id === 'document'" class="muted">{{
									row.item_name || row.item_code
								}}</small>
								<template v-else-if="column.id === 'kind'">{{
									enumPresentationLabel("kind", row.kind)
								}}</template>
								<template v-else-if="column.id === 'borrower'">{{
									row.borrower || ""
								}}</template>
								<template v-else-if="column.id === 'activity_title'">{{
									row.activity_title || ""
								}}</template>
								<template v-else-if="column.id === 'date'">{{
									row.date
								}}</template>
								<template v-else-if="column.id === 'borrowed'">
									{{
										row.signed &&
										Number(row.quantity ?? row.stock_qty ?? row.borrowed) > 0
											? "+"
											: Number(
														row.quantity ??
															row.stock_qty ??
															row.borrowed,
												  ) < 0
												? "−"
												: ""
									}}{{
										formatQuantity(
											Math.abs(
												Number(
													row.quantity ??
														row.stock_qty ??
														row.borrowed ??
														0,
												),
											),
										)
									}}
									{{ row.stock_uom }}
								</template>
								<template
									v-else-if="
										column.id === 'outstanding' &&
										row.kind === 'Loan' &&
										row.outstanding != null
									"
								>
									{{ formatQuantity(Number(row.outstanding)) }}
									{{ row.stock_uom }}
								</template>
								<template v-else-if="column.id === 'source'">{{
									warehouseLabel(
										String(row.source_warehouse || ""),
										reference.warehouses,
									) || "外部"
								}}</template>
								<template v-else-if="column.id === 'destination'">{{
									warehouseLabel(
										String(row.destination_warehouse || ""),
										reference.warehouses,
									) || "外部"
								}}</template>
								<template v-else-if="column.id === 'quantities'">
									<span
										:class="
											family === 'movements'
												? recordEffectTone(
														operationRow(row),
														String(row.stock_uom || ''),
													)
												: 'operation-total'
										"
										:title="
											family === 'movements'
												? recordEffectLabel(
														operationRow(row),
														String(row.stock_uom || ''),
													)
												: undefined
										"
									>
										{{
											row.signed && Number(row.quantity ?? row.stock_qty) > 0
												? "+"
												: Number(row.quantity ?? row.stock_qty) < 0
													? "−"
													: ""
										}}{{
											formatQuantity(
												Math.abs(
													Number(row.quantity ?? row.stock_qty ?? 0),
												),
											)
										}}
										{{ row.stock_uom || "" }}
									</span>
									<small
										v-if="family === 'movements'"
										class="history-effect-note"
										>{{
											recordEffectLabel(
												operationRow(row),
												String(row.stock_uom || ""),
											)
										}}</small
									>
								</template>
								<NativeStatusBadge
									v-else-if="column.id === 'docstatus'"
									:status="row.docstatus"
								/>
								<div v-else-if="column.id === 'status'" class="loan-record-status">
									<NativeStatusBadge :status="row.docstatus" /><span
										v-if="row.docstatus === 1 && row.kind === 'Loan'"
										>{{
											enumPresentationLabel(
												"loan_status",
												operationRow(row).whole?.loan_status,
											)
										}}</span
									>
								</div>
								<UiButton
									v-else-if="
										column.id === 'actions' &&
										row.kind === 'Loan' &&
										row.can_settle
									"
									:disabled="result.stale || !reference.operations.Return"
									@click="emit('settle', String(row.document))"
									>登记归还</UiButton
								>
								<UiButton
									v-else-if="column.id === 'related_loans' && row.original_loan"
									@click="emit('openLoan', String(row.original_loan))"
									>查看原借用</UiButton
								>
							</template>
							<template v-else>
								<div v-if="column.id === 'document'" class="browse-item-identity">
									<ItemImage
										v-if="c.stockItem(operationRow(row))"
										:item="c.stockItem(operationRow(row))!"
									/>
									<button
										class="browse-row-link"
										:disabled="result.stale"
										@click="emit('openItem', String(row.item_code))"
									>
										{{ row.item_name || row.item_code }}
									</button>
								</div>
								<template v-else-if="column.id === 'kind'">{{
									row.category || "物品汇总"
								}}</template>
								<template v-else-if="column.id === 'borrower'">{{
									row.borrower || ""
								}}</template>
								<template v-else-if="column.id === 'activity_title'">{{
									row.activity_title || ""
								}}</template>
								<div
									v-else-if="column.id === 'quantities'"
									class="operation-item-totals"
								>
									<span
										v-for="metric in itemTotals(operationRow(row))"
										:key="metric.key"
										class="operation-total"
										:class="
											typeof metric.effect === 'number'
												? metric.effect > 0
													? 'stock-effect is-increase'
													: metric.effect < 0
														? 'stock-effect is-decrease'
														: 'stock-effect is-neutral'
												: undefined
										"
										:title="
											typeof metric.effect === 'number'
												? effectLabel(
														metric.effect,
														metric.quantity.uom,
														metric.quantity.status,
													)
												: undefined
										"
										>{{ metric.label }} {{ metric.quantity.qty }}
										{{ metric.quantity.uom
										}}<small v-if="metric.quantity.status">
											· {{ metric.quantity.status }}</small
										></span
									>
								</div>
								<div
									v-else-if="
										column.id === 'actions' || column.id === 'related_loans'
									"
									class="browse-row-actions"
								>
									<UiButton
										:disabled="result.stale"
										@click="
											c.toggle(
												operationRow(row),
												!c.expanded.has(String(row.id)),
											)
										"
										>{{
											c.expanded.has(String(row.id))
												? "收起历史"
												: "查看历史"
										}}</UiButton
									>
									<UiButton
										:disabled="result.stale"
										@click="emit('openItem', String(row.item_code))"
										>物品详情</UiButton
									>
								</div>
							</template>
						</template>
						<template #group-label="{ group }">
							<span class="data-table-group-visual">
								<ItemImage
									v-if="isItemGroup(group) && c.stockItem(groupItem(group))"
									:item="c.stockItem(groupItem(group))!"
								/>
							</span>
						</template>
						<template #group-column="{ group, column }">
							<span
								class="operation-group-metrics"
								:title="groupSummary(group)"
								v-if="
									column.id === (family === 'loans' ? 'borrowed' : 'quantities')
								"
								>{{ groupSummary(group) }}</span
							>
						</template>
						<template #group="{ group }">
							<div
								v-if="isItemGroup(group) && group.expanded"
								class="browse-group-details"
							>
								<p
									v-if="
										family === 'loans' &&
										historyScope === 'outstanding' &&
										details[groupItem(group).id]?.initialized &&
										!details[groupItem(group).id]?.rows.length
									"
									class="field-hint"
								>
									当前范围没有未结清借用记录。可在筛选中切换到“全部相关记录”查看历史。
								</p>
								<UiButton
									v-if="details[groupItem(group).id]?.error"
									@click="c.retryDetails(groupItem(group))"
									>重试</UiButton
								>
								<UiButton
									v-if="
										details[groupItem(group).id]?.next !== null &&
										details[groupItem(group).id]?.next !== undefined
									"
									:loading="details[groupItem(group).id]?.loading"
									@click="c.loadDetails(groupItem(group), true)"
									>加载更多记录 ·
									{{ details[groupItem(group).id]?.rows.length ?? 0 }} /
									{{ details[groupItem(group).id]?.total ?? 0 }}</UiButton
								>
								<span
									v-if="details[groupItem(group).id]?.historyComplete === false"
									role="status"
									>关联结算信息尚未完整</span
								>
							</div>
							<div v-else>
								<UiButton v-if="group.error" @click="c.groups.retry(group.id)"
									>重试</UiButton
								>
								<UiButton
									v-if="c.groups.hasMore(group.id)"
									:loading="group.loading"
									@click="c.groups.loadMore(group.id)"
									>加载更多此分组 · {{ c.groups.progress(group.id).loaded }} /
									{{ c.groups.progress(group.id).total }}</UiButton
								>
							</div>
						</template>
					</DataTable>
					<DataTable
						v-if="records"
						data-browse-scroll="operations"
						:ariaLabel="family === 'movements' ? '货物流动记录' : '借用记录'"
						table-class="browse-table"
						:columns="operationColumns"
						:rows="operationTableRows"
						:column-preferences="operationPreferences"
						:sort-by="query.sortBy"
						:sort-direction="query.sort"
						:loading="
							query.groupBy.length ? Boolean(groupRoot?.loading) : result.loading
						"
						:initialized="
							query.groupBy.length
								? Boolean(groupRoot?.initialized)
								: result.initialized
						"
						:error="query.groupBy.length ? groupRoot?.error || '' : result.error"
						:stale="query.groupBy.length ? Boolean(groupRoot?.stale) : result.stale"
						:retained="
							Boolean(
								query.groupBy.length
									? groupRoot?.rows.length && groupRoot.loading
									: result.rows.length && result.loading,
							)
						"
						:has-more="
							query.groupBy.length ? c.groups.hasMore() : result.next !== null
						"
						:loaded-count="
							query.groupBy.length ? c.groups.progress().loaded : result.rows.length
						"
						:total-count="
							query.groupBy.length ? c.groups.progress().total : result.total
						"
						:loading-more="
							query.groupBy.length
								? Boolean(groupRoot?.loading && groupRoot.rows.length)
								: result.loading && result.rows.length > 0
						"
						:row-attributes="(row) => ({ 'data-browse-row': String(row.id) })"
						empty-text="没有匹配的记录"
						@sort="sortTable"
						@toggle-group="c.groups.toggleGroup"
						@retry="query.groupBy.length ? c.groups.retry() : c.retry()"
						@load-more="query.groupBy.length ? c.groups.loadMore() : c.load(true)"
					>
						<template #group="{ group }">
							<UiButton v-if="group.error" @click="c.groups.retry(group.id)"
								>重试</UiButton
							>
							<UiButton
								v-if="c.groups.hasMore(group.id)"
								:loading="group.loading"
								@click="c.groups.loadMore(group.id)"
								>加载更多此分组 · {{ c.groups.progress(group.id).loaded }} /
								{{ c.groups.progress(group.id).total }}</UiButton
							>
						</template>
						<template #group-column="{ column, group }">
							<span
								v-if="
									column.id === 'quantities' &&
									group.value?.stock_qty !== undefined
								"
							>
								{{ group.value.stock_qty }} {{ group.value.stock_uom }}
							</span>
							<span
								v-else-if="
									column.id === 'outstanding' &&
									group.value?.outstanding !== undefined
								"
							>
								{{ group.value.outstanding }} {{ group.value.stock_uom }}
							</span>
						</template>
						<template #cell="{ column, row }">
							<button
								v-if="column.id === 'document'"
								class="browse-row-link"
								:disabled="result.stale"
								@click="openedRecord(row as unknown as OperationGroup)"
							>
								{{ row.document }}
							</button>
							<UiButton
								v-else-if="
									column.id === 'related_loans' &&
									operationRow(row).whole?.original_loans?.length
								"
								:disabled="result.stale"
								@click="
									c.relatedLoans.show(
										operationRow(row).whole?.original_loans || [],
									)
								"
								>{{
									(operationRow(row).whole?.original_loans || []).length === 1
										? "查看关联借出"
										: `关联借出（${(operationRow(row).whole?.original_loans || []).length}）`
								}}</UiButton
							>
							<template v-else-if="column.id === 'kind'">{{
								enumPresentationLabel("kind", row.kind)
							}}</template>
							<template v-else-if="column.id === 'borrower'">{{
								row.borrower || ""
							}}</template>
							<template v-else-if="column.id === 'activity'">{{
								row.activity_title || ""
							}}</template>
							<template v-else-if="column.id === 'date'">{{ row.date }}</template>
							<template v-else-if="column.id === 'source'"
								><div
									v-for="branch in operationRow(row).whole?.branches || []"
									:key="JSON.stringify(branch)"
								>
									{{
										branch.source
											? warehouseLabel(branch.source, reference.warehouses)
											: "外部"
									}}
								</div></template
							>
							<template v-else-if="column.id === 'destination'"
								><div
									v-for="branch in operationRow(row).whole?.branches || []"
									:key="JSON.stringify(branch)"
								>
									{{
										branch.destination
											? warehouseLabel(
													branch.destination,
													reference.warehouses,
												)
											: "外部"
									}}
								</div></template
							>
							<template v-else-if="column.id === 'quantities'"
								><span
									v-for="quantity in operationRow(row).whole?.quantities || []"
									:key="quantity.uom"
									class="operation-total"
									:class="
										family === 'movements'
											? recordEffectTone(
													row as unknown as OperationGroup,
													quantity.uom,
												)
											: undefined
									"
									:title="
										family === 'movements'
											? recordEffectLabel(
													row as unknown as OperationGroup,
													quantity.uom,
												)
											: undefined
									"
									>{{ quantity.qty }} {{ quantity.uom
									}}<span v-if="family === 'movements'" class="sr-only">{{
										recordEffectLabel(
											row as unknown as OperationGroup,
											quantity.uom,
										)
									}}</span></span
								></template
							>
							<template v-else-if="column.id === 'outstanding'">{{
								row.docstatus === 1
									? quantities(operationRow(row).whole?.outstanding)
									: ""
							}}</template>
							<div v-else-if="column.id === 'docstatus'" class="loan-record-status">
								<NativeStatusBadge :status="row.docstatus" />
							</div>
							<div v-else-if="column.id === 'status'" class="loan-record-status">
								<NativeStatusBadge :status="row.docstatus" /><span
									v-if="row.docstatus === 1 && row.kind === 'Loan'"
									>{{
										enumPresentationLabel(
											"loan_status",
											operationRow(row).whole?.loan_status,
										)
									}}</span
								>
							</div>
							<UiButton
								v-else-if="
									column.id === 'actions' &&
									row.docstatus === 1 &&
									operationRow(row).whole?.loan_status === 'Open'
								"
								:disabled="result.stale || !reference.operations.Return"
								@click="emit('settle', String(row.document))"
								>登记归还</UiButton
							>
						</template>
					</DataTable>
				</div>
			</div>
		</div>
		<RelatedLoanPreview
			:controller="c.relatedLoans"
			:disabled="result.stale"
			@open-full="emit('openLoan', $event)"
		/>
		<Scanner
			v-if="scanOpen"
			presentation="modal"
			@close="scanOpen = false"
			@scan="
				search = $event;
				scanOpen = false;
			"
		/>
	</section>
</template>
<style scoped>
.drafts-entry-link {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-height: 36px;
	padding: 6px 10px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	color: var(--p-ink);
	text-decoration: none;
}
.drafts-entry-link span {
	min-width: 1.5em;
	padding: 1px 5px;
	border-radius: 999px;
	background: var(--p-soft);
	text-align: center;
	font-size: var(--p-small);
}
</style>
