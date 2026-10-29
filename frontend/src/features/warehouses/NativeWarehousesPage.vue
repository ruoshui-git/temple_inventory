<script setup lang="ts">
import NativeWarehousesView from "./NativeWarehousesView.vue";
import { useNativeWarehouses } from "./useNativeWarehouses";
import type { ReportQuery } from "../../lib/reportContract";
const props = withDefaults(
	defineProps<{
		name?: string;
		initialWarehouse?: string;
		initialSearch?: string;
		editName?: string;
		recoveryId?: string;
		active?: boolean;
		initialCreate?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	selection: [name: string, search: string];
	warehouse: [name: string];
	item: [code: string];
	back: [];
	browse: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
	openExport: [query: ReportQuery];
	newCount: [warehouse: string];
	newOperation: [kind: string, warehouse: string];
	saved: [];
}>();
const controller = useNativeWarehouses(
	props,
	(name, search) => emit("selection", name, search),
	() => emit("saved"),
	(name) => emit("warehouse", name),
);
defineExpose({ controller });
</script>
<template>
	<NativeWarehousesView
		:controller="controller"
		:detail="!!name"
		:active="active"
		@warehouse="emit('warehouse', $event)"
		@item="emit('item', $event)"
		@back="emit('back')"
		@browse="emit('browse', $event)"
		@open-document="(doctype, name) => emit('openDocument', doctype, name)"
		@open-loan="emit('openLoan', $event)"
		@open-export="emit('openExport', $event)"
		@new-count="emit('newCount', $event)"
		@new-operation="(kind, warehouse) => emit('newOperation', kind, warehouse)"
	/>
</template>
