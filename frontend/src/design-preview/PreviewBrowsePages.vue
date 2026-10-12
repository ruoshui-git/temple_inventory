<script setup lang="ts">
import { computed, ref, watch, onActivated, onDeactivated } from "vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import PreviewQuantitySummary from "./components/PreviewQuantitySummary.vue";
import PreviewProduct from "./PreviewProduct.vue";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import {
	createDraft,
	getPreviewPage,
	reviewSession,
	type PreviewPage,
	type PreviewPageKey,
	type OperationKind,
	type ReviewDraft,
	type ReviewWarehouse,
} from "./reviewModel";

const props = withDefaults(defineProps<{ route: PreviewPageKey; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	navigate: [page: PreviewPage, variant: string];
	notify: [message: string];
}>();

const page = computed(() => getPreviewPage(props.route)!);
const title = computed(() => page.value.label);
const search = computed({
	get() {
		const family = page.value.page;
		if (family === "warehouses" || family === "warehouse-detail") return warehouseSearch.value;
		if (family === "inventory") return reviewSession.filters.inventory.search;
		if (family === "expiry") return reviewSession.filters.expiry.search;
		if (family === "movement-items") return reviewSession.filters.movementItems.search;
		if (family === "movement-records") return reviewSession.filters.movementRecords.search;
		if (family === "loan-items") return reviewSession.filters.loanItems.search;
		if (family === "loan-records") return reviewSession.filters.loanRecords.search;
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
		if (family === "movement-records") reviewSession.filters.movementRecords.search = value;
		if (family === "loan-items") reviewSession.filters.loanItems.search = value;
		if (family === "loan-records") reviewSession.filters.loanRecords.search = value;
		if (family === "pending") reviewSession.filters.pending.search = value;
		if (family === "drafts") reviewSession.filters.drafts.search = value;
	},
});
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
const exportRows = computed(() =>
	page.value.page === "expiry"
		? expiryRows.value.map(
				(row) =>
					`${row.item.name} · ${row.id} · ${row.available} ${row.item.uom} · ${row.location}`,
			)
		: page.value.page.startsWith("movement")
			? visibleMovements.value.map(
					(row) => `${row.name} · ${row.itemName} · ${row.qty} ${row.uom}`,
				)
			: page.value.page.startsWith("loan")
				? loanRows.value.map(
						(row) => `${row.name} · ${row.borrower} · ${formatStatus(row.status)}`,
					)
				: warehouseStock(reviewSession.selectedWarehouse).map(
						({ item, row }) =>
							`${item.name} · ${row.location} · ${row.available} ${item.uom}`,
					),
);
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
const batches = computed(() =>
	activeItem.value.locations.flatMap((location) =>
		(location.batches || []).map((batch) => ({
			...batch,
			location: location.location,
			item: activeItem.value,
		})),
	),
);
const expiryRows = computed(() => {
	const rows = reviewSession.stock.flatMap((item) =>
		item.tracksExpiry
			? item.locations.flatMap((location) =>
					(location.batches || []).map((batch) => ({
						...batch,
						item,
						location: location.location,
					})),
				)
			: [],
	);
	return rows.filter((row) => {
		const expired = !!row.expiry && row.expiry < "2026-10-11";
		const days = row.expiry
			? Math.ceil(
					(new Date(`${row.expiry}T00:00:00`).getTime() -
						new Date("2026-10-11T00:00:00").getTime()) /
						86400000,
				)
			: null;
		const matchesStatus =
			page.value.variant === "expired"
				? expired
				: page.value.variant === "all"
					? !!row.expiry
					: days !== null && days >= 0 && days <= 30;
		const query = search.value.trim().toLocaleLowerCase();
		return (
			matchesStatus &&
			(!query ||
				`${row.item.name} ${row.item.code} ${row.id} ${row.location}`
					.toLocaleLowerCase()
					.includes(query))
		);
	});
});
const movementSort = ref("newest");
const movementItems = computed(() =>
	reviewSession.movements.filter(
		(row) =>
			row.docstatus === 1 &&
			(!reviewSession.filters.movementItems.kind ||
				row.kind === reviewSession.filters.movementItems.kind) &&
			`${row.itemName} ${row.code} ${row.kind} ${row.from} ${row.to}`
				.toLocaleLowerCase()
				.includes(search.value.trim().toLocaleLowerCase()),
	),
);
const visibleMovements = computed(() =>
	[
		...(page.value.page === "movement-items"
			? movementItems.value
			: [...new Map(movementRecords.value.map((row) => [row.name, row])).values()]),
	].sort((a, b) =>
		movementSort.value === "oldest"
			? a.date.localeCompare(b.date)
			: b.date.localeCompare(a.date),
	),
);
const movementRecords = computed(() =>
	reviewSession.movements.filter((row) => {
		const status =
			row.docstatus === 0 ? "draft" : row.docstatus === 1 ? "completed" : "cancelled";
		const wanted = [
			"detail",
			"selected",
			"opening",
			"workspace-detail",
			"entry-detail",
		].includes(page.value.variant)
			? "all"
			: page.value.variant;
		return (
			(page.value.variant === "selected"
				? row.name === reviewSession.selectedMovementName
				: page.value.variant === "opening"
					? row.kind === "Opening"
					: page.value.variant === "workspace-detail"
						? row.name === "PREV-WORKSPACE-001"
						: page.value.variant === "entry-detail"
							? row.name === "PREV-ENTRY-001"
							: wanted === "all" || status === wanted) &&
			`${row.name} ${row.kind} ${row.itemName} ${row.code}`
				.toLocaleLowerCase()
				.includes(search.value.trim().toLocaleLowerCase())
		);
	}),
);
const loanRows = computed(() =>
	(page.value.page === "loan-records" && page.value.variant === "draft"
		? reviewSession.drafts
				.filter((draft) => draft.kind === "Loan" && draft.status === "draft")
				.map((draft) => ({
					name: draft.name,
					borrower: draft.borrower,
					activity: draft.activity,
					loanDate: draft.postingDate,
					status: "draft" as const,
					lines: draft.lines.map((line) => ({
						code: line.code,
						qty: line.qty,
						returned: 0,
						damaged: 0,
						lost: 0,
					})),
				}))
		: reviewSession.loans
	).filter((row) => {
		const wanted =
			page.value.page === "loan-items"
				? page.value.variant
				: page.value.variant === "open"
					? "outstanding"
					: page.value.variant === "settled"
						? "returned"
						: page.value.variant;
		return (
			(page.value.variant === "detail" ||
				wanted === "all" ||
				(page.value.variant === "settled"
					? ["returned", "damaged", "lost"].includes(row.status)
					: row.status === wanted)) &&
			`${row.name} ${row.borrower} ${row.activity} ${row.lines.map((line) => `${line.code} ${reviewSession.stock.find((item) => item.code === line.code)?.name || ""}`).join(" ")}`
				.toLocaleLowerCase()
				.includes(search.value.trim().toLocaleLowerCase())
		);
	}),
);
const pendingRows = computed(() =>
	reviewSession.pending.filter((row) =>
		`${row.title} ${row.detail} ${row.location} ${row.code}`
			.toLocaleLowerCase()
			.includes(search.value.trim().toLocaleLowerCase()),
	),
);
const draftRows = computed(() =>
	reviewSession.drafts.filter(
		(row) =>
			row.status === "draft" &&
			`${row.name} ${row.kind} ${row.activity} ${row.borrower}`
				.toLocaleLowerCase()
				.includes(search.value.trim().toLocaleLowerCase()),
	),
);
const itemMovements = computed(() =>
	reviewSession.movements.filter((row) => row.code === activeItem.value.code),
);
const recentMovements = computed(() =>
	[...reviewSession.movements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4),
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
		page.value.variant === "opening"
			? "PREV-OPENING-001"
			: page.value.variant === "workspace-detail"
				? "PREV-WORKSPACE-001"
				: page.value.variant === "entry-detail"
					? "PREV-ENTRY-001"
					: page.value.variant === "selected"
						? reviewSession.selectedMovementName
						: "PREV-MOV-004";
	return (
		reviewSession.movements.find((row) => row.name === selectedName) ||
		reviewSession.movements[0]
	);
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
					? "PREV-LOAN-002"
					: page.value.variant === "damaged"
						? "PREV-LOAN-003"
						: "PREV-LOAN-001"),
		) || reviewSession.loans[0]
	);
});
const dashboardItems = computed(() =>
	reviewSession.stock.filter((item) => {
		const { category, warehouse } = reviewSession.filters.dashboard;
		return (
			(!category || item.category === category) &&
			(!warehouse || item.locations.some((row) => row.location === warehouse))
		);
	}),
);
function quantitiesByUnit(
	rows: typeof reviewSession.stock,
	field: "available" | "loaned" | "damaged",
) {
	const totals = new Map<string, number>();
	rows.forEach((item) => {
		const scope = reviewSession.filters.dashboard.warehouse;
		const qty = scope
			? item.locations
					.filter((row) => row.location === scope)
					.reduce((sum, row) => sum + row[field], 0)
			: item[field];
		totals.set(item.uom, (totals.get(item.uom) || 0) + qty);
	});
	return [...totals].map(([uom, qty]) => ({ uom, qty }));
}
const dashboardMetrics = computed(() => [
	{
		key: "item",
		label: "物品种类",
		quantities: [{ uom: "种", qty: dashboardItems.value.length }],
		icon: "box",
	},
	{
		key: "stock",
		label: "可用库存",
		quantities: quantitiesByUnit(dashboardItems.value, "available"),
		icon: "total",
	},
	{
		key: "loan",
		label: "全库未归还借用",
		quantities: [
			{
				uom: "笔",
				qty: reviewSession.loans.filter((row) => row.status === "outstanding").length,
			},
		],
		icon: "loan",
		tone: "warning",
	},
	{
		key: "damaged",
		label: "损坏待处理",
		quantities: quantitiesByUnit(dashboardItems.value, "damaged"),
		icon: "alert",
		tone: "danger",
	},
]);
function recordQuantities(name: string) {
	const units = new Map<string, number>();
	reviewSession.movements
		.filter((row) => row.name === name)
		.forEach((row) => units.set(row.uom, (units.get(row.uom) || 0) + row.qty));
	return [...units].map(([unit, qty]) => `${qty} ${unit}`).join(" · ");
}
const movementKindLabels: Record<string, string> = {
	Opening: "期初",
	Receive: "入库",
	Issue: "领用",
	Transfer: "调拨",
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
	reviewSession.selectedItemCode =
		reviewSession.movements.find((row) => row.name === name)?.code || activeItem.value.code;
	reviewSession.selectedMovementName = name;
	go("movement-records", "selected");
}
function openLoan(name: string) {
	const loan = reviewSession.loans.find((row) => row.name === name);
	if (
		loan?.status === "draft" ||
		reviewSession.drafts.some((row) => row.name === name && row.kind === "Loan")
	) {
		reviewSession.selectedDraftName = name;
		go("movement-form", "Loan");
		return;
	}
	reviewSession.selectedLoanName = name;
	go("loan-detail", "selected");
}
function newOperation(kind: OperationKind, code?: string, location?: string, qty = 1) {
	const contextName =
		code && location
			? `PREV-${kind.toUpperCase()}-${`${code}-${location}`.replace(/[^A-Z0-9]+/gi, "-")}`
			: undefined;
	const draft = createDraft(kind, contextName);
	if (!draft.lines.length && code) {
		const item = reviewSession.stock.find((row) => row.code === code);
		if (item)
			draft.lines.push({
				id: `${kind.toLowerCase()}-${draft.name}`,
				code,
				qty,
				uom: item.uom,
				location: location || item.locations[0]?.location || "",
				sourceLocation: location || item.locations[0]?.location || "",
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
function createLoanReturn(loanName: string, damaged = false) {
	const loan = reviewSession.loans.find((row) => row.name === loanName);
	if (!loan) return;
	const kind: OperationKind = damaged ? "Damage" : "Return";
	const draft = createDraft(kind, `PREV-${kind.toUpperCase()}-${loan.name}`);
	draft.loanName = loan.name;
	draft.borrower = loan.borrower;
	draft.activity = loan.activity;
	if (!draft.lines.length) {
		draft.lines = loan.lines.map((line, index) => {
			const item = reviewSession.stock.find((row) => row.code === line.code);
			const location =
				item?.locations.find((row) => row.loaned > 0)?.location ||
				item?.locations[0]?.location ||
				"";
			return {
				id: `${kind.toLocaleLowerCase()}-${loan.name}-${index + 1}`,
				code: line.code,
				qty: Math.max(0, line.qty - line.returned - line.damaged - line.lost),
				uom: item?.uom || "件",
				location,
				sourceLocation: location,
			};
		});
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
	const row = currentMovement.value;
	const draft = createDraft(row.kind as OperationKind, row.name);
	if (!draft.lines.length)
		draft.lines.push({
			id: row.name + "-1",
			code: row.code,
			qty: row.qty,
			uom: row.uom,
			sourceLocation: row.from,
			location: row.to,
		});
	reviewSession.selectedDraftName = draft.name;
	go("movement-form", row.kind);
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
	if (existing) {
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
	warehouseParent.value = row.parent || "斋堂";
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
				<span class="eyebrow">{{ page.path }}</span>
				<h1 :id="`browse-title-${page.page}`">{{ title }}</h1>
				<p class="muted">布局提案 · 本地模拟数据 · 页面操作只影响本次预览</p>
			</div>
			<div class="browse-heading-actions">
				<PreviewUiButton
					v-if="
						[
							'expiry',
							'movement-items',
							'movement-records',
							'loan-items',
							'loan-records',
							'warehouse-detail',
						].includes(page.page)
					"
					icon="download"
					@click="quickExportOpen = true"
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
					><PreviewUiButton @click="go('movement-form', 'Issue')">出库</PreviewUiButton
					><PreviewUiButton @click="go('movement-form', 'Transfer')"
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

		<template v-if="page.page === 'dashboard'">
			<div class="browse-toolbar browse-dashboard-filters" aria-label="总览范围">
				<label
					>类别<select v-model="reviewSession.filters.dashboard.category">
						<option value="">全部类别</option>
						<option
							v-for="value in [
								...new Set(reviewSession.stock.map((item) => item.category)),
							]"
							:key="value"
							:value="value"
						>
							{{ value }}
						</option>
					</select></label
				>
				<label
					>库位<select v-model="reviewSession.filters.dashboard.warehouse">
						<option value="">全部库位</option>
						<option
							v-for="row in reviewSession.warehouses.filter(
								(item) => !item.is_group,
							)"
							:key="row.name"
							:value="row.name"
						>
							{{ row.label }}
						</option>
					</select></label
				>
				<span class="browse-result-count"
					>当前范围 {{ dashboardItems.length }} 种物品</span
				>
			</div>
			<PreviewQuantitySummary label="库存总览" :metrics="dashboardMetrics" />
			<div class="browse-grid browse-grid--two">
				<article class="browse-card">
					<div class="browse-card-heading">
						<div>
							<span class="eyebrow">STOCK</span>
							<h2>库存一览</h2>
						</div>
						<button class="browse-link" @click="go('inventory', 'list')">
							查看库存 <InventoryIcon name="open" />
						</button>
					</div>
					<div class="browse-rank-list">
						<button
							v-for="item in dashboardItems.slice(0, 4)"
							:key="item.code"
							class="browse-rank-row"
							@click="openItem(item.code)"
						>
							<span class="browse-item-symbol"><InventoryIcon name="box" /></span
							><span class="browse-grow"
								><strong>{{ item.name }}</strong
								><small>{{ item.code }} · {{ item.category }}</small></span
							><b
								>{{ item.available }} <small>{{ item.uom }}</small></b
							>
						</button>
					</div>
				</article>
				<article class="browse-card">
					<div class="browse-card-heading">
						<div>
							<span class="eyebrow">RECENT ACTIVITY</span>
							<h2>最近流动</h2>
						</div>
						<button class="browse-link" @click="go('movement-records', 'completed')">
							全部记录 <InventoryIcon name="open" />
						</button>
					</div>
					<div class="browse-rank-list">
						<button
							v-for="row in recentMovements"
							:key="row.name"
							class="browse-rank-row"
							@click="openMovement(row.name)"
						>
							<span class="browse-kind-icon"><InventoryIcon name="movement" /></span
							><span class="browse-grow"
								><strong>{{ movementLabel(row.kind) }} · {{ row.itemName }}</strong
								><small>{{ row.date }} · {{ row.name }}</small></span
							><b>{{ row.qty }} {{ row.uom }}</b>
						</button>
					</div>
				</article>
				<button class="browse-action-card" @click="go('expiry', 'soon')">
					<span><InventoryIcon name="table" /></span><strong>效期批次</strong
					><small>查看即将到期与过期批次</small
					><b>{{ expiryRows.length }} 个批次 <InventoryIcon name="open" /></b>
				</button>
				<button class="browse-action-card" @click="go('pending', 'actionable')">
					<span class="danger"><InventoryIcon name="warning" /></span
					><strong>待处理损坏库存</strong><small>选择修复归库或正式报废</small
					><b>{{ reviewSession.pending.length }} 条记录 <InventoryIcon name="open" /></b>
				</button>
			</div>
		</template>

		<template v-else-if="page.page === 'expiry'">
			<nav class="browse-tabs" aria-label="效期筛选">
				<button
					v-for="tab in [
						{ key: 'soon', label: '即将到期' },
						{ key: 'expired', label: '已过期' },
						{ key: 'all', label: '全部批次' },
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
				><span class="browse-result-count">{{ expiryRows.length }} 个批次</span>
			</div>
			<div class="browse-table-wrap">
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
									><small>{{ row.id }} · {{ row.item.code }}</small>
								</button>
							</td>
							<td>
								<span
									class="browse-badge"
									:class="
										row.expiry && row.expiry < '2026-10-11'
											? 'is-danger'
											: 'is-warning'
									"
									>{{ row.expiry || "未设置" }}</span
								>
							</td>
							<td>
								{{
									row.expiry
										? Math.ceil(
												(new Date(`${row.expiry}T00:00:00`).getTime() -
													new Date("2026-10-11T00:00:00").getTime()) /
													86400000,
											)
										: "—"
								}}
							</td>
							<td>{{ row.available }} {{ row.item.uom }}</td>
							<td>{{ row.location }}</td>
						</tr>
					</tbody>
				</table>
				<div v-if="!expiryRows.length" class="browse-empty compact">
					<h2>没有符合条件的批次</h2>
					<p>可以切换效期范围或清空搜索词。</p>
				</div>
			</div>
		</template>

		<template v-else-if="page.page === 'movement-items' || page.page === 'movement-records'">
			<nav
				v-if="page.page === 'movement-items'"
				class="browse-tabs"
				aria-label="货物流动视图"
			>
				<button :aria-current="page.page === 'movement-items' ? 'page' : undefined">
					按物品</button
				><button @click="go('movement-records', 'completed')">按记录</button>
			</nav>
			<nav v-else class="browse-tabs" aria-label="流动记录状态">
				<button
					v-for="tab in [
						{ key: 'completed', label: '已提交' },
						{ key: 'draft', label: '草稿' },
						{ key: 'cancelled', label: '已取消' },
					]"
					:key="tab.key"
					:aria-current="page.variant === tab.key ? 'page' : undefined"
					@click="go('movement-records', tab.key)"
				>
					{{ tab.label }}
				</button>
			</nav>
			<div class="browse-toolbar">
				<label class="browse-search"
					><InventoryIcon name="search" /><input
						v-model="search"
						type="search"
						placeholder="搜索物品、单号或操作类型" /></label
				><select
					v-if="page.page === 'movement-items'"
					v-model="reviewSession.filters.movementItems.kind"
					aria-label="筛选流动类型"
				>
					<option value="">全部类型</option>
					<option
						v-for="kind in ['Receive', 'Issue', 'Transfer', 'Loan', 'Return']"
						:key="kind"
						:value="kind"
					>
						{{ movementLabel(kind) }}
					</option></select
				><select v-model="movementSort" aria-label="流动日期排序">
					<option value="newest">日期由新到旧</option>
					<option value="oldest">日期由旧到新</option></select
				><span class="browse-result-count"
					>{{
						page.page === "movement-items"
							? movementItems.length
							: movementRecords.length
					}}
					条</span
				>
			</div>
			<div class="browse-table-wrap">
				<table class="browse-table">
					<thead>
						<tr>
							<th>记录</th>
							<th>类型</th>
							<th>日期</th>
							<th>流向</th>
							<th>数量</th>
							<th>状态</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(row, index) in visibleMovements" :key="row.name + row.code">
							<td>
								<button class="browse-row-link" @click="openMovement(row.name)">
									<strong>{{
										page.page === "movement-records" ? row.name : row.itemName
									}}</strong
									><small>{{
										page.page === "movement-records"
											? `${reviewSession.movements.filter((line) => line.name === row.name).length} 行物品 · ${row.itemName}`
											: `${row.name} · ${row.code}`
									}}</small>
								</button>
							</td>
							<td>{{ movementLabel(row.kind) }}</td>
							<td>{{ row.date }}</td>
							<td>{{ row.from }} → {{ row.to }}</td>
							<td>
								{{
									page.page === "movement-records"
										? recordQuantities(row.name)
										: `${row.qty} ${row.uom}`
								}}
							</td>
							<td>
								<span
									class="browse-badge"
									:class="
										row.docstatus === 1
											? 'is-success'
											: row.docstatus === 2
												? 'is-neutral'
												: 'is-warning'
									"
									>{{
										formatStatus(
											row.docstatus === 1
												? "completed"
												: row.docstatus === 2
													? "cancelled"
													: "draft",
										)
									}}</span
								>
							</td>
						</tr>
					</tbody>
				</table>
				<div
					v-if="
						!(page.page === 'movement-items'
							? movementItems.length
							: movementRecords.length)
					"
					class="browse-empty compact"
				>
					<h2>没有找到记录</h2>
					<p>试试其他搜索词或状态。</p>
				</div>
			</div>
			<article
				v-if="
					page.page === 'movement-records' &&
					['detail', 'selected', 'opening', 'workspace-detail', 'entry-detail'].includes(
						page.variant,
					)
				"
				class="browse-detail-card"
			>
				<div class="browse-card-heading">
					<div>
						<span class="eyebrow">{{ currentMovement.name }}</span>
						<h2>{{ movementLabel(currentMovement.kind) }} 操作详情</h2>
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
						<dd>{{ currentMovement.itemName }} · {{ currentMovement.code }}</dd>
					</div>
					<div>
						<dt>数量</dt>
						<dd>{{ currentMovement.qty }} {{ currentMovement.uom }}</dd>
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
				<h2>操作明细</h2>
				<div
					v-for="(line, index) in reviewSession.movements.filter(
						(row) => row.name === currentMovement.name,
					)"
					:key="index"
					class="browse-rank-row"
				>
					<span>{{ line.itemName }} · {{ line.from }} → {{ line.to }}</span
					><strong>{{ line.qty }} {{ line.uom }}</strong>
				</div>
				<h2>附件</h2>
				<p class="browse-note">
					{{
						reviewSession.drafts
							.find((row) => row.name === currentMovement.name)
							?.attachments?.join("、") || "暂无附件"
					}}
				</p>
				<PreviewUiButton v-if="currentMovement.docstatus === 0" @click="editMovement"
					>继续编辑草稿</PreviewUiButton
				>
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
		</template>

		<template
			v-else-if="
				page.page === 'loan-items' ||
				page.page === 'loan-records' ||
				page.page === 'loan-detail'
			"
		>
			<nav v-if="page.page === 'loan-items'" class="browse-tabs" aria-label="借用明细状态">
				<button
					v-for="tab in [
						{ key: 'outstanding', label: '待归还' },
						{ key: 'returned', label: '已归还' },
						{ key: 'damaged', label: '损坏' },
						{ key: 'lost', label: '遗失' },
					]"
					:key="tab.key"
					:aria-current="page.variant === tab.key ? 'page' : undefined"
					@click="go('loan-items', tab.key)"
				>
					{{ tab.label }}</button
				><button @click="go('loan-records', 'open')">借用记录</button>
			</nav>
			<nav
				v-else-if="page.page === 'loan-records'"
				class="browse-tabs"
				aria-label="借用记录状态"
			>
				<button
					v-for="tab in [
						{ key: 'open', label: '未结清' },
						{ key: 'settled', label: '已结清' },
						{ key: 'draft', label: '草稿' },
					]"
					:key="tab.key"
					:aria-current="page.variant === tab.key ? 'page' : undefined"
					@click="go('loan-records', tab.key)"
				>
					{{ tab.label }}</button
				><button @click="go('loan-items', 'outstanding')">借用明细</button>
			</nav>
			<div v-if="page.page !== 'loan-detail'" class="browse-toolbar">
				<label class="browse-search"
					><InventoryIcon name="search" /><input
						v-model="search"
						type="search"
						placeholder="搜索借用人、活动或物品" /></label
				><span class="browse-result-count">{{ loanRows.length }} 笔借用</span>
			</div>
			<div v-if="page.page === 'loan-items'" class="browse-table-wrap">
				<table class="browse-table">
					<thead>
						<tr>
							<th>物品</th>
							<th>借用人 / 记录</th>
							<th>借出</th>
							<th>已归还</th>
							<th>损坏 / 遗失</th>
							<th>操作</th>
						</tr>
					</thead>
					<tbody>
						<template v-for="loan in loanRows" :key="loan.name"
							><tr v-for="line in loan.lines" :key="line.code">
								<td>
									<button class="browse-row-link" @click="openItem(line.code)">
										{{
											reviewSession.stock.find(
												(item) => item.code === line.code,
											)?.name
										}}
									</button>
								</td>
								<td>
									<button class="browse-row-link" @click="openLoan(loan.name)">
										{{ loan.borrower }}<small>{{ loan.name }}</small>
									</button>
								</td>
								<td>
									{{ line.qty }}
									{{
										reviewSession.stock.find((item) => item.code === line.code)
											?.uom
									}}
								</td>
								<td>{{ line.returned }}</td>
								<td>{{ line.damaged }} / {{ line.lost }}</td>
								<td>
									<PreviewUiButton
										v-if="loan.status === 'outstanding'"
										@click="createLoanReturn(loan.name)"
										>登记归还</PreviewUiButton
									><span v-else>{{ formatStatus(loan.status) }}</span>
								</td>
							</tr></template
						>
					</tbody>
				</table>
			</div>
			<div v-if="page.page === 'loan-records'" class="browse-grid browse-grid--two">
				<article
					v-for="loan in loanRows"
					:key="loan.name"
					class="browse-card browse-loan-card"
				>
					<button class="browse-card-main" @click="openLoan(loan.name)">
						<div class="browse-card-heading">
							<div>
								<span class="eyebrow">{{ loan.name }} · {{ loan.loanDate }}</span>
								<h2>{{ loan.borrower }}</h2>
							</div>
							<span
								class="browse-badge"
								:class="
									loan.status === 'outstanding'
										? 'is-warning'
										: loan.status === 'returned'
											? 'is-success'
											: 'is-danger'
								"
								>{{ formatStatus(loan.status) }}</span
							>
						</div>
						<p class="muted">{{ loan.activity || "未填写活动" }}</p>
						<div v-for="line in loan.lines" :key="line.code" class="browse-loan-line">
							<strong>{{
								reviewSession.stock.find((item) => item.code === line.code)
									?.name || line.code
							}}</strong
							><span
								>{{ line.qty }}
								{{
									reviewSession.stock.find((item) => item.code === line.code)
										?.uom
								}}
								· 已归还 {{ line.returned }} · 损坏 {{ line.damaged }} · 遗失
								{{ line.lost }}</span
							>
						</div>
					</button>
					<div class="browse-card-footer">
						<span>借出日期 {{ loan.loanDate }}</span
						><button class="browse-link" @click="openLoan(loan.name)">查看记录</button>
					</div>
				</article>
			</div>
			<article v-if="page.page === 'loan-detail'" class="browse-detail-card">
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
						>{{ formatStatus(currentLoan.status) }}</span
					>
				</div>
				<div v-for="line in currentLoan.lines" :key="line.code" class="browse-loan-line">
					<strong>{{
						reviewSession.stock.find((item) => item.code === line.code)?.name ||
						line.code
					}}</strong
					><span
						>借出 {{ line.qty }} · 归还 {{ line.returned }} · 损坏 {{ line.damaged }} ·
						遗失 {{ line.lost }}</span
					>
				</div>
				<h2>处理历史</h2>
				<p class="browse-note">
					{{ currentLoan.loanDate }} · 借用登记 · {{ formatStatus(currentLoan.status) }}
				</p>
				<h2>附件</h2>
				<p class="browse-note">暂无附件</p>
				<div v-if="currentLoan.status === 'outstanding'" class="browse-actions">
					<PreviewUiButton
						variant="primary"
						icon="loan"
						@click="createLoanReturn(currentLoan.name)"
						>登记归还</PreviewUiButton
					><PreviewUiButton @click="createLoanReturn(currentLoan.name, true)"
						>登记损坏处理</PreviewUiButton
					>
				</div>
			</article>
			<div
				v-if="page.page !== 'loan-detail' && !loanRows.length"
				class="browse-empty compact"
			>
				<h2>没有匹配的借用记录</h2>
				<p>当前筛选范围内没有记录。</p>
			</div>
		</template>

		<template v-else-if="page.page === 'warehouses' || page.page === 'warehouse-detail'">
			<div class="browse-toolbar">
				<label class="browse-search"
					><InventoryIcon name="search" /><input
						v-model="search"
						type="search"
						placeholder="搜索仓库、房间或位置" /></label
				><button
					v-if="page.page === 'warehouses'"
					class="browse-link"
					@click="newWarehouse"
				>
					+ 新建仓库
				</button>
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
					<button
						v-for="row in warehouseRows"
						:key="row.name"
						class="browse-tree-row"
						:class="{ 'is-selected': reviewSession.selectedWarehouse === row.name }"
						:style="{ '--tree-depth': row.parent ? 1 : 0 }"
						@click="reviewSession.selectedWarehouse = row.name"
					>
						<span class="browse-tree-type"
							><InventoryIcon
								:name="row.is_group ? 'warehouse' : 'location'" /></span
						><span class="browse-grow"
							><strong>{{ row.label }}</strong
							><small
								>{{ row.warehouse_type }} ·
								{{ row.is_group ? "分组" : "可存放库存" }}</small
							></span
						><button
							v-if="!row.is_group"
							class="browse-link"
							@click.stop="startWarehouseEdit(row)"
						>
							编辑
						</button>
					</button>
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
						<h2>位置库存详情</h2>
					</div>
					<button class="browse-link" @click="go('warehouses', 'edit')">编辑仓库</button>
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
				<p class="browse-note">仓库类型与是否为分组分别展示；分组节点不直接持有库存。</p>
				<h2>最近流动</h2>
				<div class="browse-rank-list">
					<button
						v-for="row in reviewSession.movements
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

		<template v-else-if="page.page === 'drafts'">
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
									<strong>{{ draft.name }}</strong
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
						<PreviewProduct :kind="activeItem.illustration" :name="activeItem.name" />
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
								<td>{{ batch.id }}</td>
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
					<button class="browse-link" @click="go('movement-items', 'filtered')">
						查看流动明细
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
				><label
					>上级节点<select v-model="warehouseParent" :disabled="!!warehouseEditName">
						<option
							v-for="row in reviewSession.warehouses.filter((row) => row.is_group)"
							:key="row.name"
							:value="row.name"
						>
							{{ row.label }}
						</option>
					</select></label
				><label
					>物理类型<select v-model="warehouseType" :disabled="!!warehouseEditName">
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
