<script setup lang="ts">
import OperationBrowseView from "./OperationBrowseView.vue";
import { useOperationBrowse } from "./useOperationBrowse";
import type { ReportQuery } from "../../lib/reportContract";
const props = withDefaults(
	defineProps<{
		family: "movements" | "loans";
		records: boolean;
		initialQuery?: ReportQuery;
		routeQuery?: string;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	queryChange: [query: ReportQuery];
	switchView: [records: boolean, query: ReportQuery];
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
	settle: [name: string];
	openItem: [code: string];
	browse: [query: ReportQuery];
	openExport: [query: ReportQuery];
	newOperation: [kind: string];
}>();
const controller = useOperationBrowse(props, (query) => emit("queryChange", query));
defineExpose({ controller });
</script>
<template>
	<OperationBrowseView
		:controller="controller"
		:family="family"
		:records="records"
		:active="active"
		@switch-view="(records, query) => emit('switchView', records, query)"
		@open-document="(doctype, name) => emit('openDocument', doctype, name)"
		@open-loan="emit('openLoan', $event)"
		@settle="emit('settle', $event)"
		@open-item="emit('openItem', $event)"
		@browse="emit('browse', $event)"
		@open-export="emit('openExport', $event)"
		@new-operation="emit('newOperation', $event)"
	/>
</template>
