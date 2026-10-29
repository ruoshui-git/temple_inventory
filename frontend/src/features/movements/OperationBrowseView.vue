<script setup lang="ts">
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import { useFilterRailPreference } from "../../composables/useFilterRailPreference";
import Scanner from "../../components/Scanner.vue";
import Overlay from "../../components/ui/Overlay.vue";
import RelatedLoanPreview from "../loans/RelatedLoanPreview.vue";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import type { OperationBrowse, OperationGroup } from "./useOperationBrowse";
import type { ReportQuery } from "../../lib/reportContract";
import { clearScopeField, scopeFilterFieldChips } from "../../lib/filterPresentation";
import { sortableColumnLabels, sortableColumnsForView } from "../../lib/reportContract";
import { groupLabels } from "../../lib/reportContract";
import { removeGroupByField } from "../../lib/groupBy";
import { enumPresentationLabel, movementLabels } from "../../lib/presentationLabels";
import { formatQuantityWithUnit } from "../../lib/formatQuantity";
import { kindIcons } from "../../lib/kindIcons";
import InventoryIcon from "../../components/InventoryIcon.vue";
import UiButton from "../../components/ui/UiButton.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
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
import { compactGroupSummary } from "../../lib/groupSummary";
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import DataTable from "../../components/ui/DataTable.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import BrowseRefreshNotice from "../../components/ui/BrowseRefreshNotice.vue";
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
import RecordRef from "../../components/ui/RecordRef.vue";
import LocationEndpoint from "../../components/ui/LocationEndpoint.vue";
import { loanReferenceIdentity } from "../../lib/relatedLoanPresentation";
import { formatQuantity } from "../../lib/formatQuantity";
import { createRecoveryStore } from "../../lib/browserRecovery";
import { newReportQuery } from "../../lib/reportContract";
import { RouterLink } from "vue-router";
import { routeTarget } from "../../lib/routeRegistry";
import { sortByUnit, unitLabel } from "../../lib/units";
import UnitText from "../../components/ui/UnitText.vue";
import { stockEffectLabel } from "../../lib/stockEffectLabel";
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
					kind: "primary",
					required: true,
					defaultVisible: true,
					sortable: true,
					sortField: "identity",
				},
				{
					id: "kind",
					label: "类型",
					defaultVisible: true,
					sortable: true,
				},
				{
					id: "date",
					label: "日期",
					defaultVisible: true,
					sortable: true,
				},
				{
					id: "quantities",
					label: "数量（按单位）",
					defaultVisible: true,
					align: "end",
				},
				{
					id: "source",
					label: "来源位置",
					defaultVisible: wideScreen.value,
				},
				{
					id: "destination",
					label: "去向位置",
					defaultVisible: wideScreen.value,
				},
				{
					id: "docstatus",
					label: "状态",
					required: true,
					defaultVisible: true,
				},
				{
					id: "related_loans",
					label: "原借出",
					defaultVisible: true,
				},
			]
		: [
				{
					id: "document",
					label: "记录",
					kind: "primary",
					required: true,
					defaultVisible: true,
					sortable: true,
					sortField: "identity",
				},
				{
					id: "borrower",
					label: "借用方",
					defaultVisible: true,
					sortable: true,
				},
				{
					id: "activity_title",
					label: "活动",
					defaultVisible: true,
					sortable: true,
				},
				{
					id: "date",
					label: "借出日期",
					defaultVisible: true,
					sortable: true,
				},
				{
					id: "quantities",
					label: "借出数量（按单位）",
					defaultVisible: true,
					align: "end",
				},
				{
					id: "outstanding",
					label: "未归还数量（按单位）",
					defaultVisible: true,
					align: "end",
				},
				{
					id: "source",
					label: "来源位置",
					defaultVisible: wideScreen.value,
				},
				{
					id: "destination",
					label: "去向位置",
					defaultVisible: wideScreen.value,
				},
				{
					id: "status",
					label: "当前结清状态",
					required: true,
					defaultVisible: true,
					sortable: true,
					sortField: "loan_status",
				},
				{
					id: "actions",
					label: "操作",
					required: true,
					defaultVisible: true,
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
					id: "image",
					label: "图片",
					kind: "thumb",
					defaultVisible: true,
				},
				{
					id: "document",
					label: "记录",
					kind: "primary",
					required: true,
					defaultVisible: true,
				},
				{
					id: "kind",
					label: "类型",
					defaultVisible: true,
					sortable: true,
					sortField: "kind",
				},
				{
					id: "date",
					label: "日期",
					defaultVisible: true,
					sortable: true,
					sortField: "date",
				},
				{ id: "docstatus", label: "状态", defaultVisible: true },
				{
					id: "source",
					label: "来源位置",
					defaultVisible: wideScreen.value,
				},
				{
					id: "destination",
					label: "去向位置",
					defaultVisible: wideScreen.value,
				},
				{
					id: "quantities",
					label: "数量（按单位）",
					defaultVisible: true,
					align: "end",
					sortable: true,
					sortField: "stock_qty",
					className: "operation-movement-quantity-column",
				},
				{
					id: "available_effect",
					label: "可用变化",
					defaultVisible: false,
					align: "end",
				},
				{
					id: "related_loans",
					label: "原借出",
					defaultVisible: wideScreen.value,
				},
			]
		: [
				{
					id: "image",
					label: "图片",
					kind: "thumb",
					defaultVisible: true,
				},
				{
					id: "document",
					label: "记录",
					kind: "primary",
					required: true,
					defaultVisible: true,
					sortable: true,
					sortField: "document",
				},
				{
					id: "kind",
					label: "类型",
					defaultVisible: true,
					sortable: true,
					sortField: "kind",
				},
				{
					id: "date",
					label: "日期",
					defaultVisible: true,
					sortable: true,
					sortField: "date",
				},
				{
					id: "activity_title",
					label: "活动",
					defaultVisible: true,
				},
				{ id: "status", label: "状态", defaultVisible: true },
				{
					id: "source",
					label: "来源位置",
					defaultVisible: wideScreen.value,
				},
				{
					id: "destination",
					label: "去向位置",
					defaultVisible: wideScreen.value,
				},
				{
					id: "borrowed",
					label: "数量",
					defaultVisible: true,
					sortable: true,
					sortField: "borrowed",
				},
				{
					id: "actions",
					label: "操作",
					defaultVisible: wideScreen.value,
				},
				{
					id: "outstanding",
					label: "未还数量",
					defaultVisible: true,
					sortable: true,
					sortField: "outstanding",
					className: "operation-loan-outstanding-column",
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
			image: item.image || row.image,
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
				original_loan_details: Array.isArray(whole.original_loan_details)
					? (whole.original_loan_details as Record<string, unknown>[]).map((detail) => ({
							name: String(detail.name || ""),
							borrower: String(detail.borrower || ""),
							date: String(detail.date || ""),
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
		const unit = unitLabel(String(row.stock_uom || ""));
		if (row.borrowed !== undefined) parts.push(`借出 ${row.borrowed} ${unit}`.trim());
		if (row.outstanding !== undefined) parts.push(`未归还 ${row.outstanding} ${unit}`.trim());
	} else if (Array.isArray(row.quantity_breakdown)) {
		const breakdown = sortByUnit(
			row.quantity_breakdown as Record<string, unknown>[],
			(entry) => String(entry.stock_uom || row.stock_uom || ""),
		);
		for (const entry of breakdown) {
			const quantity = Number(entry.stock_qty || 0);
			if (!quantity) continue;
			const parallel = (row.quantity_breakdown as Record<string, unknown>[]).some(
				(other) => other.kind === entry.kind && other.docstatus !== entry.docstatus,
			);
			const status = parallel
				? `（${entry.docstatus === 1 ? "已提交" : entry.docstatus === 2 ? "已取消" : "草稿"}）`
				: "";
			parts.push(
				`${movementLabels[String(entry.kind)] || "其他类型"}${status} ${quantity} ${unitLabel(String(row.stock_uom || ""))}`.trim(),
			);
		}
	} else if (row.stock_qty !== undefined && row.stock_qty !== null) {
		parts.push(`${row.stock_qty} ${unitLabel(String(row.stock_uom || ""))}`.trim());
	}
	return parts.join(" · ");
}
function groupSummaryDisplay(group: DataTableGroup, includeCount = false) {
	return compactGroupSummary(groupSummary(group, includeCount));
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
function groupLoanMetric(group: DataTableGroup, column: string) {
	const row = group.value || {};
	const key = column === "outstanding" ? "outstanding" : "borrowed";
	const value = row[key];
	if (value === undefined || value === null) return "";
	return `${key === "borrowed" ? "借出" : "未归还"} ${formatQuantityWithUnit(Number(value), String(row.stock_uom || ""))}`.trim();
}
function hiddenGroupMetrics(group: DataTableGroup, visibleColumns: string[]) {
	if (!isItemGroup(group)) return "";
	if (props.family === "loans") {
		const parts: string[] = [];
		if (!visibleColumns.includes("borrowed") && !visibleColumns.includes("quantities"))
			parts.push(groupLoanMetric(group, "borrowed"));
		if (!visibleColumns.includes("outstanding"))
			parts.push(groupLoanMetric(group, "outstanding"));
		return parts.filter(Boolean).join(" · ");
	}
	return visibleColumns.includes("quantities") ? "" : groupSummaryDisplay(group);
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
const flatTable = ref<InstanceType<typeof DataTable>>();
const flatColumns = computed(() => {
	const columns = itemColumns.value;
	const order = itemPreferences?.order.value.length
		? itemPreferences.order.value
		: columns.map((column) => String(column.id));
	const visible = itemPreferences?.visible.value.length
		? itemPreferences.visible.value
		: columns
				.filter((column) => column.defaultVisible !== false || column.required)
				.map((column) => String(column.id));
	return order.filter(
		(id) => visible.includes(id) && columns.some((column) => column.id === id),
	);
});
defineExpose({ flatColumns });
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
const filterSheetOpen = ref(false);
const analysisOpen = ref(false);
watch([() => props.active, isMobile], () => {
	scanOpen.value = false;
	analysisOpen.value = false;
	c.relatedLoans.close();
});
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
		.map((row) => formatQuantityWithUnit(row.qty, row.uom))
		.join(" | ");
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
function effectLabel(effect: number, _uom: string, status?: string) {
	if (status === "草稿" || status === "已取消") effect = 0;
	return stockEffectLabel(effect);
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
				@scan="scanOpen = true"
				@filter-open="filterSheetOpen = $event"
			>
				<template #actions>
					<BrowseOverflowMenu>
						<QuickExport
							:query="query"
							:active="active"
							@open-full="emit('openExport', $event)"
						/>
						<RouterLink
							v-if="family === 'movements'"
							class="drafts-entry-link"
							:to="routeTarget('drafts')"
						>
							<InventoryIcon class="menu-item-icon" name="document" />
							<span>草稿</span><span class="menu-item-meta">{{ draftCount }}</span>
						</RouterLink>
					</BrowseOverflowMenu>
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
					<UiButton
						v-if="query.groupBy.length || scopeChips.length || extraChips.length"
						variant="ghost"
						@click="c.reset"
						>清除全部</UiButton
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
						<SortControl
							v-if="showMobileItemCards"
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
				v-if="!records && result.loading && !result.initialized"
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
					<BrowseFilters v-model="scope" :fields="['categories', 'warehouses']" />
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
					<div v-if="showMobileItemCards" class="mobile-item-group-list browse-card">
						<article
							v-for="group in mobileItemGroups"
							:key="group.id"
							class="browse-group browse-group--mobile-list browse-card"
							:data-browse-row="group.id"
						>
							<div class="browse-group-heading mobile-operation-group-heading">
								<div
									v-if="c.stockItem(groupItem(group))"
									class="browse-group-thumbnail"
								>
									<ItemImage :item="c.stockItem(groupItem(group))!" />
								</div>
								<h2>
									<RouterLink
										class="browse-row-link"
										:title="group.label"
										:to="
											routeTarget('item-detail', {
												code: String(
													group.value?.item_code || group.label,
												),
											})
										"
										>{{ group.label }}</RouterLink
									>
									<small :title="`明细条数 ${group.count}`"
										>{{ group.count }} 条</small
									>
									<span
										class="browse-group-metrics"
										:title="groupSummaryDisplay(group)"
										>{{
											groupSummaryDisplay(group).replace(
												/\+(\d+)\s+项/g,
												"+$1",
											)
										}}</span
									>
								</h2>
								<button
									type="button"
									class="browse-group-trigger"
									:aria-expanded="group.expanded"
									:aria-controls="`mobile-operation-group-${group.id}`"
									@click="toggleMobileItemGroup(group, !group.expanded)"
								>
									<DisclosureIcon variant="inline" />
								</button>
							</div>
							<div
								v-show="group.expanded"
								:id="`mobile-operation-group-${group.id}`"
								class="browse-group-content"
							>
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
									:history-complete="
										details[groupItem(group).id]!.historyComplete
									"
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
												contribution.kind === 'Loan' &&
												contribution.can_settle
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
							</div>
						</article>
					</div>
					<p
						v-if="
							family === 'loans' &&
							!records &&
							!query.groupBy.length &&
							c.expanded.has(flatHistoryItem.id) &&
							historyScope === 'outstanding' &&
							details[flatHistoryItem.id]?.initialized &&
							!details[flatHistoryItem.id]?.rows?.length
						"
						class="field-hint"
					>
						当前范围没有未结清借用记录。可在筛选中切换到“全部相关记录”查看历史。
					</p>
					<DataTable
						v-if="!records && !showMobileItemCards"
						ref="flatTable"
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
						empty-action="清空筛选"
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
							<template v-if="row.history_record">
								<ItemImage
									v-if="column.id === 'image'"
									:item="{
										code: String(row.item_code || ''),
										name: String(row.item_name || row.item_code || ''),
										image: String(row.image || ''),
									}"
									:thumbnail-size="32"
									:target-size="32"
								/>
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
								<template v-else-if="column.id === 'available_effect'">
									<span
										:class="
											recordEffectTone(
												operationRow(row),
												String(row.stock_uom || ''),
											)
										"
										:title="
											recordEffectLabel(
												operationRow(row),
												String(row.stock_uom || ''),
											)
										"
									>
										{{
											recordEffect(
												operationRow(row),
												String(row.stock_uom || ""),
											) > 0
												? "+"
												: recordEffect(
															operationRow(row),
															String(row.stock_uom || ""),
													  ) < 0
													? "−"
													: ""
										}}{{
											formatQuantity(
												Math.abs(
													recordEffect(
														operationRow(row),
														String(row.stock_uom || ""),
													),
												),
											)
										}}
										<UnitText :name="row.stock_uom" />
									</span>
								</template>
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
									<UnitText :name="row.stock_uom" />
								</template>
								<template
									v-else-if="
										column.id === 'outstanding' &&
										row.kind === 'Loan' &&
										row.outstanding != null
									"
								>
									<UnitText
										:name="row.stock_uom"
										:qty="Number(row.outstanding)"
									/>
								</template>
								<LocationEndpoint
									v-else-if="column.id === 'source'"
									:warehouse="
										String(row.source_warehouse || row.warehouse || '')
									"
									:kind="String(row.kind || '')"
									:borrower="String(row.borrower || '')"
									role="来源位置"
								/>
								<LocationEndpoint
									v-else-if="column.id === 'destination'"
									:warehouse="String(row.destination_warehouse || '')"
									:kind="String(row.kind || '')"
									:borrower="String(row.borrower || '')"
									role="去向位置"
								/>
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
										<UnitText :name="row.stock_uom" />
									</span>
									<span v-if="family === 'movements'" class="sr-only">{{
										recordEffectLabel(
											operationRow(row),
											String(row.stock_uom || ""),
										)
									}}</span>
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
								<RecordRef
									v-else-if="
										column.id === 'related_loans' &&
										relatedLoanNames(row).length
									"
									kind="Loan"
									:identity="
										loanReferenceIdentity(
											relatedLoanDetails(row)[0]?.borrower,
											relatedLoanDetails(row)[0]?.date,
										) ||
										relatedLoanNames(row)[0] ||
										''
									"
									:count="
										relatedLoanNames(row).length > 1
											? relatedLoanNames(row).length
											: undefined
									"
									:document-name="
										relatedLoanNames(row).length === 1
											? relatedLoanDetails(row)[0]?.name ||
												relatedLoanNames(row)[0] ||
												''
											: ''
									"
									tooltip="查看原借出记录"
									@open="c.relatedLoans.show(relatedLoanNames(row))"
								/>
							</template>
							<template v-else>
								<ItemImage
									v-if="column.id === 'image'"
									:item="
										c.stockItem(operationRow(row)) || {
											code: String(row.item_code || ''),
											name: String(row.item_name || row.item_code || ''),
											image: String(row.image || ''),
										}
									"
									:thumbnail-size="32"
									:target-size="32"
								/>
								<div v-if="column.id === 'document'" class="browse-item-identity">
									<RouterLink
										class="browse-row-link"
										:to="
											routeTarget('item-detail', {
												code: String(row.item_code || ''),
											})
										"
									>
										{{ row.item_name || row.item_code }}
									</RouterLink>
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
								<template v-else-if="column.id === 'available_effect'">{{
									row.available_effect == null
										? ""
										: stockEffectLabel(Number(row.available_effect))
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
										>{{ metric.label }}
										<UnitText
											:name="metric.quantity.uom"
											:qty="metric.quantity.qty"
										/><small v-if="metric.quantity.status">
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
						<template #group-metrics="{ group, visibleColumns }">
							<span
								v-if="hiddenGroupMetrics(group, visibleColumns)"
								role="note"
								class="operation-group-metrics operation-group-metrics-leading"
								:title="groupSummary(group)"
								:aria-label="groupSummary(group)"
								>{{ hiddenGroupMetrics(group, visibleColumns) }}</span
							>
						</template>
						<template #group-column="{ group, column }">
							<span
								role="note"
								class="operation-group-metrics"
								:title="groupSummary(group)"
								:aria-label="groupSummary(group)"
								v-if="
									family === 'loans' &&
									['borrowed', 'quantities'].includes(String(column.id))
								"
								>{{ groupLoanMetric(group, String(column.id)) }}</span
							>
							<span
								role="note"
								class="operation-group-metrics"
								:title="groupSummary(group)"
								:aria-label="groupSummary(group)"
								v-else-if="family === 'loans' && column.id === 'outstanding'"
								>{{ groupLoanMetric(group, String(column.id)) }}</span
							>
							<span
								role="note"
								class="operation-group-metrics"
								:title="groupSummary(group)"
								:aria-label="groupSummary(group)"
								v-else-if="family === 'movements' && column.id === 'quantities'"
								>{{ groupSummaryDisplay(group) }}</span
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
						empty-action="清空筛选"
						@empty-action="c.reset"
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
								{{ group.value.stock_qty }}
								{{ unitLabel(String(group.value.stock_uom || "")) }}
							</span>
							<span
								v-else-if="
									column.id === 'outstanding' &&
									group.value?.outstanding !== undefined
								"
							>
								{{ group.value.outstanding }}
								{{ unitLabel(String(group.value.stock_uom || "")) }}
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
							<RecordRef
								v-else-if="
									column.id === 'related_loans' && relatedLoanNames(row).length
								"
								kind="Loan"
								:identity="
									loanReferenceIdentity(
										relatedLoanDetails(row)[0]?.borrower,
										relatedLoanDetails(row)[0]?.date,
									) ||
									relatedLoanNames(row)[0] ||
									''
								"
								:count="
									relatedLoanNames(row).length > 1
										? relatedLoanNames(row).length
										: undefined
								"
								:document-name="
									relatedLoanNames(row).length === 1
										? relatedLoanDetails(row)[0]?.name ||
											relatedLoanNames(row)[0] ||
											''
										: ''
								"
								tooltip="查看原借出记录"
								:disabled="result.stale"
								@open="c.relatedLoans.show(relatedLoanNames(row))"
							/>
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
							<LocationEndpoint
								v-else-if="column.id === 'source' && row.kind === 'Reconcile'"
								:locations="countedLocations(row)"
								kind="Reconcile"
								role="来源位置"
							/>
							<template v-else-if="column.id === 'source'"
								><LocationEndpoint
									v-for="branch in operationRow(row).whole?.branches || []"
									:key="JSON.stringify(branch)"
									:warehouse="branch.source"
									:kind="String(row.kind || '')"
									:borrower="String(row.borrower || '')"
									role="来源位置"
							/></template>
							<LocationEndpoint
								v-else-if="column.id === 'destination' && row.kind === 'Reconcile'"
								kind="Reconcile"
								role="去向位置"
							/>
							<template v-else-if="column.id === 'destination'"
								><LocationEndpoint
									v-for="branch in operationRow(row).whole?.branches || []"
									:key="JSON.stringify(branch)"
									:warehouse="branch.destination"
									:kind="String(row.kind || '')"
									:borrower="String(row.borrower || '')"
									role="去向位置"
							/></template>
							<template v-else-if="column.id === 'quantities'"
								><span
									v-for="quantity in sortByUnit(
										operationRow(row).whole?.quantities || [],
										(entry) => entry.uom,
									)"
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
									>{{ quantity.qty }} {{ unitLabel(quantity.uom)
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
