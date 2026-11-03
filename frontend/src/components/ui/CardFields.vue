<script setup lang="ts">
import DataCell from "./DataCell.vue";
import type { DataColumn } from "../../lib/dataTable";
import { dataColumnKind } from "../../lib/dataTable";

// Label/value pairs for one browse record: a two-column definition list in cards, and one
// muted inline line in 列表 rows. Callers choose the fields with partitionCardColumns.
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
function isWide(column: DataColumn) {
	return dataColumnKind(column) === "chip";
}
</script>

<template>
	<template v-if="variant === 'card'">
		<dl v-if="fields.length" class="card-fields">
			<div
				v-for="column in fields"
				:key="String(column.id)"
				class="card-field"
				:class="{ 'is-wide': isWide(column) }"
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
		<span v-for="column in fields" :key="String(column.id)" class="card-field-inline">
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
