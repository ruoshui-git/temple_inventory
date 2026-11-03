<script setup lang="ts">
import DataCell from "./DataCell.vue";
import type { DataColumn } from "../../lib/dataTable";
import { dataColumnKind } from "../../lib/dataTable";

// Muted `label value` pairs for one browse record, wrapping under a card's quantity or on line 2
// of a 列表 row. Callers choose the fields with partitionCardColumns. Codes, dates, statuses and
// chips read on their own, so their labels are kept for assistive technology only.
const props = withDefaults(
	defineProps<{
		fields: DataColumn[];
		row: Record<string, unknown>;
		variant?: "card" | "row";
		overflow?: number;
	}>(),
	{ variant: "card", overflow: 0 },
);

function valueOf(column: DataColumn) {
	return props.row[String(column.id)];
}
function plainText(value: unknown) {
	return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}
const bareKinds = new Set(["code", "date", "datetime", "time", "status", "chip"]);
/** A field the row carries with no value; cells computed from other row data are never "empty". */
function isEmpty(column: DataColumn) {
	const key = String(column.id);
	const value = props.row[key];
	return key in props.row && (value === null || value === undefined || value === "");
}
function fieldClass(column: DataColumn) {
	const kind = dataColumnKind(column);
	// A lone "—" means nothing, so an empty self-describing field keeps its label.
	return { "is-wide": kind === "chip", "is-bare": bareKinds.has(kind) && !isEmpty(column) };
}
</script>

<template>
	<template v-if="variant === 'card'">
		<dl v-if="fields.length" class="card-fields">
			<div
				v-for="column in fields"
				:key="String(column.id)"
				class="card-field"
				:class="fieldClass(column)"
			>
				<dt>{{ column.label }}</dt>
				<dd :title="plainText(valueOf(column))">
					<slot name="cell" :column="column" :row="row" :value="valueOf(column)">
						<DataCell :column="column" :value="valueOf(column)" empty-text="—" />
					</slot>
				</dd>
			</div>
		</dl>
		<p v-if="overflow > 0" class="card-fields-more">+{{ overflow }} 项</p>
	</template>
	<p v-else-if="fields.length || overflow > 0" class="card-fields-inline">
		<span
			v-for="column in fields"
			:key="String(column.id)"
			class="card-field-inline"
			:class="fieldClass(column)"
		>
			<span class="card-field-label">{{ column.label }}</span>
			<slot name="cell" :column="column" :row="row" :value="valueOf(column)">
				<DataCell :column="column" :value="valueOf(column)" empty-text="—" />
			</slot>
		</span>
		<span v-if="overflow > 0" class="card-field-inline card-fields-more"
			>+{{ overflow }} 项</span
		>
	</p>
</template>
