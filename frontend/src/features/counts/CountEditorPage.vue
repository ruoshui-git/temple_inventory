<script setup lang="ts">
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
const emit = defineEmits<{ back: []; newCount: [] }>();
const controller = useCountEditor(props);
defineExpose({ controller });
</script>
<template>
	<CountEditorView
		:controller="controller"
		:active="active"
		@back="emit('back')"
		@new-count="emit('newCount')"
	/>
</template>
