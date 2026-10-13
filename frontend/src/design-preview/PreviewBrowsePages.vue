<script setup lang="ts">
import { warehouseEditError, isSystemWarehouse } from "./workflowModel";
import PreviewSearchSelect from "./components/PreviewSearchSelect.vue";
import PreviewAttachments from "./components/PreviewAttachments.vue";
import { computed, ref, watch, onActivated, onDeactivated } from "vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import PreviewQuantitySummary from "./components/PreviewQuantitySummary.vue";
import PreviewActivityBrowse from "./PreviewActivityBrowse.vue";
import PreviewDashboard from "./PreviewDashboard.vue";
import { emptyScope, matchesItem, matchesWarehouse, inPeriod, matchesExpiry } from "./browseModel";
import { previewDate } from "./model";
import { remaining, loanStatus, quantityText } from "./browseModel";
import { expiryBucket, expiryBuckets } from "./dashboardModel";
import PreviewItemImage from "./PreviewItemImage.vue";
import PreviewPeriodFilter from "./components/PreviewPeriodFilter.vue";
import PreviewBrowseFilters from "./components/PreviewBrowseFilters.vue";
import PreviewFilterButton from "./components/PreviewFilterButton.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import {
	createDraft,
	captureSavedDraft,
	reviewMovementRows,
	getPreviewPage,
	reviewSession,
	type PreviewPage,
	type PreviewPageKey,
	type OperationKind,
	type ReviewDraft,
	type ReviewWarehouse,
	type ReviewMovement,
} from "./reviewModel";

const props = withDefaults(defineProps<{ route: PreviewPageKey; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	navigate: [page: PreviewPage, variant: string];
	notify: [message: string];
}>();

const page = computed(() => getPreviewPage(props.route)!);
const isMovementDetail = computed(
	() =>
		page.value.page === "movement-records" &&
		["detail", "selected", "opening", "workspace-detail", "entry-detail", "external"].includes(
			page.value.variant,
		),
);
const isDetail = computed(
	() =>
		isMovementDetail.value ||
		page.value.page.endsWith("-detail") ||
		(page.value.page === "loan-records" && page.value.variant === "detail"),
);
const detailState = ref("ready");
const detailUnavailable = computed(
	() =>
		(page.value.page === "item-detail" &&
			!reviewSession.stock.some((item) => item.code === reviewSession.selectedItemCode)) ||
		(page.value.page === "warehouse-detail" &&
			!reviewSession.warehouses.some(
				(row) => row.name === reviewSession.selectedWarehouse,
			)) ||
		(page.value.page === "loan-detail" &&
			page.value.variant === "selected" &&
			!!reviewSession.selectedLoanName &&
			!reviewSession.loans.some((row) => row.name === reviewSession.selectedLoanName)),
);
const title = computed(() => {
	if (isMovementDetail.value) return "操作详情";
	if (["movement-items", "movement-records"].includes(page.value.page)) return "货物流动";
	if (["loan-items", "loan-records"].includes(page.value.page)) return "借用";
	return page.value.label;
});
const externalVoucher: ReviewMovement = {
	documentType: "Purchase Receipt",
	name: "MAT-PRE-2026-00001",
	kind: "采购收货",
	stockPurpose: "Purchase Receipt",
	docstatus: 1,
	date: previewDate,
	code: "ITM-000128",
	itemName: "东北珍珠米",
	qty: 10,
	uom: "袋",
	from: "供应商",
	to: "斋堂 / A-01",
};
const allMovements = computed(() =>
	page.value.variant === "external"
		? [...reviewMovementRows(), externalVoucher]
		: reviewMovementRows(),
);
const movementEditable = computed(
	() =>
		currentMovement.value?.documentType !== "Purchase Receipt" &&
		currentMovement.value?.kind !== "Opening",
);
const deskLink = computed(
	() =>
		`/app/${(currentMovement.value?.documentType || "Stock Entry").toLowerCase().replaceAll(" ", "-")}/${encodeURIComponent(currentMovement.value?.name || "")}`,
);
const search = computed({
	get() {
		const family = page.value.page;
		if (family === "warehouses" || family === "warehouse-detail") return warehouseSearch.value;
		if (family === "inventory") return reviewSession.filters.inventory.search;
		if (family === "expiry") return reviewSession.filters.expiry.search;
		if (family === "movement-items") return reviewSession.filters.movementItems.search;
		if (family === "movement-records") return reviewSession.filters.movementItems.search;
		if (family === "loan-items") return reviewSession.filters.loanItems.search;
		if (family === "loan-records") return reviewSession.filters.loanItems.search;
		if (family === "pending") return reviewSession.filters.pending.search;
		if (family === "drafts") return reviewSession.filters.drafts.search;
		return "";
	},
	set(value: string) {
		const family = page.value.page;
		if (family === "warehouses" || family === "warehouse-detail")
			warehouseSearch.value = value;
		if (family === "inventory") reviewSession.filters.inventory.search = value;
		if (family === "expiry") reviewSession.filters.expiry.search = value;
		if (family === "movement-items") reviewSession.filters.movementItems.search = value;
		if (family === "movement-records") reviewSession.filters.movementItems.search = value;
		if (family === "loan-items") reviewSession.filters.loanItems.search = value;
		if (family === "loan-records") reviewSession.filters.loanItems.search = value;
		if (family === "pending") reviewSession.filters.pending.search = value;
		if (family === "drafts") reviewSession.filters.drafts.search = value;
	},
});
const { isMobile } = useResponsiveLayout();
const expiryFiltersOpen = ref(false);
const warehouseDialog = ref(false);
const warehouseSearch = ref("");
const warehouseError = ref("");
const warehouseName = ref("");
const warehouseEditName = ref("");
const warehouseParent = ref("斋堂");
const warehouseType = ref<ReviewWarehouse["warehouse_type"]>("Location");
const fabOpen = ref(false);
const showDelete = ref("");
const quickExportOpen = ref(false);
const quickExportFailed = ref(false);
const quickExportFormat = ref("CSV");
const quickExportDataset = ref("summary");
function openQuickExport() {
	quickExportDataset.value = "summary";
	quickExportOpen.value = true;
	quickExportFailed.value = false;
}
const exportRows = computed(() => {
	if (page.value.page === "expiry")
		return (quickExportDataset.value === "summary" ? expiryRows.value : expiryLines.value).map(
			(row) =>
				`${row.item.name} · ${row.item.category} · ${row.id} · ${row.available} ${row.item.uom} · ${row.expiry || "无效期"} · ${row.location}`,
		);
	const entries = warehouseStock(reviewSession.selectedWarehouse);
	if (quickExportDataset.value === "details")
		return entries.map(
			({ item, row }) => `${item.name} · ${row.location} · ${row.available} ${item.uom}`,
		);
	const totals = new Map<string, { name: string; uom: string; qty: number }>();
	entries.forEach(({ item, row }) => {
		const total = totals.get(item.code) || { name: item.name, uom: item.uom, qty: 0 };
		total.qty += row.available;
		totals.set(item.code, total);
	});
	return [...totals.values()].map((row) => `${row.name} · ${row.qty} ${row.uom}`);
});
function quickExport() {
	if (quickExportFailed.value) quickExportFailed.value = false;
	emit(
		"notify",
		`已模拟生成 ${exportRows.value.length} 条${quickExportFormat.value}记录，不下载文件`,
	);
	quickExportOpen.value = false;
}

watch(
	() => props.active,
	(active) => {
		if (!active) {
			warehouseDialog.value = false;
			showDelete.value = "";
			fabOpen.value = false;
		}
	},
);
const activeItem = computed(
	() =>
		reviewSession.stock.find((item) => item.code === reviewSession.selectedItemCode) ||
		reviewSession.stock[0],
);
const activeWarehouse = computed(() =>
	reviewSession.warehouses.find((row) => row.name === reviewSession.selectedWarehouse),
);
const movementDraft = computed(() =>
	reviewSession.drafts.find((row) => row.name === currentMovement.value?.name),
);
const batches = computed(() =>
	activeItem.value.locations.flatMap((location) =>
		(location.batches || []).map((batch) => ({
			...batch,
			location: location.location,
			item: activeItem.value,
		})),
	),
);
const expiryLines = computed(() => {
	const rows = reviewSession.stock.flatMap((item) =>
		item.tracksBatch
			? item.locations.flatMap((location) =>
					(location.batches || []).map((batch) => ({
						...batch,
						item,
						location: location.location,
					})),
				)
			: [],
	);
	const filtered = rows.filter((row) => {
		const matchesStatus = matchesExpiry(row.expiry, page.value.variant);
		const query = search.value.trim().toLocaleLowerCase();
		return (
			matchesStatus &&
			(reviewSession.filters.expiry.scope.period.key === "all" ||
				(!!row.expiry &&
					inPeriod(row.expiry, reviewSession.filters.expiry.scope.period))) &&
			(!reviewSession.filters.expiry.inStock || row.available > 0) &&
			matchesItem(row.item.code, reviewSession.filters.expiry.scope, reviewSession) &&
			matchesWarehouse(
				row.location,
				reviewSession.filters.expiry.scope.warehouses,
				reviewSession,
			) &&
			(!reviewSession.filters.expiry.bucket ||
				expiryBucket(row.expiry) === reviewSession.filters.expiry.bucket) &&
			(!query ||
				`${row.item.name} ${row.item.code} ${row.id} ${row.location}`
					.toLocaleLowerCase()
					.includes(query))
		);
	});
	return filtered;
});
const expiryRows = computed(() => {
	const rows = expiryLines.value;
	const grouped = new Map<string, (typeof rows)[number]>();
	rows.forEach((row) => {
		const key = `${row.item.code}:${row.id}`;
		const previous = grouped.get(key);
		grouped.set(
			key,
			previous
				? {
						...previous,
						available: previous.available + row.available,
						location: `${previous.location}、${row.location}`,
					}
				: { ...row },
		);
	});
	return [...grouped.values()];
});
const pendingRows = computed(() =>
	reviewSession.pending.filter(
		(row) =>
			matchesItem(row.code || "", reviewSession.filters.pending.scope, reviewSession) &&
			matchesWarehouse(
				row.location,
				reviewSession.filters.pending.scope.warehouses,
				reviewSession,
			) &&
			`${row.title} ${row.detail} ${row.location} ${row.code}`
				.toLocaleLowerCase()
				.includes(search.value.trim().toLocaleLowerCase()),
	),
);
const draftScope = ref(emptyScope());
const draftRows = computed(() =>
	reviewSession.drafts.filter(
		(row) =>
			row.status === "draft" &&
			(!draftScope.value.kinds.length || draftScope.value.kinds.includes(row.kind)) &&
			(!draftScope.value.activity || row.activity === draftScope.value.activity) &&
			inPeriod(row.postingDate, draftScope.value.period) &&
			(!(
				draftScope.value.item ||
				draftScope.value.categories.length ||
				draftScope.value.warehouses.length ||
				draftScope.value.sources.length ||
				draftScope.value.destinations.length
			) ||
				row.lines.some(
					(line) =>
						matchesItem(line.code, draftScope.value, reviewSession) &&
						(!draftScope.value.warehouses.length ||
							matchesWarehouse(
								line.location,
								draftScope.value.warehouses,
								reviewSession,
							) ||
							matchesWarehouse(
								line.sourceLocation || "",
								draftScope.value.warehouses,
								reviewSession,
							)) &&
						matchesWarehouse(
							line.sourceLocation || (row.kind === "Receive" ? "" : line.location),
							draftScope.value.sources,
							reviewSession,
						) &&
						matchesWarehouse(
							line.location,
							draftScope.value.destinations,
							reviewSession,
						),
				)) &&
			`${row.name} ${row.kind} ${row.activity} ${row.borrower}`
				.toLocaleLowerCase()
				.includes(search.value.trim().toLocaleLowerCase()),
	),
);
const itemMovements = computed(() =>
	allMovements.value.filter((row) => row.code === activeItem.value.code),
);
const warehouseRows = computed(() =>
	reviewSession.warehouses.filter(
		(row) =>
			!search.value ||
			`${row.label} ${row.name} ${row.parent || ""}`
				.toLocaleLowerCase()
				.includes(search.value.toLocaleLowerCase()),
	),
);
const currentMovement = computed(() => {
	const selectedName =
		page.value.variant === "external"
			? externalVoucher.name
			: page.value.variant === "opening"
				? "MAT-RECO-2026-00014"
				: page.value.variant === "workspace-detail"
					? "MAT-STE-2026-00017"
					: page.value.variant === "entry-detail"
						? "MAT-STE-2026-00003"
						: page.value.variant === "selected"
							? reviewSession.selectedMovementName || "MAT-STE-2026-00009"
							: "MAT-STE-2026-00012";
	return allMovements.value.find((row) => row.name === selectedName);
});
const currentLoan = computed(() => {
	if (page.value.variant === "selected")
		return (
			reviewSession.loans.find((row) => row.name === reviewSession.selectedLoanName) ||
			reviewSession.loans[0]
		);
	return (
		reviewSession.loans.find(
			(row) =>
				row.name ===
				(page.value.variant === "returned"
					? "MAT-STE-2026-00005"
					: page.value.variant === "damaged"
						? "MAT-STE-2026-00006"
						: "MAT-STE-2026-00004"),
		) || reviewSession.loans[0]
	);
});
const movementKindLabels: Record<string, string> = {
	Opening: "期初",
	Receive: "入库",
	Issue: "出库",
	Transfer: "转移",
	Loan: "借出",
	Return: "归还",
	Damage: "损坏",
	Loss: "遗失",
	Repair: "修复归库",
	Disposal: "报废",
	Reconcile: "盘点",
};
function movementLabel(kind: string) {
	return movementKindLabels[kind] || kind;
}
function draftLabel(kind: string) {
	return kind === "Reconcile" ? "盘点" : kind === "Item" ? "物品资料" : movementLabel(kind);
}
function go(nextPage: PreviewPage, variant: string) {
	emit("navigate", nextPage, variant);
}
function openItem(code: string, variant = "overview") {
	reviewSession.selectedItemCode = code;
	go("item-detail", variant);
}
function openMovement(name: string) {
	const draft = reviewSession.drafts.find((row) => row.name === name && row.status === "draft");
	if (draft) return continueDraft(draft);
	reviewSession.selectedItemCode =
		allMovements.value.find((row) => row.name === name)?.code || activeItem.value.code;
	reviewSession.selectedMovementName = name;
	go("movement-records", "selected");
}
function openLoan(name: string) {
	const loan = reviewSession.loans.find((row) => row.name === name);
	if (
		loan?.status === "draft" ||
		reviewSession.drafts.some(
			(row) => row.name === name && row.kind === "Loan" && row.status === "draft",
		)
	) {
		reviewSession.selectedDraftName = name;
		go("movement-form", "Loan");
		return;
	}
	reviewSession.selectedLoanName = name;
	go("loan-detail", "selected");
}
function newOperation(kind: OperationKind, code?: string, location?: string, qty = 1) {
	const draft = createDraft(kind);
	if (!draft.lines.length && code) {
		const item = reviewSession.stock.find((row) => row.code === code);
		if (item)
			draft.lines.push({
				id: `${kind.toLowerCase()}-${draft.name}`,
				code,
				qty,
				uom: item.uom,
				location: location || "",
				sourceLocation: location || "",
				batch: item.tracksBatch
					? item.locations.find((row) => row.location === location)?.batches?.[0]?.id ||
						""
					: "",
				expiry: item.tracksExpiry
					? item.locations.find((row) => row.location === location)?.batches?.[0]
							?.expiry || ""
					: "",
			});
	}
	reviewSession.selectedDraftName = draft.name;
	go("movement-form", kind);
}
function createLoanReturn(loanName: string, damaged = false, kind: "Return" | "Loss" = "Return") {
	const loan = reviewSession.loans.find((row) => row.name === loanName);
	if (!loan) return;
	const pending = reviewSession.drafts.find(
		(row) => row.kind === kind && row.loanName === loan.name && row.status === "draft",
	);
	const baseName = `MAT-STE-2026-${String(reviewSession.drafts.length + 201).padStart(5, "0")}`;
	let name = baseName;
	let sequence = 1;
	while (reviewSession.drafts.some((row) => row.name === name))
		name = `${baseName}-${++sequence}`;
	const draft = pending || createDraft(kind, name);
	draft.loanName = loan.name;
	draft.borrower = loan.borrower;
	draft.activity = loan.activity;
	if (!draft.lines.length) {
		draft.lines = loan.lines
			.map((line, index) => {
				const item = reviewSession.stock.find((row) => row.code === line.code);
				const location =
					line.location ||
					item?.locations.find((row) => row.loaned > 0)?.location ||
					item?.locations[0]?.location ||
					"";
				return {
					id: `${kind.toLocaleLowerCase()}-${loan.name}-${index + 1}`,
					loanLineIndex: index,
					loanName: loan.name,
					returnOutcome: damaged ? ("damaged" as const) : ("returned" as const),
					code: line.code,
					qty: Math.max(0, line.qty - line.returned - line.damaged - line.lost),
					uom: item?.uom || "Nos",
					location,
					sourceLocation: location,
					batch: line.batch,
				};
			})
			.filter((line) => line.qty > 0);
	}
	reviewSession.selectedDraftName = draft.name;
	go("movement-form", kind);
}
function continueDraft(draft: ReviewDraft) {
	reviewSession.selectedDraftName = draft.name;
	if (draft.kind === "Item") return go("item-form", "edit");
	if (draft.kind === "Reconcile") return go("reconciliation-form", "detail");
	go("movement-form", draft.kind);
}
function editMovement() {
	const rows = allMovements.value.filter((row) => row.name === currentMovement.value?.name);
	const first = rows[0];
	if (!first) return;
	if (!movementEditable.value) return;
	let draft = reviewSession.drafts.find((row) => row.name === first.name);
	if (!draft) {
		const operation =
			rows.some((row) => row.kind === "Return") && rows.some((row) => row.loanName)
				? "Return"
				: first.kind;
		draft = createDraft(operation as OperationKind, first.name);
		Object.assign(draft, {
			origin: "desk",
			saved: true,
			status:
				first.docstatus === 0
					? "draft"
					: first.docstatus === 2
						? "cancelled"
						: "completed",
			documentType: first.documentType || "Stock Entry",
			loanName: operation === "Loan" ? undefined : first.loanName,
			postingDate: first.date,
			activity: first.activity || "",
			borrower: first.borrower || "",
			countMode: operation === "Reconcile" ? "selective" : undefined,
			countLocation: operation === "Reconcile" ? first.to : undefined,
			lines: rows.map((row, i) => ({
				id: `${row.name}/${i}`,
				code: row.code,
				qty: operation === "Reconcile" ? (row.bookQty ?? 0) : row.qty,
				countedQty: row.countedQty,
				countState: row.countedQty === undefined ? undefined : "counted",
				reason: row.reason,
				uom: row.uom,
				sourceLocation: row.from,
				location: row.to,
				batch: row.batch,
				loanName: operation === "Loan" ? undefined : row.loanName,
				loanLineIndex: row.loanLineIndex,
				returnOutcome: row.kind === "Damage" ? "damaged" : "returned",
			})),
		});
		captureSavedDraft(draft);
	}
	continueDraft(draft);
}

function deleteDraft() {
	const draft = reviewSession.drafts.find((row) => row.name === showDelete.value);
	if (draft) reviewSession.drafts.splice(reviewSession.drafts.indexOf(draft), 1);
	showDelete.value = "";
	emit("notify", "草稿已删除");
}
function saveWarehouse() {
	const label = warehouseName.value.trim();
	warehouseError.value = "";
	if (!label) {
		warehouseError.value = "请填写名称";
		return;
	}
	if (
		reviewSession.warehouses.some(
			(row) => row.label === label && row.name !== warehouseEditName.value,
		)
	) {
		warehouseError.value = "此名称已存在";
		return;
	}
	if (
		!warehouseEditName.value &&
		!reviewSession.warehouses.some((row) => row.name === warehouseParent.value && row.is_group)
	) {
		warehouseError.value = "请选择可容纳下级的分组节点";
		return;
	}
	const existing = reviewSession.warehouses.find((row) => row.name === warehouseEditName.value);
	if (!existing) {
		warehouseError.value = warehouseEditError(label, warehouseParent.value);
		if (warehouseError.value) return;
	}
	if (existing) {
		warehouseError.value = warehouseEditError(existing.name, warehouseParent.value);
		if (warehouseError.value) return;
		existing.parent = warehouseParent.value;
		existing.warehouse_type = warehouseType.value;
		existing.label = label;
	} else {
		const name = label;
		reviewSession.warehouses.push({
			name,
			label,
			parent: warehouseParent.value,
			is_group: warehouseType.value !== "Location",
			warehouse_type: warehouseType.value,
			status: "active",
		});
		if (warehouseType.value === "Room")
			reviewSession.warehouses.push({
				name: `${name} / 未指定`,
				label: "未指定",
				parent: name,
				is_group: false,
				warehouse_type: "Location",
				status: "active",
			});
	}
	reviewSession.selectedWarehouse = existing?.name || label;
	warehouseDialog.value = false;
	warehouseName.value = "";
	warehouseEditName.value = "";
	emit("notify", existing ? "仓库信息已在预览中更新" : "仓库已在预览中添加");
}
function startWarehouseEdit(row: ReviewWarehouse) {
	warehouseName.value = row.label;
	warehouseEditName.value = row.name;
	warehouseParent.value = row.parent || "";
	warehouseType.value = row.warehouse_type;
	reviewSession.selectedWarehouse = row.name;
	warehouseDialog.value = true;
}
function newWarehouse() {
	warehouseName.value = "";
	warehouseEditName.value = "";
	warehouseParent.value = "斋堂";
	warehouseType.value = "Location";
	warehouseDialog.value = true;
}
function warehouseStock(name: string) {
	const node = reviewSession.warehouses.find((row) => row.name === name);
	const descendants = new Set<string>();
	const collect = (parent: string) => {
		reviewSession.warehouses
			.filter((row) => row.parent === parent)
			.forEach((row) => {
				if (row.is_group) collect(row.name);
				else descendants.add(row.name);
			});
	};
	if (node?.is_group) collect(name);
	else descendants.add(name);
	return reviewSession.stock.flatMap((item) =>
		item.locations
			.filter((row) => descendants.has(row.location))
			.map((row) => ({ item, row })),
	);
}
function formatStatus(status: string) {
	return (
		(
			{
				outstanding: "待归还",
				returned: "已归还",
				damaged: "有损坏",
				lost: "有遗失",
				draft: "草稿",
				completed: "已完成",
				cancelled: "已取消",
				open: "待处理",
			} as Record<string, string>
		)[status] || status
	);
}
function movementStatus(row: { docstatus: number }) {
	return row.docstatus === 0 ? "draft" : row.docstatus === 1 ? "completed" : "cancelled";
}
onDeactivated(() => {
	warehouseDialog.value = false;
	quickExportOpen.value = false;
	showDelete.value = "";
	fabOpen.value = false;
});
onActivated(() => {
	if (page.value.page === "movement-items" && page.value.variant === "filtered" && !search.value)
		search.value = "ITM-000128";
	if (page.value.page === "warehouses" && page.value.variant === "create") newWarehouse();
	if (
		["warehouses", "warehouse-detail"].includes(page.value.page) &&
		page.value.variant === "edit"
	) {
		const row = reviewSession.warehouses.find(
			(row) => row.name === reviewSession.selectedWarehouse,
		);
		if (row) startWarehouseEdit(row);
	}
});
</script>

<template>
	<section class="browse-page" :aria-labelledby="`browse-title-${page.page}`">
		<header class="browse-heading">
			<div>
				<h1 :id="`browse-title-${page.page}`">{{ title }}</h1>
			</div>
			<div class="browse-heading-actions">
				<PreviewUiButton
					v-if="['expiry', 'warehouse-detail'].includes(page.page)"
					icon="download"
					@click="openQuickExport"
					>快速导出</PreviewUiButton
				>
				<PreviewUiButton
					v-if="page.page === 'inventory'"
					variant="primary"
					icon="box"
					@click="go('item-form', 'new')"
					>新建物品</PreviewUiButton
				>
				<PreviewUiButton
					v-if="page.page === 'warehouses'"
					variant="primary"
					icon="box"
					@click="newWarehouse"
					>新建仓库</PreviewUiButton
				>
				<PreviewUiButton
					v-if="page.page === 'movement-records' || page.page === 'movement-items'"
					variant="primary"
					icon="box"
					@click="go('movement-form', 'Receive')"
					>入库</PreviewUiButton
				>
				<template v-if="page.page === 'movement-records' || page.page === 'movement-items'"
					><PreviewUiButton icon="movement" @click="go('movement-form', 'Issue')"
						>出库</PreviewUiButton
					><PreviewUiButton icon="movement" @click="go('movement-form', 'Transfer')"
						>转移</PreviewUiButton
					></template
				>
				<PreviewUiButton
					v-if="page.page === 'loan-records' || page.page === 'loan-items'"
					variant="primary"
					icon="box"
					@click="go('movement-form', 'Loan')"
					>登记借出</PreviewUiButton
				>
			</div>
		</header>

		<details v-if="isDetail" class="preview-detail-state-control">
			<summary>预览状态</summary>
			<label
				>详情状态<select v-model="detailState">
					<option value="ready">正常</option>
					<option value="loading">加载中</option>
					<option value="empty">无相关数据</option>
					<option value="error">加载失败</option>
					<option value="unavailable">记录不可用</option>
				</select></label
			>
		</details>
		<div
			v-if="isDetail && (detailState !== 'ready' || detailUnavailable)"
			class="browse-empty"
			:aria-busy="detailState === 'loading'"
		>
			<h2>
				{{
					detailUnavailable || detailState === "unavailable"
						? "这条记录不可用"
						: detailState === "loading"
							? "正在加载详情…"
							: detailState === "empty"
								? "暂无相关数据"
								: "详情加载失败"
				}}
			</h2>
			<p>
				{{
					detailUnavailable || detailState === "unavailable"
						? "记录可能已删除，请返回列表查看。"
						: "返回浏览时将保留原有筛选条件。"
				}}
			</p>
			<PreviewUiButton v-if="!detailUnavailable" @click="detailState = 'ready'">{{
				detailState === "error" ? "重试" : "恢复正常示例"
			}}</PreviewUiButton>
		</div>
		<PreviewDashboard
			:active="active"
			v-else-if="page.page === 'dashboard'"
			@navigate="go"
			@movement="openMovement"
			@loan="openLoan"
		/>

		<template v-else-if="page.page === 'expiry'">
			<div
				v-if="
					reviewSession.filters.expiry.scope.categories.length ||
					reviewSession.filters.expiry.scope.warehouses.length ||
					reviewSession.filters.expiry.bucket ||
					reviewSession.filters.expiry.inStock
				"
				class="preview-active-filters"
			>
				<span
					>总览范围：{{ reviewSession.filters.expiry.inStock ? "仅有库存批次 · " : ""
					}}{{
						[
							...reviewSession.filters.expiry.scope.categories,
							...reviewSession.filters.expiry.scope.warehouses,
						].join(" · ")
					}}
					{{
						expiryBuckets.find(
							(bucket) => bucket.key === reviewSession.filters.expiry.bucket,
						)?.label
					}}</span
				><button
					@click="
						reviewSession.filters.expiry.scope = emptyScope();
						reviewSession.filters.expiry.bucket = '';
						reviewSession.filters.expiry.inStock = false;
					"
				>
					清除总览范围
				</button>
			</div>
			<nav class="browse-tabs" aria-label="效期筛选">
				<button
					v-for="tab in [
						{ key: 'all', label: '全部' },
						{ key: 'expired', label: '已过期' },
						{ key: 'unexpired', label: '未过期' },
						{ key: 'undated', label: '无效期' },
					]"
					:key="tab.key"
					:aria-current="page.variant === tab.key ? 'page' : undefined"
					@click="go('expiry', tab.key)"
				>
					{{ tab.label }}
				</button>
			</nav>
			<div class="browse-toolbar">
				<label class="browse-search"
					><InventoryIcon name="search" /><input
						v-model="search"
						type="search"
						placeholder="搜索物品、批次或位置" /></label
				><PreviewPeriodFilter
					v-model="reviewSession.filters.expiry.scope.period"
					label="到期日期"
				/>
				<PreviewFilterButton
					:expanded="expiryFiltersOpen"
					:count="
						reviewSession.filters.expiry.scope.categories.length +
						reviewSession.filters.expiry.scope.warehouses.length +
						Number(!!reviewSession.filters.expiry.scope.item)
					"
					@click="expiryFiltersOpen = !expiryFiltersOpen"
				/>
				<span class="browse-result-count">{{ expiryRows.length }} 个批次</span>
			</div>
			<p v-if="page.variant === 'soon'" class="browse-note">
				到期日期：今日至未来30天（包含端点）
			</p>
			<div class="preview-browse-body">
				<aside v-if="expiryFiltersOpen && !isMobile" class="preview-filter-rail">
					<PreviewBrowseFilters
						hide-activity
						v-model="reviewSession.filters.expiry.scope"
					/>
				</aside>
				<PreviewOverlay
					v-if="expiryFiltersOpen && isMobile"
					title="筛选效期"
					drawer
					@close="expiryFiltersOpen = false"
					><PreviewBrowseFilters
						hide-activity
						v-model="reviewSession.filters.expiry.scope"
				/></PreviewOverlay>
				<div v-if="isMobile" class="preview-expiry-mobile">
					<article
						v-for="row in expiryRows"
						:key="row.item.code + row.id"
						class="browse-card"
					>
						<div class="preview-group-heading">
							<div class="preview-group-thumbnail">
								<PreviewItemImage :item="row.item" />
							</div>
							<button
								class="browse-row-link"
								@click="openItem(row.item.code, 'batches')"
							>
								<strong>{{ row.item.name }}</strong
								><small>{{ row.item.category }} · {{ row.id }}</small>
							</button>
						</div>
						<p>
							{{ row.expiry || "无效期" }} · 可用 {{ row.available }}
							{{ row.item.uom }}
						</p>
						<details>
							<summary>批次详情</summary>
							<p>{{ row.id }} · {{ row.item.code }}</p>
							<p>{{ row.location }}</p>
							<p>到期日：{{ row.expiry || "无效期" }}</p>
						</details>
					</article>
					<p v-if="!expiryRows.length">没有符合条件的批次</p>
				</div>
				<div v-else class="browse-table-wrap">
					<table class="browse-table">
						<thead>
							<tr>
								<th>物品 / 批次</th>
								<th>效期</th>
								<th>剩余天数</th>
								<th>可用量</th>
								<th>位置</th>
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="row in expiryRows"
								:key="`${row.item.code}-${row.id}-${row.location}`"
							>
								<td>
									<button
										class="browse-row-link"
										@click="openItem(row.item.code, 'batches')"
									>
										<strong>{{ row.item.name }}</strong
										><small
											>{{ row.id }} · {{ row.item.code }} ·
											{{ row.item.category }}</small
										>
									</button>
								</td>
								<td>
									<span
										class="browse-badge"
										:class="
											row.expiry && row.expiry < previewDate
												? 'is-danger'
												: row.expiry
													? 'is-success'
													: 'is-neutral'
										"
										>{{ row.expiry || "未设置" }}</span
									>
								</td>
								<td>
									{{
										row.expiry
											? Math.ceil(
													(new Date(`${row.expiry}T00:00:00`).getTime() -
														new Date(
															"2026-10-11T00:00:00",
														).getTime()) /
														86400000,
												)
											: "—"
									}}
								</td>
								<td>{{ row.available }} {{ row.item.uom }}</td>
								<td>
									<details>
										<summary>{{ row.location }}</summary>
										<p>批次 {{ row.id }} · {{ row.item.code }}</p>
										<p>
											到期日 {{ row.expiry || "无效期" }} · 可用
											{{ row.available }} {{ row.item.uom }}
										</p>
									</details>
								</td>
							</tr>
						</tbody>
					</table>
					<div v-if="!expiryRows.length" class="browse-empty compact">
						<h2>没有符合条件的批次</h2>
						<p>可以切换效期范围或清空搜索词。</p>
					</div>
				</div>
			</div>
		</template>

		<template v-else-if="page.page === 'movement-items' || page.page === 'movement-records'">
			<PreviewActivityBrowse
				v-if="!isMovementDetail"
				family="movement"
				:records="page.page === 'movement-records'"
				:variant="page.variant"
				@navigate="go"
				@movement="openMovement"
				@loan="openLoan"
				@notify="emit('notify', $event)"
			/>
			<article v-if="isMovementDetail && currentMovement" class="browse-detail-card">
				<div class="browse-card-heading">
					<div>
						<span class="eyebrow"
							>{{ currentMovement.documentType || "Stock Entry" }} ·
							{{ currentMovement.name }}</span
						>
						<h2>
							{{
								[
									...new Set(
										allMovements
											.filter((row) => row.name === currentMovement?.name)
											.map((row) => movementLabel(row.kind)),
									),
								].join(" / ")
							}}
							操作详情
						</h2>
					</div>
					<span
						class="browse-badge"
						:class="
							currentMovement.docstatus === 1
								? 'is-success'
								: currentMovement.docstatus === 2
									? 'is-neutral'
									: 'is-warning'
						"
						>{{ formatStatus(movementStatus(currentMovement)) }}</span
					>
				</div>
				<dl class="browse-detail-grid">
					<div>
						<dt>物品</dt>
						<dd>
							{{
								new Set(
									allMovements
										.filter((row) => row.name === currentMovement?.name)
										.map((row) => row.code),
								).size
							}}
							种物品 · 详见操作明细
						</dd>
					</div>
					<div>
						<dt>数量</dt>
						<dd>
							{{
								quantityText(
									allMovements.filter(
										(row) => row.name === currentMovement?.name,
									),
								)
							}}
						</dd>
					</div>
					<div>
						<dt>来源</dt>
						<dd>{{ currentMovement.from }}</dd>
					</div>
					<div>
						<dt>去向</dt>
						<dd>{{ currentMovement.to }}</dd>
					</div>
					<div>
						<dt>日期</dt>
						<dd>{{ currentMovement.date }}</dd>
					</div>
					<div>
						<dt>活动</dt>
						<dd>{{ currentMovement.activity || "—" }}</dd>
					</div>
				</dl>
				<PreviewUiButton
					v-if="currentMovement.loanName"
					@click="openLoan(currentMovement.loanName)"
					>查看借用与处理</PreviewUiButton
				>
				<dl class="browse-detail-grid">
					<div>
						<dt>用途</dt>
						<dd>{{ movementDraft?.purpose || "—" }}</dd>
					</div>
					<div>
						<dt>负责人</dt>
						<dd>{{ movementDraft?.responsible || "—" }}</dd>
					</div>
					<div>
						<dt>来源类型 / 来源</dt>
						<dd>
							{{ movementDraft?.sourceType || "—" }} ·
							{{ movementDraft?.source || "—" }}
						</dd>
					</div>
					<div>
						<dt>操作时间</dt>
						<dd>{{ movementDraft?.postingTime || "未记录" }}</dd>
					</div>
					<div>
						<dt>借用人 / 对象</dt>
						<dd>{{ currentMovement.borrower || "—" }}</dd>
					</div>
					<div>
						<dt>记录人</dt>
						<dd>{{ movementDraft?.recorder || "未填写" }}</dd>
					</div>
					<div>
						<dt>经手人</dt>
						<dd>{{ movementDraft?.handler || "未填写" }}</dd>
					</div>
					<div>
						<dt>鉴证人</dt>
						<dd>{{ movementDraft?.reviewer || "未填写" }}</dd>
					</div>
					<div>
						<dt>备注</dt>
						<dd>{{ movementDraft?.note || "无" }}</dd>
					</div>
				</dl>
				<h2>生命周期</h2>
				<p>
					{{ currentMovement.date }} ·
					{{ formatStatus(movementStatus(currentMovement)) }}
				</p>
				<h2>操作明细</h2>
				<div
					v-for="(line, index) in allMovements.filter(
						(row) => row.name === currentMovement?.name,
					)"
					:key="index"
					class="browse-rank-row"
				>
					<span>{{ line.itemName }} · {{ line.from }} → {{ line.to }}</span
					><strong>{{ line.qty }} {{ line.uom }}</strong
					><small v-if="line.kind === 'Reconcile'"
						>账面 {{ line.bookQty }} → 实点 {{ line.countedQty }} ·
						{{ line.reason || "无差异说明" }}</small
					><small v-else-if="line.reason">原因：{{ line.reason }}</small>
				</div>
				<h2>附件</h2>
				<PreviewAttachments
					:model-value="
						reviewSession.drafts.find((row) => row.name === currentMovement?.name)
							?.files
					"
					disabled
				/>
				<p class="browse-note">
					{{
						reviewSession.drafts
							.find((row) => row.name === currentMovement?.name)
							?.attachments?.join("、") || "暂无附件"
					}}
				</p>
				<p v-if="!movementEditable" class="browse-note">
					{{ currentMovement.documentType }} ·
					{{ currentMovement.stockPurpose || movementLabel(currentMovement.kind) }}，请在
					ERPNext 中处理。
				</p>
				<a :href="deskLink" target="_blank" rel="noopener">在 ERPNext Desk 中打开</a
				><PreviewUiButton v-if="movementEditable" @click="editMovement">{{
					currentMovement.docstatus === 0 ? "继续编辑草稿" : "查看记录生命周期"
				}}</PreviewUiButton>
				<p class="browse-note">
					{{
						currentMovement.docstatus === 1
							? "已提交记录以只读方式显示。"
							: currentMovement.docstatus === 2
								? "已取消记录以只读方式显示。"
								: "草稿记录可继续编辑。"
					}}
				</p>
			</article>
			<div v-else-if="isMovementDetail" class="browse-empty">
				<h2>这条记录已不存在</h2>
				<p>草稿可能已删除，请返回记录列表查看。</p>
				<PreviewUiButton
					@click="go('movement-records', reviewSession.filters.movementRecords.status)"
					>返回记录列表</PreviewUiButton
				>
			</div>
		</template>

		<template
			v-else-if="
				page.page === 'loan-items' ||
				page.page === 'loan-records' ||
				page.page === 'loan-detail'
			"
		>
			<PreviewActivityBrowse
				v-if="!isDetail"
				family="loan"
				:records="page.page === 'loan-records'"
				:variant="page.variant"
				@navigate="go"
				@movement="openMovement"
				@loan="openLoan"
				@return="createLoanReturn"
				@notify="emit('notify', $event)"
			/>
			<article v-if="isDetail" class="browse-detail-card">
				<div class="browse-card-heading">
					<div>
						<span class="eyebrow"
							>{{ currentLoan.name }} · {{ currentLoan.loanDate }}</span
						>
						<h2>{{ currentLoan.borrower }}</h2>
						<p class="muted">{{ currentLoan.activity }}</p>
					</div>
					<span
						class="browse-badge"
						:class="
							currentLoan.status === 'outstanding'
								? 'is-warning'
								: currentLoan.status === 'returned'
									? 'is-success'
									: 'is-danger'
						"
						>{{ loanStatus(currentLoan) }}</span
					>
				</div>
				<div
					v-for="(line, lineIndex) in currentLoan.lines"
					:key="`${line.code}-${lineIndex}`"
					class="browse-loan-line"
				>
					<strong>{{
						reviewSession.stock.find((item) => item.code === line.code)?.name ||
						line.code
					}}</strong
					><span
						>借出 {{ line.qty }} · 未结清 {{ remaining(line) }} · 归还
						{{ line.returned }} · 损坏 {{ line.damaged }} · 遗失 {{ line.lost }}
						{{ reviewSession.stock.find((item) => item.code === line.code)?.uom
						}}<small
							>{{ line.location || "原库位未记录" }} ·
							{{ line.batch || "不分批次" }}</small
						></span
					>
				</div>
				<h2>处理历史</h2>
				<button
					v-for="(row, index) in allMovements.filter(
						(row) => row.loanName === currentLoan.name,
					)"
					:key="index"
					class="browse-rank-row"
					@click="openMovement(row.name)"
				>
					<span
						>{{ row.date }} · {{ movementLabel(row.kind) }} · {{ row.itemName
						}}<small>{{ row.name }} · {{ row.from }} → {{ row.to }}</small></span
					><strong>{{ row.qty }} {{ row.uom }}</strong>
				</button>
				<p class="browse-note">
					{{ currentLoan.loanDate }} · 借用登记 · {{ formatStatus(currentLoan.status) }}
				</p>
				<h2>附件</h2>
				<PreviewAttachments
					:model-value="
						reviewSession.drafts.find((row) => row.name === currentLoan.name)?.files
					"
					disabled
				/>
				<p class="browse-note">暂无附件</p>
				<div v-if="currentLoan.status === 'outstanding'" class="browse-actions">
					<PreviewUiButton
						variant="primary"
						icon="loan"
						@click="createLoanReturn(currentLoan.name)"
						>登记归还</PreviewUiButton
					><PreviewUiButton @click="createLoanReturn(currentLoan.name, true)"
						>登记损坏归还</PreviewUiButton
					><PreviewUiButton @click="createLoanReturn(currentLoan.name, false, 'Loss')"
						>记录遗失</PreviewUiButton
					>
				</div>
			</article>
		</template>

		<template v-else-if="page.page === 'warehouses' || page.page === 'warehouse-detail'">
			<div class="browse-toolbar">
				<label class="browse-search"
					><InventoryIcon name="search" /><input
						v-model="search"
						type="search"
						placeholder="搜索仓库、房间或位置"
				/></label>
			</div>
			<div v-if="page.page === 'warehouses'" class="browse-warehouse-layout">
				<div class="browse-warehouse-tree">
					<div class="browse-card-heading">
						<div>
							<span class="eyebrow">WAREHOUSE STRUCTURE</span>
							<h2>仓库结构</h2>
						</div>
						<span class="browse-muted-count">{{ warehouseRows.length }} 个节点</span>
					</div>
					<div
						v-for="row in warehouseRows"
						:key="row.name"
						class="browse-tree-row"
						role="group"
						:class="{ 'is-selected': reviewSession.selectedWarehouse === row.name }"
						:style="{ '--tree-depth': row.parent ? 1 : 0 }"
						@click="reviewSession.selectedWarehouse = row.name"
					>
						<span class="browse-tree-type"
							><InventoryIcon
								:name="row.is_group ? 'warehouse' : 'location'" /></span
						><button
							class="browse-grow browse-link"
							@click="
								reviewSession.selectedWarehouse = row.name;
								go('warehouse-detail', 'overview');
							"
						>
							<strong>{{ row.label }}</strong
							><small
								>{{ row.warehouse_type }} ·
								{{ row.is_group ? "分组" : "可存放库存" }}</small
							></button
						><button class="browse-link" @click.stop="startWarehouseEdit(row)">
							编辑
						</button>
					</div>
				</div>
				<article class="browse-card">
					<div class="browse-card-heading">
						<div>
							<span class="eyebrow">LOCATION STOCK</span>
							<h2>{{ reviewSession.selectedWarehouse }}</h2>
						</div>
						<span class="browse-muted-count">只在叶子位置显示库存</span>
					</div>
					<div
						v-if="warehouseStock(reviewSession.selectedWarehouse).length"
						class="browse-rank-list"
					>
						<button
							v-for="entry in warehouseStock(reviewSession.selectedWarehouse)"
							:key="entry.item.code + entry.row.location"
							class="browse-rank-row"
							@click="openItem(entry.item.code)"
						>
							<span class="browse-grow"
								><strong>{{ entry.item.name }}</strong
								><small>{{ entry.item.code }}</small></span
							><b
								>{{ entry.row.available }} <small>{{ entry.item.uom }}</small></b
							>
						</button>
					</div>
					<div v-else class="browse-empty compact">
						<p>
							{{
								reviewSession.warehouses.find(
									(row) => row.name === reviewSession.selectedWarehouse,
								)?.is_group
									? "分组仓库只组织下级位置，不直接存放库存。"
									: "此位置暂无库存记录。"
							}}
						</p>
					</div>
				</article>
			</div>
			<article v-else class="browse-detail-card">
				<div class="browse-card-heading">
					<div>
						<span class="eyebrow"
							>WAREHOUSE · {{ reviewSession.selectedWarehouse }}</span
						>
						<h2>{{ activeWarehouse?.label }}</h2>
						<p>
							{{
								activeWarehouse?.is_group
									? "分组仓库 · 汇总下级库位"
									: "叶子库位 · 可存放库存"
							}}
						</p>
					</div>
					<button
						class="browse-link"
						@click="activeWarehouse && startWarehouseEdit(activeWarehouse)"
					>
						编辑仓库
					</button>
				</div>
				<div class="browse-rank-list">
					<button
						v-for="entry in warehouseStock(reviewSession.selectedWarehouse)"
						:key="entry.item.code + entry.row.location"
						class="browse-rank-row"
						@click="openItem(entry.item.code)"
					>
						<span class="browse-grow"
							><strong>{{ entry.item.name }}</strong
							><small>{{ entry.item.code }}</small></span
						><b>{{ entry.row.available }} {{ entry.item.uom }}</b>
					</button>
				</div>
				<dl class="browse-detail-grid">
					<div>
						<dt>类型</dt>
						<dd>{{ activeWarehouse?.warehouse_type }}</dd>
					</div>
					<div>
						<dt>上级</dt>
						<dd>{{ activeWarehouse?.parent || "根节点" }}</dd>
					</div>
					<div>
						<dt>状态</dt>
						<dd>{{ activeWarehouse?.status === "active" ? "启用" : "停用" }}</dd>
					</div>
					<div>
						<dt>库存方式</dt>
						<dd>
							{{
								activeWarehouse?.is_group ? "分组汇总，不直接存放库存" : "叶子库位"
							}}
						</dd>
					</div>
				</dl>
				<h2>最近流动</h2>
				<div class="browse-rank-list">
					<button
						v-for="row in allMovements
							.filter(
								(row) =>
									row.from.includes(reviewSession.selectedWarehouse) ||
									row.to.includes(reviewSession.selectedWarehouse),
							)
							.slice(0, 4)"
						:key="row.name + row.code"
						class="browse-rank-row"
						@click="openMovement(row.name)"
					>
						<span>{{ movementLabel(row.kind) }} · {{ row.itemName }}</span
						><small>{{ row.date }}</small>
					</button>
				</div>
			</article>
		</template>

		<template v-else-if="page.page === 'pending'">
			<div
				v-if="
					reviewSession.filters.pending.scope.categories.length ||
					reviewSession.filters.pending.scope.warehouses.length
				"
				class="preview-active-filters"
			>
				<span
					>总览范围：{{
						[
							...reviewSession.filters.pending.scope.categories,
							...reviewSession.filters.pending.scope.warehouses,
						].join(" · ")
					}}</span
				><button @click="reviewSession.filters.pending.scope = emptyScope()">
					清除总览范围
				</button>
			</div>
			<div class="browse-callout">
				<span class="browse-callout-icon"><InventoryIcon name="warning" /></span>
				<div>
					<strong>损坏物资待处理</strong>
					<p>选择修复归库，或将无法使用的物资正式报废。</p>
				</div>
				<b>{{ pendingRows.length }} 条</b>
			</div>
			<div class="browse-toolbar">
				<label class="browse-search"
					><InventoryIcon name="search" /><input
						v-model="search"
						type="search"
						placeholder="搜索物品或存放位置"
				/></label>
			</div>
			<div v-if="pendingRows.length" class="browse-grid browse-grid--two">
				<article
					v-for="row in pendingRows"
					:key="row.name"
					class="browse-card browse-pending-card"
				>
					<div class="browse-card-heading">
						<div>
							<span class="eyebrow">{{ row.code }} · {{ row.location }}</span>
							<h2>{{ row.title }}</h2>
						</div>
						<span class="browse-badge is-danger"
							>损坏 {{ row.qty }}
							{{
								reviewSession.stock.find((item) => item.code === row.code)?.uom
							}}</span
						>
					</div>
					<p class="muted">{{ row.detail }} · {{ row.location }}</p>
					<div class="browse-actions">
						<PreviewUiButton
							variant="primary"
							icon="loan"
							@click="newOperation('Repair', row.code, row.location, row.qty)"
							>修复归库</PreviewUiButton
						><PreviewUiButton
							variant="danger"
							icon="trash"
							@click="newOperation('Disposal', row.code, row.location, row.qty)"
							>正式报废</PreviewUiButton
						>
					</div>
				</article>
			</div>
			<div v-else class="browse-empty">
				<span><InventoryIcon name="check" /></span>
				<h2>暂无损坏库存</h2>
				<p>当前没有需要修复或报废的损坏物资。</p>
			</div>
		</template>

		<template v-else-if="page.page === 'drafts'"
			><PreviewPeriodFilter label="操作日期" v-model="draftScope.period" />
			<details class="form-section">
				<summary>筛选草稿</summary>
				<PreviewBrowseFilters v-model="draftScope" movement records />
			</details>
			<div class="browse-toolbar">
				<label class="browse-search"
					><InventoryIcon name="search" /><input
						v-model="search"
						type="search"
						placeholder="搜索草稿、活动或操作类型" /></label
				><span class="browse-result-count">{{ draftRows.length }} 份草稿</span>
			</div>
			<div v-if="draftRows.length" class="browse-table-wrap">
				<table class="browse-table">
					<thead>
						<tr>
							<th>草稿</th>
							<th>类型</th>
							<th>活动 / 借用人</th>
							<th>物品行</th>
							<th>日期</th>
							<th>操作</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="draft in draftRows" :key="draft.name">
							<td>
								<button class="browse-row-link" @click="continueDraft(draft)">
									<strong>{{
										draft.saved === false ? "未保存" : draft.name
									}}</strong
									><small>{{ draft.responsible || "未指定负责人" }}</small>
								</button>
							</td>
							<td>{{ draftLabel(draft.kind) }}</td>
							<td>{{ draft.activity || draft.borrower || "—" }}</td>
							<td>{{ draft.lines.length }}</td>
							<td>{{ draft.postingDate }}</td>
							<td>
								<div class="browse-row-actions">
									<button class="browse-link" @click="continueDraft(draft)">
										继续填写</button
									><button
										class="browse-link is-danger-text"
										@click="showDelete = draft.name"
									>
										删除
									</button>
								</div>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<div v-else class="browse-empty">
				<span><InventoryIcon name="check" /></span>
				<h2>没有未完成草稿</h2>
				<p>新建操作并保存后，草稿会出现在这里。</p>
				<PreviewUiButton variant="primary" @click="go('movement-form', 'Receive')"
					>新建入库记录</PreviewUiButton
				>
			</div>
		</template>

		<template v-else-if="page.page === 'item-detail'">
			<article class="browse-detail-card">
				<div class="browse-item-detail-head">
					<span class="browse-item-illustration"><InventoryIcon name="box" /></span>
					<div class="browse-detail-image">
						<PreviewItemImage :item="activeItem" />
					</div>
					<div class="browse-grow">
						<span class="eyebrow"
							>{{ activeItem.category }} · {{ activeItem.code }}</span
						>
						<h2>{{ activeItem.name }}</h2>
						<p class="muted">按物品代码汇总的库存、借用与损坏情况</p>
					</div>
					<PreviewUiButton @click="go('item-form', 'edit')"
						>编辑物品资料</PreviewUiButton
					>
				</div>
				<dl class="browse-detail-grid">
					<div>
						<dt>物品编号</dt>
						<dd>{{ activeItem.code }}</dd>
					</div>
					<div>
						<dt>单位</dt>
						<dd>{{ activeItem.uom }}</dd>
					</div>
					<div>
						<dt>批次管理</dt>
						<dd>{{ activeItem.tracksBatch ? "启用" : "不启用" }}</dd>
					</div>
					<div>
						<dt>记录效期</dt>
						<dd>{{ activeItem.tracksExpiry ? "启用" : "不启用" }}</dd>
					</div>
					<div>
						<dt>条码</dt>
						<dd>{{ activeItem.barcode || "未设置" }}</dd>
					</div>
					<div>
						<dt>说明</dt>
						<dd>{{ activeItem.description || "无" }}</dd>
					</div>
				</dl>
				<h2>物品图片</h2>
				<PreviewAttachments :model-value="activeItem.files" images-only disabled />
				<p class="browse-note">
					{{ activeItem.images?.join("、") || "示例插画；未添加其他图片" }}
				</p>
				<PreviewQuantitySummary
					:metrics="[
						{
							key: 'available',
							label: '可用',
							quantities: [{ uom: activeItem.uom, qty: activeItem.available }],
							tone: 'success',
						},
						{
							key: 'loaned',
							label: '借出',
							quantities: [{ uom: activeItem.uom, qty: activeItem.loaned }],
							tone: 'warning',
						},
						{
							key: 'damaged',
							label: '损坏',
							quantities: [{ uom: activeItem.uom, qty: activeItem.damaged }],
							tone: 'danger',
						},
					]"
				/>
				<nav class="browse-tabs">
					<button
						:aria-current="page.variant === 'overview' ? 'page' : undefined"
						@click="go('item-detail', 'overview')"
					>
						库存分布</button
					><button
						v-if="activeItem.tracksBatch"
						:aria-current="page.variant === 'batches' ? 'page' : undefined"
						@click="go('item-detail', 'batches')"
					>
						批次信息
					</button>
				</nav>
				<div v-if="page.variant === 'batches'" class="browse-table-wrap">
					<table class="browse-table">
						<thead>
							<tr>
								<th>批次</th>
								<th>效期</th>
								<th>位置</th>
								<th>可用量</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="batch in batches" :key="`${batch.id}-${batch.location}`">
								<td>
									<details>
										<summary>{{ batch.id }}</summary>
										<p>
											位置 {{ batch.location }} · 到期
											{{ batch.expiry || "无效期" }}
										</p>
										<p>
											借出
											{{
												reviewSession.loans
													.flatMap((loan) => loan.lines)
													.filter(
														(line) =>
															line.code === activeItem.code &&
															line.batch === batch.id &&
															line.location === batch.location,
													)
													.reduce(
														(sum, line) =>
															sum +
															Math.max(
																0,
																line.qty -
																	line.returned -
																	line.damaged -
																	line.lost,
															),
														0,
													)
											}}
											· 损坏 {{ batch.damaged || 0 }}
										</p>
										<button
											v-for="record in allMovements.filter(
												(row) =>
													row.code === activeItem.code &&
													row.batch === batch.id,
											)"
											:key="record.name"
											class="browse-link"
											@click="openMovement(record.name)"
										>
											{{ record.name }} ·
											{{ movementLabel(record.kind) }}</button
										><button
											v-for="loan in reviewSession.loans.filter((loan) =>
												loan.lines.some(
													(line) =>
														line.code === activeItem.code &&
														line.batch === batch.id,
												),
											)"
											:key="loan.name"
											class="browse-link"
											@click="
												reviewSession.selectedLoanName = loan.name;
												go('loan-detail', 'selected');
											"
										>
											借用 {{ loan.borrower }} · {{ loan.name }}
										</button>
									</details>
								</td>
								<td>{{ batch.expiry || "未设置" }}</td>
								<td>{{ batch.location }}</td>
								<td>{{ batch.available }} {{ activeItem.uom }}</td>
							</tr>
						</tbody>
					</table>
					<p v-if="!batches.length" class="browse-note">此物品未启用批次管理。</p>
				</div>
				<div v-else class="browse-table-wrap">
					<table class="browse-table">
						<thead>
							<tr>
								<th>存放位置</th>
								<th>可用</th>
								<th>借出</th>
								<th>损坏</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="location in activeItem.locations" :key="location.location">
								<td>{{ location.location }}</td>
								<td>{{ location.available }} {{ activeItem.uom }}</td>
								<td>{{ location.loaned }}</td>
								<td>{{ location.damaged }}</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div class="browse-card-heading">
					<h2>最近流动</h2>
					<button
						class="browse-link"
						@click="
							reviewSession.filters.movementScope = {
								...emptyScope(),
								item: activeItem.code,
							};
							reviewSession.filters.movementItems.search = '';
							go('movement-items', 'list');
						"
					>
						查看物品流动
					</button>
				</div>
				<div class="browse-rank-list">
					<button
						v-for="row in itemMovements.slice(0, 4)"
						:key="row.name"
						class="browse-rank-row"
						@click="openMovement(row.name)"
					>
						<span class="browse-grow"
							><strong>{{ movementLabel(row.kind) }} · {{ row.date }}</strong
							><small>{{ row.name }} · {{ row.from }} → {{ row.to }}</small></span
						><b>{{ row.qty }} {{ row.uom }}</b>
					</button>
					<p v-if="!itemMovements.length" class="browse-note">暂无相关流动记录。</p>
					<h2>借用记录</h2>
					<button
						v-for="loan in reviewSession.loans.filter((row) =>
							row.lines.some((line) => line.code === activeItem.code),
						)"
						:key="loan.name"
						class="browse-rank-row"
						@click="openLoan(loan.name)"
					>
						{{ loan.borrower }} · {{ formatStatus(loan.status) }}
					</button>
					<h2>附件与补充资料</h2>
					<p class="browse-note">
						暂无附件 · 单位：{{ activeItem.uom }} · 类别：{{ activeItem.category }}
					</p>
				</div>
			</article>
		</template>

		<div
			v-if="
				[
					'movement-items',
					'movement-records',
					'loan-items',
					'loan-records',
					'warehouses',
				].includes(page.page)
			"
			class="browse-mobile-fab"
			@keydown.esc="fabOpen = false"
		>
			<div v-if="fabOpen" class="browse-mobile-fab-menu">
				<button
					v-if="page.page === 'warehouses'"
					@click="
						newWarehouse();
						fabOpen = false;
					"
				>
					新建仓库
				</button>
				<button
					v-else-if="page.page === 'loan-items' || page.page === 'loan-records'"
					@click="
						go('movement-form', 'Loan');
						fabOpen = false;
					"
				>
					登记借出
				</button>
				<button
					v-else
					@click="
						go('movement-form', 'Receive');
						fabOpen = false;
					"
				>
					新建操作
				</button>
			</div>
			<button
				class="browse-mobile-fab-trigger"
				aria-label="新建操作"
				:aria-expanded="fabOpen"
				@click="fabOpen = !fabOpen"
			>
				{{ fabOpen ? "×" : "＋" }}
			</button>
		</div>

		<PreviewOverlay
			v-if="quickExportOpen"
			title="快速导出 · 当前筛选范围"
			@close="quickExportOpen = false"
			><p>{{ exportRows.length }} 条完整筛选结果 · 不受当前显示行数限制</p>
			<label
				>格式<select v-model="quickExportFormat">
					<option>CSV</option>
					<option>XLSX</option>
				</select></label
			>
			<label
				>导出内容<select v-model="quickExportDataset">
					<option value="summary">
						{{ page.page === "expiry" ? "批次汇总" : "物品汇总" }}
					</option>
					<option value="details">逐库位明细</option>
				</select></label
			>
			<ul>
				<li v-for="(row, index) in exportRows" :key="index">{{ row }}</li>
			</ul>
			<p v-if="quickExportFailed" role="alert">模拟导出失败，筛选已保留。</p>
			<template #footer
				><PreviewUiButton @click="quickExportFailed = true">模拟失败</PreviewUiButton
				><PreviewUiButton variant="primary" @click="quickExport">{{
					quickExportFailed ? "重试导出" : "模拟导出"
				}}</PreviewUiButton></template
			></PreviewOverlay
		>
		<PreviewOverlay v-if="showDelete" title="删除这份草稿？" @close="showDelete = ''">
			<p>删除后，当前预览中的草稿内容将清除。</p>
			<template #footer>
				<PreviewUiButton @click="showDelete = ''">保留草稿</PreviewUiButton>
				<PreviewUiButton variant="danger" @click="deleteDraft">删除草稿</PreviewUiButton>
			</template>
		</PreviewOverlay>
		<PreviewOverlay
			v-if="warehouseDialog"
			:title="warehouseEditName ? '编辑仓库 / 位置' : '新建仓库 / 位置'"
			@close="warehouseDialog = false"
		>
			<form
				id="warehouse-preview-form"
				class="browse-dialog"
				@submit.prevent="saveWarehouse"
			>
				<span class="eyebrow">WAREHOUSE SETUP</span>
				<p v-if="warehouseError" role="alert" class="browse-note">{{ warehouseError }}</p>
				<label>名称<input v-model="warehouseName" required autocomplete="off" /></label
				><PreviewSearchSelect
					label="上级节点"
					v-model="warehouseParent"
					:options="
						reviewSession.warehouses
							.filter((row) => row.is_group && !isSystemWarehouse(row.name))
							.map((row) => row.name)
					"
				/>
				<p class="muted">
					修改上级仅调整组织结构，不移动实物库存。分组 / 库位属性保持不变。
				</p>
				<label
					>物理类型<select v-model="warehouseType">
						<option value="Room">房间</option>
						<option value="Location">位置</option>
						<option value="Group">组织分组</option>
					</select></label
				>
				<p class="browse-note">“物理类型”和“分组节点”分别记录；分组节点不直接存放库存。</p>
			</form>
			<template #footer>
				<PreviewUiButton @click="warehouseDialog = false">取消</PreviewUiButton>
				<PreviewUiButton type="submit" variant="primary" form="warehouse-preview-form"
					>保存到预览</PreviewUiButton
				>
			</template>
		</PreviewOverlay>
	</section>
</template>

<style src="./browse-pages.css"></style>
