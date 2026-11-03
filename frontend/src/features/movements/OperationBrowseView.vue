<script setup lang="ts">
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { useFilterRailPreference } from "../../composables/useFilterRailPreference";
import ScanPanel from "../scanner/ScanPanel.vue";
import Overlay from "../../components/ui/Overlay.vue";
import RelatedLoanPreview from "../loans/RelatedLoanPreview.vue";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import type { OperationBrowse, OperationGroup } from "./useOperationBrowse";
import { operationColumnsFor, operationItemColumnsFor } from "./operationColumns";
import type { ReportQuery } from "../../lib/reportContract";
import { clearScopeField, scopeFilterFieldChips } from "../../lib/filterPresentation";
import { sortableColumnLabels, sortableColumnsForView } from "../../lib/reportContract";
import { groupLabels } from "../../lib/reportContract";
import { removeGroupByField } from "../../lib/groupBy";
import { groupImpliedColumns } from "../../lib/groupColumns";
import { enumPresentationLabel, movementLabels } from "../../lib/presentationLabels";
import { formatQuantityWithUnit } from "../../lib/formatQuantity";
import { formatSiteDateTime } from "../../lib/nativeTime";
import { kindIcons } from "../../lib/kindIcons";
import InventoryIcon from "../../components/InventoryIcon.vue";
import UiButton from "../../components/ui/UiButton.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import BrowseCard from "../../components/ui/BrowseCard.vue";
import BrowseLoadMore from "../../components/ui/BrowseLoadMore.vue";
import ItemCard from "../../components/ui/ItemCard.vue";
import ViewModeToggle from "../../components/ui/ViewModeToggle.vue";
import ItemGroupLines from "./ItemGroupLines.vue";
import CardFields from "../../components/ui/CardFields.vue";
import ColumnSettings from "../../components/ui/ColumnSettings.vue";
import BrowseEmpty from "../../components/ui/BrowseEmpty.vue";
import RowFieldsSheet from "../../components/ui/RowFieldsSheet.vue";
import OperationItemCell from "./OperationItemCell.vue";
import OperationRecordCell from "./OperationRecordCell.vue";
import type { BrowseView } from "../../composables/useBrowseViewMode";
import type { OperationCellHelpers } from "./operationColumns";
import { CARD_FIELD_LIMIT, ROW_FIELD_LIMIT, partitionCardColumns } from "../../lib/cardLayout";
import QuickExport from "../../components/QuickExport.vue";
import BrowseSplitButton from "../../components/ui/BrowseSplitButton.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import { operationLabels } from "../../lib/presentationLabels";
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import SortControl from "../../components/ui/SortControl.vue";
import { loanSummaryMetrics, movementSummaryMetrics } from "./movementSummary";
import OperationBrowseFilters from "./OperationBrowseFilters.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import FilterRailEdge from "../../components/ui/FilterRailEdge.vue";
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import DataTable from "../../components/ui/DataTable.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import BrowseRefreshNotice from "../../components/ui/BrowseRefreshNotice.vue";
import {
	orderedVisibleColumns,
	type DataColumn,
	type DataTableEntry,
	type DataTableGroup,
	type DataTableRecord,
} from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { exportFields } from "../../lib/exportColumns";
import { useOptionalInventoryServices } from "../../services/contracts";
import type { MovementHistoryPage } from "../../lib/reportContract";
import type { ReportRow } from "../../lib/reportContract";
import type { HistoryRow } from "./useMovementHistory";
import ItemImage from "../../components/ItemImage.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import { formatQuantity } from "../../lib/formatQuantity";
import { createRecoveryStore } from "../../lib/browserRecovery";
import { RouterLink } from "vue-router";
import { routeTarget } from "../../lib/routeRegistry";
import { sortByUnit, unitLabel } from "../../lib/units";
import UnitValues from "../../components/ui/UnitValues.vue";
import GroupTotals, { type GroupTotalMetric } from "../../components/ui/GroupTotals.vue";
import { stockEffectLabel } from "../../lib/stockEffectLabel";
const exportMenu = ref<{ open(): void }>();
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
	settle: [selection: string];
	openItem: [code: string];
	browse: [query: ReportQuery];
	openExport: [query: ReportQuery];
	newOperation: [kind: string];
}>();
const c = props.controller;
const browseView = c.browseView;
const {
	query,
	routeError,
	result,
	reference,
	scope,
	search,
	extraChips,
	atDefaults,
	dimension,
	analysis,
	details,
} = c;
const { isMobile } = useResponsiveLayout();
const wideScreen = ref(window.innerWidth >= 1440);
function updateWideScreen() {
	wideScreen.value = window.innerWidth >= 1440;
}
onMounted(() => window.addEventListener("resize", updateWideScreen));
onBeforeUnmount(() => window.removeEventListener("resize", updateWideScreen));
const createOptions = computed(() => {
	const kinds =
		props.family === "movements"
			? ["Issue", "Transfer", "Loan", "Return", "Damage", "Loss", "Repair", "Disposal"]
			: ["Return"];
	return kinds
		.filter((kind) => reference.operations[kind])
		.map((kind) => ({
			kind,
			label: operationLabels[kind as keyof typeof operationLabels],
			icon: kindIcons[kind as keyof typeof kindIcons].icon,
		}));
});
const showMobileItemCards = computed(
	() =>
		isMobile.value &&
		!props.records &&
		query.value.groupBy.length === 1 &&
		query.value.groupBy[0] === "item",
);
const canShowItemCards = computed(
	() =>
		!props.records &&
		(!query.value.groupBy.length ||
			(query.value.groupBy.length === 1 && query.value.groupBy[0] === "item")),
);
// The item DataTable is the 表格 layout, or the only layout for groupings other than item.
const itemTableMounted = computed(
	() => !props.records && (!canShowItemCards.value || browseView.value === "table"),
);
const services = useOptionalInventoryServices();
const draftCount = ref(0);
async function refreshDraftCount() {
	if (!services || props.family !== "movements") return;
	try {
		const page = await services.call<{ matched_count: number }>("browse.native_draft_count");
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
const operationColumns = computed<DataColumn[]>(() => operationColumnsFor(props.family));
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
const selectedReturnRows = computed(() => {
	const source = props.records ? operationTableRows.value : itemTableRows.value;
	return source.flatMap((entry) =>
		entry.kind === "record" && entry.value && c.selected.value.includes(entry.id)
			? [entry.value]
			: [],
	);
});
const canReturnSelected = computed(() => {
	if (!props.records)
		return (
			selectedReturnItemRows.value.length > 0 &&
			selectedReturnItemRows.value.every(hasOutstandingLoan)
		);
	if (!selectedReturnRows.value.length) return false;
	const eligible = selectedReturnRows.value.filter(
		(row) =>
			row.kind === "Loan" &&
			Number(row.docstatus) === 1 &&
			Number(row.outstanding || row.loaned || 0) > 0,
	);
	if (eligible.length !== selectedReturnRows.value.length) return false;
	return true;
});
const selectedReturnReason = computed(() => {
	if (props.records) {
		if (!selectedReturnRows.value.length) return "请先选择未归还借用记录";
		if (canReturnSelected.value) return "";
		const eligible = selectedReturnRows.value.filter(
			(row) =>
				row.kind === "Loan" &&
				Number(row.docstatus) === 1 &&
				Number(row.outstanding || row.loaned || 0) > 0,
		);
		return "所选记录没有未归还数量";
	}
	return selectedReturnItemRows.value.length
		? "所选物品没有未归还数量"
		: "请先选择有未归还数量的物品";
});
function beginSelectedReturn() {
	if (props.records) {
		const loans = selectedReturnRows.value
			.filter(
				(row) =>
					row.kind === "Loan" &&
					Number(row.docstatus) === 1 &&
					Number(row.outstanding || row.loaned || 0) > 0,
			)
			.map((row) => String(row.document || ""))
			.filter(Boolean);
		if (loans.length) emit("settle", JSON.stringify({ loans: [...new Set(loans)] }));
	} else {
		const selectedGroups = mobileItemGroups.value
			.filter((group) => c.selected.value.includes(group.id))
			.map((group) => groupItem(group));
		const items = (selectedGroups.length ? selectedGroups : selectedReturnRows.value)
			.map((row) => String("code" in row ? row.code : row.item_code || ""))
			.filter(Boolean);
		if (items.length) emit("settle", JSON.stringify({ items: [...new Set(items)] }));
	}
}
const itemColumns = computed<DataColumn[]>(() =>
	operationItemColumnsFor(props.family, query.value.view, wideScreen.value),
);
const serialForcedColumns = computed(() =>
	!props.records && query.value.scope.tracking === "serial" ? ["serial_nos"] : [],
);
function historyRecord(row: Record<string, unknown>, item: OperationGroup): DataTableRecord {
	const quantity = Number(row.quantity ?? row.stock_qty ?? row.borrowed ?? 0);
	const uom = String(row.stock_uom || item.stock_uom || "");
	const source = String(row.source_warehouse || row.source || "");
	const destination = String(row.destination_warehouse || row.destination || "");
	const whole = row.whole as Record<string, unknown> | undefined;
	const branch = Array.isArray(whole?.branches)
		? (whole.branches[0] as Record<string, unknown> | undefined)
		: undefined;
	return {
		kind: "record",
		id: `history:${item.id}:${String(row.id || row.document || JSON.stringify(row))}`,
		value: {
			...row,
			date: row.date || String(row.date_time || "").split(" ")[0],
			history_record: true,
			item_code: item.item_code || row.item_code,
			item_name: item.item_name || row.item_name,
			image: item.image || row.image,
			whole: {
				...(whole || {}),
				quantities: [{ uom, qty: quantity }],
				available_effects: [{ uom, qty: Number(row.available_effect || 0) }],
				branches: [
					{
						source,
						destination,
						source_path: branch?.source_path || row.source_warehouse_path,
						source_native_name:
							branch?.source_native_name || row.source_warehouse_native_name,
						destination_path:
							branch?.destination_path || row.destination_warehouse_path,
						destination_native_name:
							branch?.destination_native_name ||
							row.destination_warehouse_native_name,
					},
				],
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
function operationLocationDetail(row: Record<string, any>, column: string) {
	const field = column;
	if (row[field]) return String(row[field]);
	const branches = row.whole?.branches || [];
	const branchField =
		column === "source_warehouse_path"
			? "source_path"
			: column === "source_warehouse_native_name"
				? "source_native_name"
				: column === "destination_warehouse_path"
					? "destination_path"
					: "destination_native_name";
	return [
		...new Set(
			branches.map((branch: Record<string, string>) => branch[branchField]).filter(Boolean),
		),
	].join("；");
}
function itemHistoryRows(item: OperationGroup): DataTableEntry[] {
	if (!c.expanded.has(item.id)) return [];
	const detail = details[item.id];
	return (detail?.rows || []).map((row) => historyRecord(row as Record<string, unknown>, item));
}
const itemTableRows = computed<DataTableEntry[]>(() => {
	if (!query.value.groupBy.length) return itemHistoryRows(flatHistoryItem.value);
	return c.groups.entries.value.flatMap((entry) => {
		if (entry.kind === "record") {
			// Leaves under a non-item group are movement lines; give each its own item
			// context so they render as history lines, not item summaries.
			const row = entry.value as Record<string, unknown>;
			const leafItem: OperationGroup = {
				id: `leaf:${entry.id}`,
				item_code: String(row.item_code || ""),
				item_name: String(row.item_name || ""),
				image: row.image ? String(row.image) : undefined,
				stock_uom: row.stock_uom ? String(row.stock_uom) : undefined,
				document_count: 0,
				item_count: 0,
			};
			return [historyRecord(row, leafItem)];
		}
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
const flatItemCardRows = computed(() =>
	itemTableRows.value.filter(
		(entry): entry is DataTableRecord => entry.kind === "record" && Boolean(entry.value),
	),
);
const flatHistoryItem = computed<OperationGroup>(() => ({
	id: "flat-history-scope",
	document_count: 0,
	item_count: 0,
}));
const groupRoot = computed(() => c.groups.pages.value["[[],null]"]);
const mobileItemGroups = computed(() => {
	const useExpandedGroups = query.value.groupBy.some((field) => field !== "item");
	const rows: DataTableGroup[] = useExpandedGroups
		? c.groups.entries.value.filter((entry): entry is DataTableGroup => entry.kind === "group")
		: (groupRoot.value?.rows || [])
				.filter((row) => row.row_grain === "group")
				.map((row) => ({
					kind: "group" as const,
					id: row.id,
					parentId: row.parent_group_id || undefined,
					label: String(row.group_label || "未分类"),
					depth: row.group_depth || 1,
					count: Number(row.display_count ?? row.row_count ?? 0),
					countLabel: "明细条数",
					expanded: false,
					hasChildren: Boolean(row.has_children),
					loading: false,
					error: "",
					value: row,
				}));
	return rows.map((entry) => {
		const row = entry.value || {};
		const field = String(row.group_field || query.value.groupBy[entry.depth - 1] || "");
		const rawLabel = String(row.group_label || entry.label || "未分类");
		const group: DataTableGroup = {
			...entry,
			label: ["kind", "status", "docstatus", "outcome", "outcome_key"].includes(field)
				? enumPresentationLabel(field, rawLabel, query.value)
				: rawLabel,
			count: Number(row.display_count ?? row.row_count ?? entry.count),
			countLabel: "明细条数",
			value: row,
		};
		const item = groupItem(group);
		return {
			...group,
			expanded: isItemGroup(group)
				? c.expanded.has(item.id)
				: useExpandedGroups && "expanded" in entry
					? entry.expanded
					: false,
			loading: isItemGroup(group) ? details[item.id]?.loading : entry.loading,
			error: isItemGroup(group) ? details[item.id]?.error : entry.error,
		};
	});
});
function hasOutstandingLoan(row: Record<string, unknown> | OperationGroup) {
	const value = row as Record<string, unknown>;
	if (Number(value.outstanding ?? value.loaned ?? 0) > 0) return true;
	const whole = value.whole as Record<string, unknown> | undefined;
	return (
		Array.isArray(whole?.outstanding) &&
		whole.outstanding.some(
			(value) =>
				value &&
				typeof value === "object" &&
				Number((value as Record<string, unknown>).qty || 0) > 0,
		)
	);
}
const selectedReturnItemRows = computed(() => [
	...selectedReturnRows.value,
	...mobileItemGroups.value
		.filter((group) => c.selected.value.includes(group.id))
		.map((group) => groupItem(group)),
]);
function toggleMobileItemGroup(group: DataTableGroup, open: boolean) {
	if (isItemGroup(group)) c.toggle(groupItem(group), open);
	else void c.groups.toggleGroup(group.id);
}
function openItemGroup(group: DataTableGroup) {
	if (!isItemGroup(group)) return;
	itemGroupOverlay.value = group;
	void c.loadDetails(groupItem(group));
}
const allMobileLoanItemsSelected = computed(
	() =>
		mobileItemGroups.value.length > 0 &&
		mobileItemGroups.value.every((group) => c.selected.value.includes(group.id)),
);
function selectMobileLoanItems(event: Event) {
	const checked = (event.target as HTMLInputElement).checked;
	mobileItemGroups.value.forEach((group) => c.setSelected(group.id, checked));
}
function toggleMobileLoanItem(group: DataTableGroup) {
	c.setSelected(group.id, !c.selected.value.includes(group.id));
}
function activateMobileLoanItem(event: MouseEvent, group: DataTableGroup) {
	if (props.family !== "loans" || !c.selecting.value) return;
	const target = event.target as Element | null;
	if (target?.closest("button, a[href], input, select, textarea, [contenteditable='true']"))
		return;
	toggleMobileLoanItem(group);
}
function keyMobileLoanItem(event: KeyboardEvent, group: DataTableGroup) {
	if (props.family !== "loans" || !c.selecting.value) return;
	const target = event.target as Element | null;
	if (
		target !== event.currentTarget &&
		target?.closest("button, a[href], input, select, textarea, [contenteditable='true']")
	)
		return;
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	toggleMobileLoanItem(group);
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
									source_path: String(
										(entry as Record<string, unknown>).source_path || "",
									),
									source_native_name: String(
										(entry as Record<string, unknown>).source_native_name ||
											"",
									),
									destination_path: String(
										(entry as Record<string, unknown>).destination_path || "",
									),
									destination_native_name: String(
										(entry as Record<string, unknown>)
											.destination_native_name || "",
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
				flow_quantities: quantities(whole.flow_quantities),
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
				original_loan_details: Array.isArray(whole.original_loan_details)
					? (whole.original_loan_details as Record<string, unknown>[]).map((detail) => ({
							name: String(detail.name || ""),
							borrower: String(detail.borrower || ""),
							date: String(detail.date || ""),
						}))
					: [],
				settlement_records: Array.isArray(whole.settlement_records)
					? (whole.settlement_records as Record<string, unknown>[]).map((record) => ({
							name: String(record.name || ""),
							kind: String(record.kind || ""),
						}))
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
		const borrowed = groupMetricRows(group, "borrowed");
		const outstanding = groupMetricRows(group, "outstanding");
		if (borrowed.length) parts.push(`借出 ${borrowed.join("；")}`);
		if (outstanding.length) parts.push(`未归还 ${outstanding.join("；")}`);
	} else if (groupMetricRows(group, "available_effect").length) {
		parts.push(`可用变化 ${groupMetricRows(group, "available_effect").join("；")}`);
	} else if (Array.isArray(row.quantity_breakdown)) {
		const breakdown = sortByUnit(
			row.quantity_breakdown as Record<string, unknown>[],
			(entry) => String(entry.stock_uom || ""),
		);
		for (const entry of breakdown) {
			const quantity = Number(entry.stock_qty || 0);
			if (!quantity) continue;
			const signedQuantity = `${quantity < 0 ? "−" : ""}${formatQuantity(Math.abs(quantity))}`;
			const parallel = (row.quantity_breakdown as Record<string, unknown>[]).some(
				(other) => other.kind === entry.kind && other.docstatus !== entry.docstatus,
			);
			const status = parallel
				? `（${entry.docstatus === 1 ? "已提交" : entry.docstatus === 2 ? "已取消" : "草稿"}）`
				: "";
			parts.push(
				`${movementLabels[String(entry.kind)] || "其他类型"}${status} ${signedQuantity} ${unitLabel(String(entry.stock_uom || ""))}`.trim(),
			);
		}
	} else if (row.stock_qty !== undefined && row.stock_qty !== null) {
		const quantity = Number(row.stock_qty);
		parts.push(
			`${quantity < 0 ? "−" : ""}${formatQuantity(Math.abs(quantity))} ${unitLabel(String(row.stock_uom || ""))}`.trim(),
		);
	}
	return parts.join(" · ");
}
function countedLocations(row: Record<string, unknown>) {
	return [
		...new Set(
			(operationRow(row).whole?.branches || [])
				.map((branch) => branch.source)
				.filter(Boolean),
		),
	];
}
function relatedLoanNames(row: Record<string, unknown>) {
	const operation = operationRow(row);
	const names = operation.whole?.original_loans || row.original_loans;
	if (Array.isArray(names) && names.length) return names.map(String);
	return row.original_loan ? [String(row.original_loan)] : [];
}
function relatedLoanDetails(row: Record<string, unknown>) {
	const operation = operationRow(row);
	const details = operation.whole?.original_loan_details || row.original_loan_details;
	if (Array.isArray(details))
		return details as { name?: string; borrower?: string; date?: string }[];
	if (row.original_loan)
		return [
			{
				name: String(row.original_loan),
				borrower: String(row.original_loan_borrower || ""),
				date: String(row.original_loan_date || ""),
			},
		];
	return [];
}
function relatedSettlementRecords(row: Record<string, unknown>) {
	const whole = operationRow(row).whole;
	return whole?.settlement_records || [];
}
function groupMetricEntries(group: DataTableGroup, column: string) {
	const row = group.value || {};
	const unitTotals = Array.isArray(row.unit_totals)
		? (row.unit_totals as Record<string, unknown>[])
		: [];
	const metricField =
		column === "available_effect"
			? "available_effect"
			: column === "quantities"
				? props.family === "loans"
					? "borrowed"
					: "flow_qty"
				: column;
	const raw =
		row[
			column === "available_effect"
				? "available_effects"
				: column === "quantities" && props.family === "movements"
					? "flow_quantities"
					: column
		];
	const values = unitTotals.length
		? unitTotals.map((entry) => ({
				...entry,
				uom: entry.stock_uom,
				qty: entry[metricField],
			}))
		: Array.isArray(raw)
			? (raw as Record<string, unknown>[])
			: raw === undefined || raw === null
				? []
				: [{ qty: raw, uom: row.stock_uom }];
	return sortByUnit(values, (entry) => String(entry.uom || entry.stock_uom || "")).map(
		(entry) => ({
			uom: String(entry.uom || entry.stock_uom || row.stock_uom || ""),
			qty: Number(entry.qty ?? entry.stock_qty ?? 0),
		}),
	);
}
function groupMetricRows(group: DataTableGroup, column: string) {
	return groupMetricEntries(group, column).map((entry) => {
		const sign =
			column === "available_effect"
				? entry.qty > 0
					? "+"
					: entry.qty < 0
						? "−"
						: ""
				: entry.qty < 0
					? "−"
					: "";
		return `${sign}${formatQuantity(Math.abs(entry.qty))} ${unitLabel(entry.uom)}`.trim();
	});
}
// Totals shown beside a group: a column that is already visible is not repeated.
function groupTotalsMetrics(
	group: DataTableGroup,
	visibleColumns: string[] = [],
): GroupTotalMetric[] {
	const metrics: GroupTotalMetric[] =
		props.family === "loans"
			? [
					{
						key: "borrowed",
						label: "借出",
						entries:
							visibleColumns.includes("borrowed") ||
							visibleColumns.includes("quantities")
								? []
								: groupMetricEntries(group, "borrowed"),
					},
					{
						key: "outstanding",
						label: "未归还",
						entries: visibleColumns.includes("outstanding")
							? []
							: groupMetricEntries(group, "outstanding"),
					},
				]
			: [
					{
						key: "available_effect",
						label: "可用变化",
						signed: true,
						entries: visibleColumns.includes("available_effect")
							? []
							: groupMetricEntries(group, "available_effect"),
					},
				];
	return metrics.filter((metric) => metric.entries.length);
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
	? useColumnPreferences(
			`operations.${props.family}.items`,
			itemColumns,
			reference,
			services,
			serialForcedColumns,
		)
	: undefined;
const recordViewOptions = computed<BrowseView[]>(() =>
	query.value.groupBy.length ? ["table"] : [...c.browseViewOptions.value],
);
const itemViewOptions = computed<BrowseView[]>(() => [...c.browseViewOptions.value]);
// 列表 record rows exist only on phones without grouping; grouped records are tables.
const recordListLayout = computed(
	() =>
		props.records &&
		isMobile.value &&
		!query.value.groupBy.length &&
		browseView.value === "list",
);
// Item 列表 (phone rows or group list) and 卡片 share the item column settings.
const itemCardLayout = computed(
	() => !props.records && canShowItemCards.value && browseView.value !== "table",
);
const visibleItemColumns = computed(() =>
	orderedVisibleColumns(itemColumns.value, itemPreferences),
);
const itemHeroId = computed(() => (props.family === "loans" ? "borrowed" : "available_effect"));
const itemHeroVisible = computed(() =>
	visibleItemColumns.value.some((column) => String(column.id) === itemHeroId.value),
);
const itemRoles = computed(() => ({
	media: "image",
	title: "item_name",
	status: "kind",
	omit: itemHeroVisible.value ? ["stock_uom"] : [],
}));
const itemCardPartition = computed(() =>
	partitionCardColumns(
		visibleItemColumns.value,
		{ ...itemRoles.value, eyebrow: ["category", "item_code"], hero: itemHeroId.value },
		CARD_FIELD_LIMIT,
	),
);
const itemRowPartition = computed(() =>
	partitionCardColumns(
		visibleItemColumns.value,
		{ ...itemRoles.value, hero: itemHeroId.value },
		ROW_FIELD_LIMIT,
	),
);
const recordRowPartition = computed(() =>
	partitionCardColumns(
		orderedVisibleColumns(operationColumns.value, operationPreferences),
		{ title: "document", status: props.family === "loans" ? "status" : "docstatus" },
		ROW_FIELD_LIMIT,
	),
);
const itemCardMedia = computed(() => itemCardPartition.value.media !== undefined);
const itemCardHasCode = computed(() =>
	itemCardPartition.value.eyebrow.some((column) => column.id === "item_code"),
);
const itemCardHasCategory = computed(() =>
	itemCardPartition.value.eyebrow.some((column) => column.id === "category"),
);
// Item cards and 列表 rows share one empty message, and the table keeps its own; the status mirrors
// the DataTable's props so both report the same empty state.
const itemLayoutEmpty = computed(() => {
	if (query.value.groupBy.length) {
		const root = groupRoot.value;
		return (
			Boolean(root?.initialized) &&
			!root?.loading &&
			!root?.error &&
			mobileItemGroups.value.length === 0
		);
	}
	const flat = details[flatHistoryItem.value.id];
	return (
		result.initialized &&
		Boolean(flat?.initialized) &&
		!result.loading &&
		!result.error &&
		!flat?.loading &&
		!flat?.error &&
		flatItemCardRows.value.length === 0
	);
});
function itemName(row: Record<string, unknown>) {
	return String(row.item_name || row.item_code || "");
}
function itemStatusText(row: Record<string, unknown>) {
	if (!itemCardPartition.value.status) return undefined;
	return enumPresentationLabel("kind", String(row.kind || ""), query.value);
}
// The hero is the primary change column: signed for movements, and for loans when the row is signed.
function heroText(row: Record<string, unknown>) {
	const value =
		props.family === "loans"
			? (row.quantity ?? row.stock_qty ?? row.borrowed)
			: row.available_effect;
	if (value === null || value === undefined || value === "") return undefined;
	const amount = Number(value);
	if (Number.isNaN(amount)) return undefined;
	const sign =
		props.family === "movements" || row.signed
			? amount > 0
				? "+"
				: amount < 0
					? "−"
					: ""
			: "";
	return `${sign}${formatQuantity(Math.abs(amount))}`;
}
const cellHelpers: OperationCellHelpers = {
	operationRow,
	operationLocationDetail,
	openHistoryDocument,
	openedRecord,
	openedSettlement,
	recordEffect,
	recordEffectTone,
	recordEffectLabel,
	recordUnitRows,
	itemTotals,
	effectLabel,
	countedLocations,
	relatedLoanNames,
	relatedLoanDetails,
	relatedSettlementRecords,
};
function visibleExportColumns(columns: DataColumn[], order: string[], visible: string[]) {
	return visible.length
		? visible
		: columns
				.filter((column) => column.defaultVisible !== false || column.required)
				.map((column) => String(column.id));
}
const operationExportOrder = computed(() =>
	operationPreferences?.order.value.length
		? operationPreferences.order.value
		: operationColumns.value.map((column) => String(column.id)),
);
const operationExportVisible = computed(() =>
	visibleExportColumns(
		operationColumns.value,
		operationExportOrder.value,
		operationPreferences?.visible.value || [],
	),
);
const itemExportOrder = computed(() =>
	itemPreferences?.order.value.length
		? itemPreferences.order.value
		: itemColumns.value.map((column) => String(column.id)),
);
const itemExportVisible = computed(() =>
	visibleExportColumns(
		itemColumns.value,
		itemExportOrder.value,
		itemPreferences?.effectiveVisible.value || itemPreferences?.visible.value || [],
	),
);
const operationExportColumns = computed(() =>
	exportFields(operationColumns.value, operationExportOrder.value, operationExportVisible.value),
);
const itemExportColumns = computed(() =>
	exportFields(itemColumns.value, itemExportOrder.value, itemExportVisible.value),
);
const exportTable = computed(() =>
	props.records ? "records" : props.family === "movements" ? "history" : "loan_history",
);
const exportTitle = computed(
	() =>
		`${props.family === "movements" ? "货物流动" : "借用"} · ${props.records ? "单据" : "明细"}`,
);
const exportColumns = computed(() =>
	props.records ? operationExportColumns.value : itemExportColumns.value,
);
const exportSortBy = computed(() =>
	!props.records && !query.value.groupBy.length
		? c.detailSortBy(flatHistoryItem.value)
		: undefined,
);
const exportSort = computed(() =>
	!props.records && !query.value.groupBy.length
		? c.detailSortDirection(flatHistoryItem.value)
		: undefined,
);
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
const filterSheetOpen = ref(false);
const analysisOpen = ref(false);
const itemGroupOverlay = ref<DataTableGroup>();
const scan = ref<InstanceType<typeof ScanPanel>>();
watch([() => props.active, isMobile], () => {
	scan.value?.finishScanning();
	analysisOpen.value = false;
	c.relatedLoans.close();
});
function acceptBrowseScan(
	code: string,
	batch?: string,
	_context?: unknown,
	serial?: string,
	serialLocation?: { name: string; label: string; is_group: boolean },
) {
	if (!serial) {
		search.value = batch || code;
		scan.value?.finishScanning();
		return;
	}
	scope.value = {
		...scope.value,
		item: code,
		tracking: "serial",
		warehouses: serialLocation ? [serialLocation.name] : [],
		sources: [],
		destinations: [],
	};
	search.value = serial;
	scan.value?.finishScanning();
}
function acceptBrowseLocation(name: string) {
	scope.value.warehouses = [name];
	scan.value?.finishScanning();
}
const dimensions: Record<string, string> = {
	category: "类别 / 单位",
	location: "来源位置 / 单位",
	activity: "活动",
	borrower: "借用方",
	month: "月份",
};
const scopeChips = computed(() => scopeFilterFieldChips(scope.value, reference));
// Activity filters usually arrive by link, before anyone opens the activity
// picker, so resolve the title the chip shows instead of the immutable ID.
watch(
	() => scope.value.activity,
	async (id) => {
		if (!id || !services || reference.activities.some((row) => row.value === id)) return;
		try {
			const result = await services.call<{ name: string; title: string }>(
				"activities.load_activity",
				{
					name: id,
				},
			);
			if (result.name === id && result.title)
				reference.activities.push({ value: id, label: result.title });
		} catch {
			// The chip keeps showing the ID when the activity cannot be read.
		}
	},
	{ immediate: true },
);
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
			kind: (/expiry/i.test(field)
				? "expiry"
				: /date|month/i.test(field)
					? "date"
					: /qty|quantity|borrowed|outstanding|count/i.test(field)
						? "number"
						: "text") as "expiry" | "date" | "number" | "text",
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
const browseResultLabel = computed(() => {
	if (props.records) return `${result.total} 笔记录`;
	if (query.value.groupBy.length) return `${result.total} 种物品`;
	const detailTotal = details["flat-history-scope"]?.initialized
		? String(details["flat-history-scope"].total)
		: "…";
	return `${detailTotal} 条明细 · ${result.total} 种物品`;
});
function quantities(rows?: { uom: string; qty: number }[]) {
	return sortByUnit(rows || [], (row) => row.uom)
		.map(
			(row) =>
				`${row.qty < 0 ? "−" : ""}${formatQuantityWithUnit(Math.abs(row.qty), row.uom)}`,
		)
		.join(" | ");
}
function recordUnitRows(
	row: Record<string, unknown>,
	key: "flow_quantities" | "available_effects" | "outstanding",
) {
	const values = operationRow(row).whole?.[key] || [];
	return sortByUnit(values, (entry) => entry.uom).map((entry) => ({
		uom: entry.uom,
		qty: Number(entry.qty),
		tone:
			key === "available_effects"
				? recordEffectTone(operationRow(row), entry.uom)
				: undefined,
		title:
			key === "available_effects"
				? recordEffectLabel(operationRow(row), entry.uom)
				: undefined,
	}));
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
	return stockEffectLabel(effect, uom);
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
function recordUnitSummary(row: OperationGroup) {
	const values =
		props.family === "loans"
			? row.whole?.outstanding || row.whole?.quantities || []
			: row.whole?.available_effects || row.whole?.quantities || [];
	return values
		.slice(0, 2)
		.map((value) => formatQuantityWithUnit(Number(value.qty), value.uom))
		.join(" · ");
}
// 更多 opens every field of one row in a sheet; 打开 runs the same handler as the row's own tap.
const detailsRow = ref<{
	kind: "item" | "record";
	title: string;
	columns: DataColumn[];
	row: Record<string, unknown>;
	open: () => void;
}>();
function showItemDetails(entry: DataTableRecord, columns: DataColumn[]) {
	detailsRow.value = {
		kind: "item",
		title: itemName(entry.value || {}) || entry.id,
		columns,
		row: entry.value || {},
		open: () => emit("openItem", String(entry.value?.item_code || entry.id)),
	};
}
function showRecordDetails(row: OperationGroup) {
	detailsRow.value = {
		kind: "record",
		title: row.document || row.id,
		columns: recordRowPartition.value.all,
		row: row as unknown as Record<string, unknown>,
		open: () => openedRecord(row),
	};
}
function openDetailsRow() {
	detailsRow.value?.open();
	detailsRow.value = undefined;
}
function openedSettlement(name: string) {
	if (!result.stale) emit("openDocument", "Stock Entry", name);
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
		<ReturnToTop :active="active" :hidden="isMobile && filterSheetOpen" />
		<div class="activity-browse">
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
				@scan="scan?.show()"
				@filter-open="filterSheetOpen = $event"
			>
				<template #actions>
					<QuickExport
						ref="exportMenu"
						:show-trigger="false"
						:query="query"
						:title="exportTitle"
						:table="exportTable"
						:columns="exportColumns"
						:sort-by="exportSortBy"
						:sort="exportSort"
						:active="active"
					/>
					<BrowseOverflowMenu>
						<UiButton
							v-if="isMobile && family === 'loans'"
							icon="select"
							:aria-pressed="c.selecting.value"
							@click="c.selecting.value ? c.exitSelection() : c.enterSelection()"
							>{{ c.selecting.value ? "取消选择" : "选择" }}</UiButton
						>
						<UiButton icon="export" @click="exportMenu?.open()">导出</UiButton>
						<RouterLink
							v-if="family === 'movements'"
							class="drafts-entry-link"
							:to="routeTarget('drafts')"
						>
							<InventoryIcon class="menu-item-icon" name="document" />
							<span>草稿</span><span class="menu-item-meta">{{ draftCount }}</span>
						</RouterLink>
					</BrowseOverflowMenu>
					<UiButton
						v-if="!isMobile && family === 'loans'"
						icon="select"
						:aria-pressed="c.selecting.value"
						@click="c.selecting.value ? c.exitSelection() : c.enterSelection()"
						>{{ c.selecting.value ? "取消选择" : "选择" }}</UiButton
					>
					<BrowseSplitButton
						v-if="family === 'movements' && reference.operations.Receive"
						label="入库"
						kind="Receive"
						:icon="kindIcons.Receive.icon"
						:options="createOptions"
						@select="emit('newOperation', $event)"
					/>
					<BrowseSplitButton
						v-else-if="family === 'loans' && reference.operations.Loan"
						label="登记借出"
						kind="Loan"
						:icon="kindIcons.Loan.icon"
						:options="createOptions"
						@select="emit('newOperation', $event)"
					/>
				</template>
				<template #selection>
					<div
						v-if="family === 'loans' && c.selecting.value"
						class="selection-bar stock-selection-actions"
						role="region"
						aria-label="借用批量操作"
					>
						<label v-if="showMobileItemCards" class="browse-select-visible">
							<input
								type="checkbox"
								:checked="allMobileLoanItemsSelected"
								@change="selectMobileLoanItems"
							/>
							选择当前 {{ mobileItemGroups.length }} 项
						</label>
						<span role="status">已选择 {{ c.selected.value.length }} 项</span>
						<UiButton
							:disabled="
								!reference.operations.Return || !canReturnSelected || result.stale
							"
							:title="
								!reference.operations.Return
									? '当前账户不可执行归还'
									: selectedReturnReason
							"
							@click="beginSelectedReturn"
							>登记归还</UiButton
						>
						<UiButton variant="ghost" @click="c.exitSelection()">取消</UiButton>
					</div>
				</template>
				<template #persistent
					><nav
						class="browse-view-switch"
						:aria-label="family === 'movements' ? '货物流动视图' : '借用视图'"
					>
						<button
							:aria-current="!records ? 'page' : undefined"
							@click="switchView(false)"
						>
							<InventoryIcon name="box" />明细</button
						><button
							:aria-current="records ? 'page' : undefined"
							@click="switchView(true)"
						>
							<InventoryIcon name="document" />单据
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
						:label="
							chip.field === 'period' && family === 'loans'
								? chip.label.replace('日期：', '借出日期：')
								: chip.label
						"
						:icon="chip.icon"
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
					<UiButton v-if="!atDefaults" variant="ghost" @click="c.reset"
						>恢复默认</UiButton
					>
				</template>
				<p v-if="routeError" role="alert">{{ routeError }}</p>
			</BrowseToolbar>
			<section
				v-if="result.initialized"
				class="activity-summary"
				aria-label="当前筛选汇总"
				aria-live="polite"
			>
				<BrowseResultSummary
					:label="browseResultLabel"
					:metrics="metrics"
					:loading="result.loading && !result.initialized"
				>
					<template #controls>
						<ViewModeToggle
							v-if="records"
							v-model="browseView"
							:ariaLabel="
								family === 'movements' ? '货物流动记录视图' : '借用记录视图'
							"
							:options="recordViewOptions"
						/>
						<ColumnSettings
							v-if="operationPreferences && recordListLayout"
							:preferences="operationPreferences"
							:columns="operationColumns"
						/>
						<ViewModeToggle
							v-if="canShowItemCards"
							v-model="browseView"
							ariaLabel="物品汇总视图"
							:options="itemViewOptions"
						/>
						<ColumnSettings
							v-if="itemPreferences && itemCardLayout"
							:preferences="itemPreferences"
							:columns="itemColumns"
						/>
						<SortControl
							v-if="showMobileItemCards && browseView !== 'table'"
							v-model:field="query.sortBy"
							v-model:direction="query.sort"
							:fields="sortFields"
							:label="family === 'loans' ? '借用排序' : '流动排序'"
						/>
						<UiButton
							v-if="!records"
							icon="report"
							:icon-only="isMobile"
							label="分析结果"
							@click="analysisOpen = true"
							>分析结果</UiButton
						>
						<UiButton
							v-if="family === 'loans'"
							variant="ghost"
							@click="emit('browse', c.loanHistory())"
							>借还流动</UiButton
						>
					</template>
				</BrowseResultSummary>
			</section>
			<SkeletonBlock
				v-if="!itemTableMounted && result.loading && !result.initialized"
				variant="lines"
				:count="5"
			/>
			<BrowseRefreshNotice :show="result.refreshFailed" :retry="() => c.load()" />
			<p
				v-if="!records && result.error && !result.refreshFailed"
				class="notice-bar danger"
				role="alert"
			>
				{{ result.error }} <UiButton @click="c.retry">重试加载</UiButton>
			</p>
			<div class="browse-body">
				<aside
					v-if="filtersOpen && !isMobile"
					class="browse-filter-rail browse-filter-rail"
				>
					<div class="filter-rail-heading">
						<h3>筛选{{ family === "movements" ? "货物流动" : "借用" }}</h3>
						<FilterRailEdge
							:open="true"
							:active="scope.categories.length + scope.warehouses.length > 0"
							@toggle="toggleFilters"
						/>
					</div>
					<BrowseFilters
						v-model="scope"
						:fields="['categories', 'warehouses']"
						:records="records"
					/>
				</aside>
				<FilterRailEdge
					v-if="!filtersOpen && !isMobile"
					:open="false"
					:active="scope.categories.length + scope.warehouses.length > 0"
					@toggle="toggleFilters"
				/>
				<div class="browse-results">
					<Overlay
						v-if="analysisOpen && !records"
						title="分析当前结果"
						adaptive-creation
						@close="analysisOpen = false"
					>
						<label class="form-field"
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
					<div
						v-if="showMobileItemCards && browseView === 'list'"
						class="mobile-item-group-list browse-card"
					>
						<article
							v-for="group in mobileItemGroups"
							:key="group.id"
							class="browse-group browse-group--mobile-list browse-card"
							:data-browse-row="group.id"
							:class="{ selected: c.selected.value.includes(group.id) }"
							:tabindex="family === 'loans' && c.selecting.value ? 0 : -1"
							:role="
								family === 'loans' && c.selecting.value ? 'checkbox' : undefined
							"
							:aria-checked="
								family === 'loans' && c.selecting.value
									? c.selected.value.includes(group.id)
									: undefined
							"
							@click="activateMobileLoanItem($event, group)"
							@keydown="keyMobileLoanItem($event, group)"
						>
							<label
								v-if="family === 'loans' && c.selecting.value"
								class="stock-list-checkbox"
								@click.stop
							>
								<input
									type="checkbox"
									:checked="c.selected.value.includes(group.id)"
									:aria-label="`选择物品 ${group.label}`"
									@change="
										c.setSelected(
											group.id,
											($event.target as HTMLInputElement).checked,
										)
									"
								/>
							</label>
							<div class="browse-group-heading mobile-operation-group-heading">
								<div
									v-if="isItemGroup(group) && c.stockItem(groupItem(group))"
									class="browse-group-thumbnail"
								>
									<ItemImage :item="c.stockItem(groupItem(group))!" />
								</div>
								<button
									type="button"
									class="browse-group-trigger"
									:aria-expanded="group.expanded"
									:aria-controls="`mobile-operation-group-${group.id}`"
									@click.stop="
										family === 'loans' && c.selecting.value
											? toggleMobileLoanItem(group)
											: toggleMobileItemGroup(group, !group.expanded)
									"
								>
									<DisclosureIcon variant="inline" />
									<span class="mobile-operation-group-identity">
										<strong :title="group.label">{{ group.label }}</strong>
										<small :title="`明细条数 ${group.count}`">
											{{ group.count }} 条
										</small>
									</span>
								</button>
								<GroupTotals
									class="mobile-operation-group-totals"
									:metrics="groupTotalsMetrics(group)"
								/>
							</div>
							<div
								v-show="
									browseView === 'list' &&
									group.expanded &&
									!(family === 'loans' && c.selecting.value)
								"
								:id="`mobile-operation-group-${group.id}`"
								class="browse-group-content"
							>
								<template v-if="!isItemGroup(group)">
									<UiButton v-if="group.error" @click="c.groups.retry(group.id)"
										>重试</UiButton
									>
									<UiButton
										v-if="c.groups.hasMore(group.id)"
										:loading="group.loading"
										@click="c.groups.loadMore(group.id)"
										>加载更多此分组 ·
										{{ c.groups.progress(group.id).loaded }} /
										{{ c.groups.progress(group.id).total }}</UiButton
									>
								</template>
								<RouterLink
									v-if="isItemGroup(group)"
									class="browse-row-link mobile-operation-item-link"
									:to="
										routeTarget('item-detail', {
											code: String(group.value?.item_code || group.label),
										})
									"
									>查看物品</RouterLink
								>
								<ItemGroupLines
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
								/>
								<p
									v-if="
										family === 'loans' &&
										query.outstandingOnly &&
										details[groupItem(group).id]?.initialized &&
										!details[groupItem(group).id]?.rows.length
									"
									class="field-hint"
								>
									当前范围没有未结清借用记录。可在筛选中切换到“借出与归还全部记录”查看历史。
								</p>
								<ItemGroupLines
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
									:history-complete="
										details[groupItem(group).id]!.historyComplete
									"
									:sort-by="c.detailSortBy(groupItem(group))"
									:sort-direction="c.detailSortDirection(groupItem(group))"
									loan-balance
									@load-more="c.loadDetails(groupItem(group), true)"
									@retry="c.retryDetails(groupItem(group))"
									@sort="c.setDetailSort(groupItem(group), $event)"
									@open-document="
										(doctype, name) => emit('openDocument', doctype, name)
									"
									@open-loan="emit('openLoan', $event)"
								/>
							</div>
						</article>
					</div>
					<p
						v-if="
							family === 'loans' &&
							!records &&
							!query.groupBy.length &&
							c.expanded.has(flatHistoryItem.id) &&
							query.outstandingOnly &&
							details[flatHistoryItem.id]?.initialized &&
							!details[flatHistoryItem.id]?.rows?.length
						"
						class="field-hint"
					>
						当前范围没有未结清借用记录。可在筛选中切换到“借出与归还全部记录”查看历史。
					</p>
					<div
						v-if="canShowItemCards && browseView === 'card'"
						class="browse-card-grid operation-item-card-grid"
					>
						<ItemCard
							v-for="group in mobileItemGroups"
							:key="group.id"
							:row-key="group.id"
							:selecting="family === 'loans' && c.selecting.value"
							:selected="c.selected.value.includes(group.id)"
							:select-label="`选择物品 ${group.label}`"
							:stale="result.stale"
							:name="group.label"
							:media="itemCardMedia"
							:code="
								itemCardHasCode ? String(group.value?.item_code || '') : undefined
							"
							:category="
								itemCardHasCategory
									? String(group.value?.category || '')
									: undefined
							"
							:image="c.stockItem(groupItem(group)) || undefined"
							:status="
								family === 'loans'
									? group.value?.outcome_key === 'outstanding'
										? '未归还'
										: '借出'
									: ''
							"
							@toggle="toggleMobileLoanItem(group)"
							@open="openItemGroup(group)"
						>
							<template #default>
								<span>{{ group.count }} 条明细</span>
								<GroupTotals :metrics="groupTotalsMetrics(group)" />
							</template>
						</ItemCard>
					</div>
					<div
						v-if="
							!records && isMobile && !query.groupBy.length && browseView === 'list'
						"
						class="stock-list surface operation-item-list"
					>
						<BrowseCard
							v-for="entry in flatItemCardRows"
							:key="entry.id"
							:row-key="entry.id"
							variant="row"
							:class="[
								'stock-list-row',
								{ 'is-text-only': !itemRowPartition.media },
							]"
							:selecting="family === 'loans' && c.selecting.value"
							:selected="c.selected.value.includes(entry.id)"
							:select-label="`选择物品 ${itemName(entry.value || {}) || entry.id}`"
							:stale="result.stale"
							@toggle="c.setSelected(entry.id, !c.selected.value.includes(entry.id))"
							@open="emit('openItem', String(entry.value?.item_code || entry.id))"
						>
							<template v-if="itemRowPartition.media" #media>
								<div class="stock-list-image">
									<ItemImage
										:item="{
											code: String(entry.value?.item_code || ''),
											name: String(entry.value?.item_name || ''),
											image: String(entry.value?.image || ''),
										}"
										:thumbnail-size="64"
									/>
								</div>
							</template>
							<template #default="{ activate }">
								<button
									class="stock-list-open"
									:disabled="result.stale"
									@click="activate"
								>
									<span class="stock-list-identity">
										<strong class="stock-list-name" data-clamp>{{
											itemName(entry.value || {})
										}}</strong>
										<span
											v-if="itemRowPartition.status"
											class="browse-badge"
											>{{ itemStatusText(entry.value || {}) }}</span
										>
									</span>
									<span v-if="itemRowPartition.hero" class="stock-list-quantity">
										<strong
											><OperationItemCell
												:column="itemRowPartition.hero"
												:row="entry.value || {}"
												:controller="c"
												:family="family"
												:helpers="cellHelpers"
										/></strong>
									</span>
								</button>
								<CardFields
									variant="row"
									:fields="itemRowPartition.fields"
									:row="entry.value || {}"
									:overflow="itemRowPartition.overflow"
									@more="showItemDetails(entry, itemRowPartition.all)"
								>
									<template #cell="{ column, row }">
										<OperationItemCell
											:column="column"
											:row="row"
											:controller="c"
											:family="family"
											:helpers="cellHelpers"
										/>
									</template>
								</CardFields>
							</template>
						</BrowseCard>
					</div>
					<div
						v-if="canShowItemCards && !query.groupBy.length && browseView === 'card'"
						class="browse-card-grid operation-item-card-grid"
					>
						<ItemCard
							v-for="entry in flatItemCardRows"
							:key="entry.id"
							:row-key="entry.id"
							:media="itemCardMedia"
							:name="itemName(entry.value || {})"
							:code="
								itemCardHasCode ? String(entry.value?.item_code || '') : undefined
							"
							:category="
								itemCardHasCategory
									? String(entry.value?.category || '')
									: undefined
							"
							:image="{
								code: String(entry.value?.item_code || ''),
								name: String(entry.value?.item_name || ''),
								image: String(entry.value?.image || ''),
							}"
							:quantity="
								itemCardPartition.hero ? heroText(entry.value || {}) : undefined
							"
							:unit="entry.value?.stock_uom"
							:status="itemStatusText(entry.value || {})"
							:selecting="family === 'loans' && c.selecting.value"
							:selected="c.selected.value.includes(entry.id)"
							:select-label="`选择物品 ${itemName(entry.value || {}) || entry.id}`"
							:stale="result.stale"
							@toggle="c.setSelected(entry.id, !c.selected.value.includes(entry.id))"
							@open="emit('openItem', String(entry.value?.item_code || entry.id))"
						>
							<CardFields
								:fields="itemCardPartition.fields"
								:row="entry.value || {}"
								:overflow="itemCardPartition.overflow"
								@more="showItemDetails(entry, itemCardPartition.all)"
							>
								<template #cell="{ column, row }">
									<OperationItemCell
										:column="column"
										:row="row"
										:controller="c"
										:family="family"
										:helpers="cellHelpers"
									/>
								</template>
							</CardFields>
						</ItemCard>
					</div>
					<BrowseEmpty v-if="itemCardLayout && itemLayoutEmpty" text="没有匹配的物品" />
					<BrowseLoadMore
						v-if="recordListLayout"
						:has-more="result.next !== null"
						:loaded-count="result.rows.length"
						:total-count="result.total"
						:loading="result.loading"
						:error="result.error && result.next !== null ? result.error : ''"
						@load-more="c.load(true)"
						@retry="c.retry()"
					/>
					<BrowseLoadMore
						v-if="!records && itemCardLayout"
						:has-more="
							query.groupBy.length
								? c.groups.hasMore()
								: details[flatHistoryItem.id]?.next != null
						"
						:loaded-count="
							query.groupBy.length
								? c.groups.progress().loaded
								: details[flatHistoryItem.id]?.rows?.length || 0
						"
						:total-count="
							query.groupBy.length
								? c.groups.progress().total
								: details[flatHistoryItem.id]?.total || 0
						"
						:loading="
							query.groupBy.length
								? Boolean(groupRoot?.loading)
								: Boolean(details[flatHistoryItem.id]?.loading)
						"
						:error="
							query.groupBy.length
								? groupRoot?.error || ''
								: details[flatHistoryItem.id]?.error || ''
						"
						@load-more="
							query.groupBy.length
								? c.groups.loadMore()
								: c.loadDetails(flatHistoryItem, true)
						"
						@retry="
							query.groupBy.length
								? c.groups.retry()
								: c.retryDetails(flatHistoryItem)
						"
					/>
					<DataTable
						v-if="itemTableMounted"
						data-browse-scroll="operation-items"
						ariaLabel="物品流动汇总"
						table-class="browse-table"
						:columns="itemColumns"
						:rows="itemTableRows"
						:suppressed-columns="groupImpliedColumns(query.groupBy)"
						:selection-enabled="family === 'loans' && c.selecting.value"
						:selected-keys="c.selected.value"
						@select="c.setSelected"
						@select-visible="
							(keys, checked) => keys.forEach((key) => c.setSelected(key, checked))
						"
						:group-summary-columns="
							() =>
								family === 'loans'
									? ['borrowed', 'quantities', 'outstanding']
									: ['available_effect']
						"
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
									: details[flatHistoryItem.id]?.rows?.length &&
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
								: details[flatHistoryItem.id]?.rows?.length || 0
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
									details[flatHistoryItem.id]?.rows?.length > 0
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
						:empty-action="atDefaults ? '' : '恢复默认'"
						@empty-action="c.reset"
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
							<OperationItemCell
								:column="column"
								:row="row"
								:controller="c"
								:family="family"
								:helpers="cellHelpers"
							/>
						</template>
						<template #group-label="{ group }">
							<span class="data-table-group-visual">
								<ItemImage
									v-if="isItemGroup(group) && c.stockItem(groupItem(group))"
									:item="c.stockItem(groupItem(group))!"
								/>
							</span>
						</template>
						<template #group-metrics="{ group, visibleColumns }">
							<GroupTotals
								v-if="isItemGroup(group)"
								class="operation-group-metrics-leading"
								:metrics="groupTotalsMetrics(group, visibleColumns)"
							/>
						</template>
						<template #group-column="{ group, column }">
							<span
								v-if="
									family === 'loans' &&
									['borrowed', 'quantities', 'outstanding'].includes(
										String(column.id),
									)
								"
								>{{ column.id === "outstanding" ? "未归还 " : "借出 " }}</span
							>
							<UnitValues
								v-if="
									(family === 'loans' &&
										['borrowed', 'quantities', 'outstanding'].includes(
											String(column.id),
										)) ||
									(family === 'movements' &&
										['available_effect', 'quantities'].includes(
											String(column.id),
										))
								"
								:entries="groupMetricEntries(group, String(column.id))"
								:label="
									column.id === 'outstanding'
										? '未归还数量'
										: family === 'movements'
											? column.id === 'quantities'
												? '流动数量'
												: '可用变化'
											: '借出数量'
								"
								:title="groupSummary(group)"
								:signed="
									family === 'movements' && column.id === 'available_effect'
								"
								class="operation-group-metrics"
							/>
						</template>
						<template #group="{ group }">
							<div
								v-if="isItemGroup(group) && group.expanded"
								class="browse-group-details"
							>
								<p
									v-if="
										family === 'loans' &&
										query.outstandingOnly &&
										details[groupItem(group).id]?.initialized &&
										!details[groupItem(group).id]?.rows.length
									"
									class="field-hint"
								>
									当前范围没有未结清借用记录。可在筛选中切换到“借出与归还全部记录”查看历史。
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
					<div v-if="recordListLayout" class="browse-card-grid operation-record-list">
						<BrowseCard
							v-for="row in result.rows"
							:key="row.id"
							:row-key="row.id"
							variant="row"
							:selecting="family === 'loans' && c.selecting.value"
							:selected="c.selected.value.includes(row.id)"
							:select-label="`选择记录 ${row.document || row.id}`"
							:stale="result.stale"
							@toggle="c.setSelected(row.id, !c.selected.value.includes(row.id))"
							@open="openedRecord(row)"
						>
							<div class="operation-record-row-content">
								<strong data-clamp>{{ row.document || row.id }}</strong
								><NativeStatusBadge
									v-if="recordRowPartition.status"
									:status="row.docstatus"
								/>
								<CardFields
									variant="row"
									:fields="recordRowPartition.fields"
									:row="row"
									:overflow="recordRowPartition.overflow"
									@more="showRecordDetails(row)"
								>
									<template #cell="{ column, row: cellRow }">
										<OperationRecordCell
											:column="column"
											:row="cellRow"
											:controller="c"
											:family="family"
											:helpers="cellHelpers"
										/>
									</template>
								</CardFields>
							</div>
						</BrowseCard>
						<BrowseEmpty
							v-if="
								result.initialized &&
								!result.loading &&
								!result.error &&
								!result.rows.length
							"
							text="没有匹配的记录"
						/>
					</div>
					<RowFieldsSheet
						v-if="detailsRow"
						:title="detailsRow.title"
						:columns="detailsRow.columns"
						:row="detailsRow.row"
						@close="detailsRow = undefined"
						@open="openDetailsRow"
					>
						<template #cell="{ column, row }">
							<OperationItemCell
								v-if="detailsRow?.kind === 'item'"
								:column="column"
								:row="row"
								:controller="c"
								:family="family"
								:helpers="cellHelpers"
							/>
							<OperationRecordCell
								v-else
								:column="column"
								:row="row"
								:controller="c"
								:family="family"
								:helpers="cellHelpers"
							/>
						</template>
					</RowFieldsSheet>
					<Overlay
						v-if="itemGroupOverlay"
						:title="`${itemGroupOverlay.label} · 明细`"
						adaptive-creation
						@close="itemGroupOverlay = undefined"
					>
						<RouterLink
							class="browse-row-link mobile-operation-item-link"
							:to="
								routeTarget('item-detail', {
									code: String(
										itemGroupOverlay.value?.item_code ||
											itemGroupOverlay.label,
									),
								})
							"
							>查看物品</RouterLink
						>
						<ItemGroupLines
							v-if="details[groupItem(itemGroupOverlay).id]"
							:rows="details[groupItem(itemGroupOverlay).id]!.rows as HistoryRow[]"
							:total="details[groupItem(itemGroupOverlay).id]!.total"
							:next="details[groupItem(itemGroupOverlay).id]!.next"
							:loading="details[groupItem(itemGroupOverlay).id]!.loading"
							:error="details[groupItem(itemGroupOverlay).id]!.error"
							:initialized="details[groupItem(itemGroupOverlay).id]!.initialized"
							:stale="result.stale"
							:history-complete="
								details[groupItem(itemGroupOverlay).id]!.historyComplete
							"
							:sort-by="c.detailSortBy(groupItem(itemGroupOverlay))"
							:sort-direction="c.detailSortDirection(groupItem(itemGroupOverlay))"
							:loan-balance="family === 'loans'"
							@load-more="c.loadDetails(groupItem(itemGroupOverlay!), true)"
							@retry="c.retryDetails(groupItem(itemGroupOverlay!))"
							@sort="c.setDetailSort(groupItem(itemGroupOverlay!), $event)"
							@open-document="(doctype, name) => emit('openDocument', doctype, name)"
							@open-loan="emit('openLoan', $event)"
						/>
					</Overlay>
					<DataTable
						v-if="
							records &&
							(!isMobile || browseView === 'table' || query.groupBy.length)
						"
						data-browse-scroll="operations"
						:ariaLabel="family === 'movements' ? '货物流动记录' : '借用记录'"
						table-class="browse-table"
						:columns="operationColumns"
						:group-summary-columns="
							() =>
								family === 'loans'
									? ['borrowed', 'quantities', 'outstanding']
									: ['available_effect', 'quantities']
						"
						:rows="operationTableRows"
						:suppressed-columns="groupImpliedColumns(query.groupBy)"
						:selection-enabled="family === 'loans' && c.selecting.value"
						:selected-keys="c.selected.value"
						@select="c.setSelected"
						@select-visible="
							(keys, checked) => keys.forEach((key) => c.setSelected(key, checked))
						"
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
						:empty-action="atDefaults ? '' : '恢复默认'"
						@empty-action="c.reset"
						@sort="sortTable"
						@toggle-group="c.groups.toggleGroup"
						@retry="query.groupBy.length ? c.groups.retry() : c.retry()"
						@load-more="query.groupBy.length ? c.groups.loadMore() : c.load(true)"
					>
						<template #group-label="{ group }">
							<span class="data-table-group-visual">
								<ItemImage
									v-if="isItemGroup(group) && c.stockItem(groupItem(group))"
									:item="c.stockItem(groupItem(group))!"
								/>
							</span>
						</template>
						<template #group-metrics="{ group, visibleColumns }">
							<GroupTotals
								v-if="isItemGroup(group)"
								class="operation-group-metrics-leading"
								:metrics="groupTotalsMetrics(group, visibleColumns)"
							/>
						</template>
						<template #group-column="{ group, column }">
							<span
								v-if="
									family === 'loans' &&
									['borrowed', 'quantities', 'outstanding'].includes(
										String(column.id),
									)
								"
								>{{ column.id === "outstanding" ? "未归还 " : "借出 " }}</span
							>
							<UnitValues
								v-if="
									(family === 'loans' &&
										['borrowed', 'quantities', 'outstanding'].includes(
											String(column.id),
										)) ||
									(family === 'movements' && column.id === 'available_effect')
								"
								:entries="groupMetricEntries(group, String(column.id))"
								:label="
									column.id === 'outstanding'
										? '未归还数量'
										: family === 'movements'
											? '可用变化'
											: '借出数量'
								"
								:title="groupSummary(group)"
								:signed="family === 'movements'"
								class="operation-group-metrics"
							/>
						</template>
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
						<template #cell="{ column, row }">
							<OperationRecordCell
								:column="column"
								:row="row"
								:controller="c"
								:family="family"
								:helpers="cellHelpers"
							/>
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
		<ScanPanel
			ref="scan"
			hide-trigger
			auto-unique
			auto-camera
			@item="acceptBrowseScan"
			@location="acceptBrowseLocation"
		/>
	</section>
</template>
<style scoped>
.drafts-entry-link {
	display: flex;
	width: 100%;
	align-items: center;
	gap: 8px;
	min-height: var(--p-control);
	padding: 6px 10px;
	border: 0;
	border-radius: calc(var(--p-radius-control) / 2);
	color: var(--p-ink);
	text-decoration: none;
}
@media (hover: hover) {
	.drafts-entry-link:hover {
		background: var(--p-soft);
	}
}
.drafts-entry-link .menu-item-meta {
	padding: 1px 5px;
	border-radius: 999px;
	background: var(--p-soft);
	text-align: center;
	font-size: var(--p-small);
}
.drafts-entry-link .menu-item-meta {
	margin-inline-start: auto;
}
</style>
