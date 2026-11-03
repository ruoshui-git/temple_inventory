<script setup lang="ts">
import { toRef } from "vue";
import LocationEndpoint from "../../components/ui/LocationEndpoint.vue";
import MultiLocationEndpoint from "../../components/ui/MultiLocationEndpoint.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import RecordRef from "../../components/ui/RecordRef.vue";
import UnitValues from "../../components/ui/UnitValues.vue";
import type { DataColumn } from "../../lib/dataTable";
import { loanReferenceIdentity } from "../../lib/relatedLoanPresentation";
import { enumPresentationLabel } from "../../lib/presentationLabels";
import type { OperationBrowse, OperationGroup } from "./useOperationBrowse";
import type { OperationCellHelpers } from "./operationColumns";

// One cell of the 货物流动/借用 record (单据) table. Cards and 列表 rows render the same cells
// through CardFields, so a field looks identical in every layout.
const props = defineProps<{
	column: DataColumn;
	row: Record<string, any>;
	controller: OperationBrowse;
	family: "movements" | "loans";
	helpers: OperationCellHelpers;
}>();
const c = props.controller;
const result = c.result;
const family = toRef(props, "family");
const {
	operationRow,
	operationLocationDetail,
	countedLocations,
	recordUnitRows,
	openedRecord,
	openedSettlement,
	relatedLoanNames,
	relatedLoanDetails,
	relatedSettlementRecords,
} = props.helpers;
</script>

<template>
	<template v-if="String(column.id).includes('_warehouse_')">{{
		operationLocationDetail(row, String(column.id)) || "—"
	}}</template>
	<button
		v-else-if="column.id === 'document'"
		class="browse-row-link"
		:disabled="result.stale"
		@click="openedRecord(row as unknown as OperationGroup)"
	>
		{{ row.document }}
	</button>
	<RecordRef
		v-else-if="column.id === 'related_loans' && relatedLoanNames(row).length"
		kind="Loan"
		:identity="
			loanReferenceIdentity(
				relatedLoanDetails(row)[0]?.borrower,
				relatedLoanDetails(row)[0]?.date,
			) ||
			relatedLoanNames(row)[0] ||
			''
		"
		:count="relatedLoanNames(row).length > 1 ? relatedLoanNames(row).length : undefined"
		:document-name="
			relatedLoanNames(row).length === 1
				? relatedLoanDetails(row)[0]?.name || relatedLoanNames(row)[0] || ''
				: ''
		"
		tooltip="查看原借出记录"
		:disabled="result.stale"
		@open="c.relatedLoans.show(relatedLoanNames(row))"
	/>
	<div v-else-if="column.id === 'related_settlements'" class="record-ref-list">
		<RecordRef
			v-for="record in relatedSettlementRecords(row)"
			:key="record.name"
			:kind="record.kind"
			:identity="record.name"
			:document-name="record.name"
			tooltip="查看结算记录"
			:disabled="result.stale"
			@open="openedSettlement(record.name)"
		/>
	</div>
	<template v-else-if="column.id === 'kind'">{{
		enumPresentationLabel("kind", row.kind)
	}}</template>
	<template v-else-if="column.id === 'borrower'">{{ row.borrower || "" }}</template>
	<template v-else-if="column.id === 'activity'">{{ row.activity_title || "" }}</template>
	<template v-else-if="column.id === 'activity_title'">{{ row.activity_title || "" }}</template>
	<template v-else-if="column.id === 'date'">{{ row.date }}</template>
	<UnitValues
		v-else-if="column.id === 'available_effect'"
		:entries="recordUnitRows(row, 'available_effects')"
		label="可用变化"
		signed
		class="operation-unit-summary"
	/>
	<template v-else-if="column.id === 'item_count'">{{ row.item_count ?? "" }}</template>
	<MultiLocationEndpoint
		v-else-if="column.id === 'source' && row.kind === 'Reconcile'"
		:locations="countedLocations(row)"
		kind="Reconcile"
		role="来源位置"
	/>
	<MultiLocationEndpoint
		v-else-if="column.id === 'source'"
		:locations="(operationRow(row).whole?.branches || []).map((branch) => branch.source)"
		:kind="String(row.kind || '')"
		:borrower="String(row.borrower || '')"
		role="来源位置"
	/>
	<LocationEndpoint
		v-else-if="column.id === 'destination' && row.kind === 'Reconcile'"
		kind="Reconcile"
		role="去向位置"
	/>
	<MultiLocationEndpoint
		v-else-if="column.id === 'destination'"
		:locations="(operationRow(row).whole?.branches || []).map((branch) => branch.destination)"
		:kind="String(row.kind || '')"
		:borrower="String(row.borrower || '')"
		role="去向位置"
	/>
	<UnitValues
		v-else-if="column.id === 'quantities'"
		:entries="recordUnitRows(row, 'flow_quantities')"
		label="流动数量"
		class="operation-unit-summary"
	/>
	<UnitValues
		v-else-if="column.id === 'outstanding' && row.docstatus === 1"
		:entries="recordUnitRows(row, 'outstanding')"
		label="未归还数量"
		class="operation-unit-summary"
	/>
	<div v-else-if="column.id === 'docstatus'" class="loan-record-status">
		<NativeStatusBadge :status="row.docstatus" />
	</div>
	<div v-else-if="column.id === 'status'" class="loan-record-status">
		<NativeStatusBadge :status="row.docstatus" /><span
			v-if="row.docstatus === 1 && row.kind === 'Loan'"
			>{{ enumPresentationLabel("loan_status", operationRow(row).whole?.loan_status) }}</span
		>
	</div>
</template>
