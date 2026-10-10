<script setup lang="ts">
import { computed } from "vue";
import MovementLocation from "./MovementLocation.vue";
import type { WarehouseRecord } from "../lib/warehousePresenter";

const props = defineProps<{ row: any; rows?: WarehouseRecord[] }>();
const branches = computed(() =>
	Array.isArray(props.row.warehouse_flows) ? props.row.warehouse_flows : [],
);
const quantityLabel = (flow: any) =>
	(flow.quantities || [])
		.map((quantity: { qty: number; uom: string }) => `${quantity.qty} ${quantity.uom}`)
		.join(" · ");
function systemWarehouse(label: string) {
	return (
		props.rows?.find(
			(row) =>
				row.is_system &&
				(row.local_label === label || row.warehouse_name === label || row.label === label),
		)?.name || label
	);
}
const from = computed(() => {
	const names = props.row.source_warehouses?.length
		? props.row.source_warehouses
		: props.row.source_warehouse
			? [props.row.source_warehouse]
			: [];
	return names.length || props.row.movement_kind !== "Return"
		? names
		: [systemWarehouse("借出")];
});
const to = computed(() => {
	const names = props.row.destination_warehouses?.length
		? props.row.destination_warehouses
		: props.row.destination_warehouse
			? [props.row.destination_warehouse]
			: [];
	return names.length || props.row.movement_kind !== "Loan" ? names : [systemWarehouse("借出")];
});
</script>

<template>
	<span v-if="branches.length" class="movement-flow movement-flow-branches">
		<span
			v-for="(flow, index) in branches"
			:key="`${flow.source_warehouse}-${flow.destination_warehouse}-${index}`"
			class="movement-flow-branch"
		>
			<span class="movement-flow-branch-path">
				<MovementLocation :name="flow.source_warehouse" :rows="rows" />
				<span class="movement-flow-arrow" aria-hidden="true">→</span>
				<MovementLocation :name="flow.destination_warehouse" :rows="rows" />
			</span>
			<small v-if="flow.line_count || quantityLabel(flow)">
				{{ flow.line_count }} 项<span v-if="quantityLabel(flow)">
					· {{ quantityLabel(flow) }}</span
				>
			</small>
		</span>
	</span>
	<span v-else class="movement-flow">
		<span class="movement-flow-side">
			<MovementLocation
				v-for="name in from"
				:key="`from-${name}`"
				:name="name"
				:rows="rows"
			/>
			<span v-if="!from.length">—</span>
		</span>
		<span class="movement-flow-arrow" aria-hidden="true">→</span>
		<span class="movement-flow-side">
			<MovementLocation v-for="name in to" :key="`to-${name}`" :name="name" :rows="rows" />
			<span v-if="!to.length">—</span>
		</span>
	</span>
</template>

<style scoped>
.movement-flow {
	display: inline-flex;
	max-width: 100%;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 5px;
}
.movement-flow-branches {
	display: grid;
	gap: 5px;
}
.movement-flow-branch {
	display: grid;
	gap: 1px;
}
.movement-flow-branch-path {
	display: inline-flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 5px;
}
.movement-flow-branch > small {
	color: #756d63;
	font-size: 11px;
}
.movement-flow-side {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 4px;
}
.movement-flow-arrow {
	color: #8a7a6a;
}
</style>
