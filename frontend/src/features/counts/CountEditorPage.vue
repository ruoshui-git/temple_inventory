<script setup lang="ts">
import type { ReportQuery } from "../../lib/reportContract";
import CountEditorView from "./CountEditorView.vue";
import { useCountEditor } from "./useCountEditor";
const props = withDefaults(
	defineProps<{
		name?: string;
		initialItems?: string[];
		warehouse?: string;
		recoveryId?: string;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	back: [];
	openExport: [query: ReportQuery];
	newCount: [];
	openDocument: [doctype: string, name: string];
}>();
const controller = useCountEditor(props);
defineExpose({ controller });
</script>
<template>
	<CountEditorView
		:controller="controller"
		@open-export="emit('openExport', $event)"
		:active="active"
		@back="emit('back')"
		@new-count="emit('newCount')"
		@open-document="(doctype, name) => emit('openDocument', doctype, name)"
	/>
</template>
