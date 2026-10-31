<script setup lang="ts">
import PendingView from "./PendingView.vue";
import { usePendingController } from "./usePendingController";
import type { ReportQuery } from "../../lib/reportContract";
import type { InitialAllocation } from "../../lib/routeSelection";
const props = withDefaults(
	defineProps<{ initialQuery?: ReportQuery; routeQuery?: string; active?: boolean }>(),
	{ active: true },
);
const emit = defineEmits<{
	item: [code: string];
	operation: [kind: "Repair" | "Disposal", allocations: InitialAllocation[]];
	queryChange: [query: ReportQuery];
	openExport: [query: ReportQuery];
}>();
const controller = usePendingController(props, (value) => emit("queryChange", value));
defineExpose({ controller });
</script>
<template>
	<PendingView
		:controller="controller"
		:active="active"
		@item="emit('item', $event)"
		@operation="(kind, allocations) => emit('operation', kind, allocations)"
		@open-export="emit('openExport', $event)"
	/>
</template>
