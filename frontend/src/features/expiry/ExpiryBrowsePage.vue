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
	newOperation: [kind: string];
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
		@new-operation="emit('newOperation', $event)"
		@open-export="emit('openExport', $event)"
	/>
</template>
