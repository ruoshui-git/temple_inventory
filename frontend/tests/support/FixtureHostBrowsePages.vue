<script setup lang="ts">
import { computed, onActivated, ref, watch } from "vue";
import ProductDetailPage from "../../src/features/items/ProductDetailPage.vue";
import PendingPage from "../../src/features/pending/PendingPage.vue";
import LoanDetailPage from "../../src/features/loans/LoanDetailPage.vue";
import OperationEditorPage from "../../src/features/documents/OperationEditorPage.vue";
import CountEditorPage from "../../src/features/counts/CountEditorPage.vue";
import PreviewNativeRecords from "./FixtureHostNativeRecords.vue";
import PreviewNativeWarehouses from "./FixtureHostNativeWarehouses.vue";
import PreviewExpiryBrowse from "./FixtureHostExpiryBrowse.vue";
import PreviewActivityBrowse from "./FixtureHostActivityBrowse.vue";
import PreviewDashboard from "./FixtureHostDashboard.vue";
import { newReportQuery, type ReportQuery } from "../../src/lib/reportContract";
import { openFullReport } from "./reportModel";
import { provideGalleryReference } from "./fixtureReference";
import {
	getPreviewPage,
	reviewSession,
	type PreviewPage,
	type PreviewPageKey,
} from "./reviewModel";
provideGalleryReference();
const props = withDefaults(defineProps<{ route: PreviewPageKey; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	navigate: [page: PreviewPage, variant: string];
	notify: [message: string];
}>();
const page = computed(() => getPreviewPage(props.route)!);
const movementDetail = computed(
	() =>
		page.value.page === "movement-records" &&
		["detail", "selected", "opening", "workspace-detail", "entry-detail"].includes(
			page.value.variant,
		),
);
const movementName = computed(
	() =>
		({
			opening: "MAT-RECO-2026-00014",
			"workspace-detail": "MAT-STE-2026-00017",
			"entry-detail": "MAT-STE-2026-00003",
			selected: reviewSession.selectedMovementName || "MAT-STE-2026-00009",
		})[page.value.variant] || "MAT-STE-2026-00012",
);
const loanName = computed(() =>
	page.value.variant === "selected"
		? reviewSession.selectedLoanName
		: { returned: "MAT-STE-2026-00005", damaged: "MAT-STE-2026-00006" }[page.value.variant] ||
			"MAT-STE-2026-00004",
);
const pendingQuery = ref(newReportQuery("inventory"));
function restorePendingQuery() {
	if (page.value.page !== "pending") return;
	const query: ReportQuery = JSON.parse(
		JSON.stringify(reviewSession.nativePendingQuery || newReportQuery("inventory")),
	);
	query.view = "locations";
	query.damageOnly = true;
	query.scope = JSON.parse(JSON.stringify(reviewSession.filters.pending.scope));
	if (page.value.variant === "empty") query.search = "无匹配损坏物品";
	pendingQuery.value = query;
}
watch(() => props.route, restorePendingQuery, { immediate: true });
onActivated(restorePendingQuery);
function go(next: string, variant: string) {
	emit("navigate", next as PreviewPage, variant);
}
function exportPage(query: ReportQuery) {
	openFullReport(query);
	go("reports", query.dataset);
}
function openDocument(doctype: string, name: string) {
	if (doctype === "Stock Reconciliation") {
		reviewSession.selectedDraftName = name;
		go("reconciliation-form", "detail");
	} else {
		reviewSession.selectedMovementName = name;
		go("movement-records", "selected");
	}
}
function openItem(code: string) {
	reviewSession.selectedItemCode = code;
	go("item-detail", "overview");
}
function openLoan(name: string) {
	if (reviewSession.loans.find((row) => row.name === name)?.status === "draft") {
		reviewSession.selectedDraftName = name;
		go("movement-form", "Loan");
	} else {
		reviewSession.selectedLoanName = name;
		go("loan-detail", "selected");
	}
}
function settle(name: string, damaged = false, kind: "Return" | "Loss" = "Return") {
	reviewSession.selectedLoanName = name;
	reviewSession.selectedSettlementLoan = name;
	reviewSession.selectedDraftName = "";
	reviewSession.selectedReturnOutcome = damaged ? "damaged" : "returned";
	go("movement-form", kind);
}
function browse(query: ReportQuery) {
	if (query.dataset === "loans") {
		reviewSession.filters.loanScope = query.scope;
		go("loan-records", "all");
	} else {
		reviewSession.filters.movementScope = query.scope;
		go("movement-records", "completed");
	}
}
</script>
<template>
	<PreviewDashboard
		v-if="page.page === 'dashboard'"
		:active="active"
		@navigate="go"
		@movement="openDocument('Stock Entry', $event)"
		@loan="openLoan"
	/>
	<ProductDetailPage
		v-else-if="page.page === 'item-detail'"
		:code="reviewSession.selectedItemCode"
		:tab="page.variant"
		:active="active"
		@back="go('inventory', 'list')"
		@edit="go('item-form', 'edit')"
		@tab="go('item-detail', $event)"
		@open-document="openDocument"
		@open-export="exportPage"
		@browse="browse"
	/>
	<PreviewNativeWarehouses
		v-else-if="page.page === 'warehouses' || page.page === 'warehouse-detail'"
		:detail="page.page === 'warehouse-detail'"
		:active="active"
		:create="page.variant === 'create'"
		@navigate="go"
	/>
	<PreviewNativeRecords
		v-else-if="page.page === 'drafts' || page.page === 'counts'"
		:mode="page.page"
		:variant="page.variant"
		:active="active"
		@navigate="go"
	/>
	<PendingPage
		v-else-if="page.page === 'pending'"
		:initial-query="pendingQuery"
		:active="active"
		@query-change="
			(query) => {
				reviewSession.nativePendingQuery = JSON.parse(JSON.stringify(query));
				reviewSession.filters.pending.scope = query.scope;
			}
		"
		@item="openItem"
		@operation="
			(kind, allocation) => {
				reviewSession.selectedAllocations = [allocation];
				reviewSession.selectedDraftName = '';
				reviewSession.selectedLoanName = '';
				reviewSession.selectedItems = [];
				go('movement-form', kind);
			}
		"
		@open-export="exportPage"
	/>
	<PreviewExpiryBrowse
		v-else-if="page.page === 'expiry'"
		:variant="page.variant"
		:active="active"
		@navigate="go"
	/>
	<LoanDetailPage
		v-else-if="
			page.page === 'loan-detail' ||
			(page.page === 'loan-records' && page.variant === 'detail')
		"
		:name="loanName"
		:active="active"
		@back="go('loan-records', 'all')"
		@item="openItem"
		@activity="go('activity-detail', $event)"
		@open-document="openDocument"
		@open-export="exportPage"
		@settle="
			(name, action) =>
				settle(name, action === 'damaged', action === 'lost' ? 'Loss' : 'Return')
		"
	/>
	<CountEditorPage
		v-else-if="movementDetail && page.variant === 'opening'"
		:name="movementName"
		:active="active"
		@back="go('movement-records', 'completed')"
	/>
	<OperationEditorPage
		v-else-if="movementDetail"
		:key="movementName"
		:identity="{ doctype: 'Stock Entry', name: movementName }"
		:active="active"
		@back="go('movement-records', 'completed')"
	/>
	<PreviewActivityBrowse
		v-else
		:family="page.page.startsWith('movement') ? 'movement' : 'loan'"
		:records="page.page.endsWith('records')"
		:variant="page.variant"
		@navigate="go"
		@movement="openDocument('Stock Entry', $event)"
		@loan="openLoan"
		@return="settle"
		@notify="emit('notify', $event)"
	/>
</template>
