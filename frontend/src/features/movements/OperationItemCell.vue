<script setup lang="ts">
import { RouterLink } from "vue-router";
import { toRef } from "vue";
import ItemImage from "../../components/ItemImage.vue";
import LocationEndpoint from "../../components/ui/LocationEndpoint.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import RecordRef from "../../components/ui/RecordRef.vue";
import UiButton from "../../components/ui/UiButton.vue";
import UnitText from "../../components/ui/UnitText.vue";
import type { DataColumn } from "../../lib/dataTable";
import { formatQuantity } from "../../lib/formatQuantity";
import { loanReferenceIdentity } from "../../lib/relatedLoanPresentation";
import { enumPresentationLabel } from "../../lib/presentationLabels";
import { routeTarget } from "../../lib/routeRegistry";
import { stockEffectLabel } from "../../lib/stockEffectLabel";
import type { OperationBrowse } from "./useOperationBrowse";
import type { OperationCellHelpers } from "./operationColumns";

// One cell of the 货物流动/借用 item (明细) table. Cards and 列表 rows render the same cells
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
	openHistoryDocument,
	recordEffect,
	recordEffectTone,
	recordEffectLabel,
	itemTotals,
	effectLabel,
	relatedLoanNames,
	relatedLoanDetails,
} = props.helpers;
</script>

<template>
	<template v-if="column.id === 'item_code'">{{ row.item_code || "" }}</template>
	<template v-else-if="column.id === 'category'">{{ row.category || "" }}</template>
	<template v-else-if="String(column.id).includes('_warehouse_')">{{
		operationLocationDetail(row, String(column.id)) || "—"
	}}</template>
	<template v-else-if="row.history_record">
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
		<template v-else-if="column.id === 'item_name'">{{
			row.item_name || row.item_code
		}}</template>
		<template v-else-if="column.id === 'kind'">{{
			enumPresentationLabel("kind", row.kind)
		}}</template>
		<template v-else-if="column.id === 'borrower'">{{ row.borrower || "" }}</template>
		<template v-else-if="column.id === 'activity_title'">{{
			row.activity_title || ""
		}}</template>
		<template v-else-if="column.id === 'available_effect'">
			<span
				:class="recordEffectTone(operationRow(row), String(row.stock_uom || ''))"
				:title="recordEffectLabel(operationRow(row), String(row.stock_uom || ''))"
			>
				{{
					recordEffect(operationRow(row), String(row.stock_uom || "")) > 0
						? "+"
						: recordEffect(operationRow(row), String(row.stock_uom || "")) < 0
							? "−"
							: ""
				}}{{
					formatQuantity(
						Math.abs(recordEffect(operationRow(row), String(row.stock_uom || ""))),
					)
				}}
				<UnitText :name="row.stock_uom" />
			</span>
		</template>
		<template v-else-if="column.id === 'date'">{{ row.date }}</template>
		<template v-else-if="column.id === 'borrowed'">
			{{
				row.signed && Number(row.quantity ?? row.stock_qty ?? row.borrowed) > 0
					? "+"
					: Number(row.quantity ?? row.stock_qty ?? row.borrowed) < 0
						? "−"
						: ""
			}}{{
				formatQuantity(
					Math.abs(Number(row.quantity ?? row.stock_qty ?? row.borrowed ?? 0)),
				)
			}}
			<UnitText :name="row.stock_uom" />
		</template>
		<template
			v-else-if="
				column.id === 'outstanding' && row.kind === 'Loan' && row.outstanding != null
			"
		>
			<UnitText :name="row.stock_uom" :qty="Number(row.outstanding)" />
		</template>
		<LocationEndpoint
			v-else-if="column.id === 'source'"
			:warehouse="String(row.source_warehouse || row.warehouse || '')"
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
						? recordEffectTone(operationRow(row), String(row.stock_uom || ''))
						: 'operation-total'
				"
				:title="
					family === 'movements'
						? recordEffectLabel(operationRow(row), String(row.stock_uom || ''))
						: undefined
				"
			>
				{{
					row.signed && Number(row.quantity ?? row.stock_qty) > 0
						? "+"
						: Number(row.quantity ?? row.stock_qty) < 0
							? "−"
							: ""
				}}{{ formatQuantity(Math.abs(Number(row.quantity ?? row.stock_qty ?? 0))) }}
				<UnitText :name="row.stock_uom" />
			</span>
			<span v-if="family === 'movements'" class="sr-only">{{
				recordEffectLabel(operationRow(row), String(row.stock_uom || ""))
			}}</span>
		</template>
		<NativeStatusBadge v-else-if="column.id === 'docstatus'" :status="row.docstatus" />
		<div v-else-if="column.id === 'status'" class="loan-record-status">
			<NativeStatusBadge :status="row.docstatus" /><span
				v-if="row.docstatus === 1 && row.kind === 'Loan'"
				>{{
					enumPresentationLabel("loan_status", operationRow(row).whole?.loan_status)
				}}</span
			>
		</div>
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
		<template v-else-if="column.id === 'kind'">{{ row.category || "物品汇总" }}</template>
		<template v-else-if="column.id === 'borrower'">{{ row.borrower || "" }}</template>
		<template v-else-if="column.id === 'activity_title'">{{
			row.activity_title || ""
		}}</template>
		<template v-else-if="column.id === 'available_effect'">{{
			row.available_effect == null
				? ""
				: stockEffectLabel(Number(row.available_effect), row.stock_uom)
		}}</template>
		<div v-else-if="column.id === 'quantities'" class="operation-item-totals">
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
						? effectLabel(metric.effect, metric.quantity.uom, metric.quantity.status)
						: undefined
				"
				>{{ metric.label }}
				<UnitText :name="metric.quantity.uom" :qty="metric.quantity.qty" /><small
					v-if="metric.quantity.status"
				>
					· {{ metric.quantity.status }}</small
				></span
			>
		</div>
		<div
			v-else-if="column.id === 'actions' || column.id === 'related_loans'"
			class="browse-row-actions"
		>
			<UiButton
				:disabled="result.stale"
				@click="c.toggle(operationRow(row), !c.expanded.has(String(row.id)))"
				>{{ c.expanded.has(String(row.id)) ? "收起历史" : "查看历史" }}</UiButton
			>
		</div>
	</template>
</template>
