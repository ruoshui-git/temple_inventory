<script setup lang="ts">
import { computed } from "vue";
import { presentWarehouse, type WarehouseRecord } from "../lib/warehousePresenter";

const props = defineProps<{
	name?: string | null;
	rows?: WarehouseRecord[];
	fallback?: string;
}>();

const knownSystemLabels: Record<string, string> = {
	借出: "借出",
	损坏待处理: "损坏待处理",
};
const presentation = computed(() => {
	const name = String(props.name || "");
	const rows = props.rows || [];
	const row = rows.find((item) => item.name === name);
	const value = presentWarehouse(row || { name }, rows);
	const role = String(row?.ti_system_role || row?.system_role || row?.warehouse_role || "");
	const isSystem =
		Boolean(row?.is_system || row?.system_warehouse || role) ||
		Object.keys(knownSystemLabels).some(
			(label) => value.storedLabel === label || value.localLabel === label,
		);
	const label =
		knownSystemLabels[value.localLabel] ||
		knownSystemLabels[value.storedLabel] ||
		value.localLabel ||
		props.fallback ||
		name ||
		"—";
	return { ...value, label, isSystem };
});
</script>

<template>
	<span
		class="movement-location"
		:class="{ 'movement-location-system': presentation.isSystem }"
		:title="presentation.breadcrumb"
		:data-warehouse="presentation.name"
	>
		<span v-if="presentation.isSystem" class="movement-location-mark" aria-hidden="true"
			>◆</span
		>
		{{ presentation.isSystem ? presentation.label : presentation.breadcrumb }}
	</span>
</template>

<style scoped>
.movement-location {
	display: inline-flex;
	max-width: 100%;
	align-items: baseline;
	gap: 5px;
	color: inherit;
}
.movement-location-system {
	padding-inline-start: 5px;
	border-inline-start: 2px solid #b67a38;
	color: #85511f;
	font-weight: 700;
}
.movement-location-mark {
	font-size: 8px;
	color: #b67a38;
}
</style>
