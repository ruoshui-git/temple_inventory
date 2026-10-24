<script setup lang="ts">
import NativeRecordsView from "./NativeRecordsView.vue";
import { useNativeRecords } from "./useNativeRecords";
import type { ReportQuery } from "../../lib/reportContract";
import type { RecoverySnapshot } from "../../lib/browserRecovery";
const props = withDefaults(
	defineProps<{
		mode: "drafts" | "counts";
		initialQuery?: ReportQuery;
		routeQuery?: string;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	queryChange: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
	recover: [entry: RecoverySnapshot];
	newCount: [];
	openExport: [query: ReportQuery];
	newOperation: [kind: string];
}>();
const controller = useNativeRecords(props, (query) => emit("queryChange", query));
defineExpose({ controller });
</script>
<template>
	<NativeRecordsView
		:controller="controller"
		:mode="mode"
		:active="active"
		@open-document="(doctype, name) => emit('openDocument', doctype, name)"
		@recover="emit('recover', $event)"
		@new-count="emit('newCount')"
		@open-export="emit('openExport', $event)"
		@new-operation="emit('newOperation', $event)"
	/>
</template>
