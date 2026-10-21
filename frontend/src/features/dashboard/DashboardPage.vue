<script setup lang="ts">
import DashboardView from "./DashboardView.vue";
import { useDashboardController } from "./useDashboardController";
import type { ReportQuery } from "../../lib/reportContract";
import type { AppRouteTarget } from "../../lib/routeRegistry";
withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const emit = defineEmits<{
	browse: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
	openExport: [query: ReportQuery];
	navigate: [route: AppRouteTarget];
}>();
const controller = useDashboardController((query) => emit("browse", query));
defineExpose({ controller });
</script>
<template>
	<DashboardView
		:controller="controller"
		:active="active"
		@open-document="(doctype, name) => emit('openDocument', doctype, name)"
		@open-export="emit('openExport', $event)"
		@navigate="emit('navigate', $event)"
	/>
</template>
