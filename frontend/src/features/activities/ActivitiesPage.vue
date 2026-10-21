<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import { ref } from "vue";
import ActivitiesView from "./ActivitiesView.vue";
import { useActivitiesController } from "./useActivitiesController";
import type { ReportQuery } from "../../lib/reportContract";
import UiButton from "../../components/ui/UiButton.vue";
const view = ref<InstanceType<typeof ActivitiesView>>();
const props = withDefaults(
	defineProps<{
		mode: "list" | "detail" | "form";
		name?: string;
		routeQuery?: string;
		recoveryId?: string;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	navigate: [mode: "list" | "detail" | "form", name?: string, query?: ReportQuery];
	queryChange: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
	newMovement: [kind: string, activity: string];
	openExport: [query: ReportQuery];
}>();
const controller = useActivitiesController(
	props,
	(mode, name, query) => emit("navigate", mode, name, query),
	(doctype, name) => emit("openDocument", doctype, name),
	(kind, activity) => emit("newMovement", kind, activity),
	(query) => emit("queryChange", query),
);
defineExpose({
	controller,
	requestLeave: () => view.value?.requestLeave() ?? Promise.resolve(true),
	breadcrumbLabel: () => view.value?.breadcrumbLabel(),
});
</script>
<template>
	<section v-if="controller.scopeError.value" class="surface form-section">
		<PageHeader title="活动" />
		<p role="alert">{{ controller.scopeError.value }}</p>
		<UiButton @click="controller.resetScope">恢复活动默认范围</UiButton>
	</section>
	<ActivitiesView
		v-else
		ref="view"
		:controller="controller"
		:mode="mode"
		:name="name"
		:recovery-id="recoveryId"
		:active="active"
		@open-export="emit('openExport', $event)"
	/>
</template>
