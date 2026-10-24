<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import ReportsView from "./ReportsView.vue";
import { useExportWorkspaceController } from "./useReportController";
import type { ReportQuery } from "../../lib/reportContract";
import UiButton from "../../components/ui/UiButton.vue";
const props = withDefaults(
	defineProps<{
		variant?: string;
		active?: boolean;
		routeQuery?: string;
		initialQuery?: ReportQuery;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	queryChange: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
	newOperation: [kind: string];
}>();
const controller = useExportWorkspaceController(props, (query) => emit("queryChange", query));
defineExpose({ controller });
</script>
<template>
	<section v-if="controller.routeError.value" class="surface form-section">
		<PageHeader title="报表" />
		<p role="alert">{{ controller.routeError.value }}</p>
		<UiButton @click="controller.clear">恢复此数据集的默认范围</UiButton>
	</section>
	<ReportsView
		v-else
		:controller="controller"
		:active="active"
		@open-document="(doctype, name) => emit('openDocument', doctype, name)"
		@new-operation="emit('newOperation', $event)"
	/>
</template>
