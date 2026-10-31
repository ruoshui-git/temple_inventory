<script setup lang="ts">
import ExpiryBrowseView from "./ExpiryBrowseView.vue";
import { useExpiryBrowse } from "./useExpiryBrowse";
import type { ReportQuery } from "../../lib/reportContract";
const props = withDefaults(
	defineProps<{ initialQuery?: ReportQuery; routeQuery?: string; active?: boolean }>(),
	{ active: true },
);
const emit = defineEmits<{
	queryChange: [query: ReportQuery];
	item: [code: string];
	openBatch: [name: string];
	newOperation: [
		kind: "Receive" | "Issue" | "Transfer" | "Damage",
		allocations?: { item_code: string; warehouse: string; batch_no: string; qty: number }[],
	];
	openExport: [query: ReportQuery];
}>();
const controller = useExpiryBrowse(props, (query) => emit("queryChange", query));
defineExpose({ controller });
</script>
<template>
	<ExpiryBrowseView
		:controller="controller"
		:active="active"
		@item="emit('item', $event)"
		@open-batch="emit('openBatch', $event)"
		@new-operation="(kind, allocations) => emit('newOperation', kind, allocations)"
		@open-export="emit('openExport', $event)"
	/>
</template>
