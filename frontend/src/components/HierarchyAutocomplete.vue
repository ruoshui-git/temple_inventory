<script setup lang="ts">
import HierarchyFilter, { type HierarchyFilterNode } from "./HierarchyFilter.vue";

withDefaults(
	defineProps<{
		modelValue: string[];
		options: HierarchyFilterNode[];
		placeholder: string;
		title: string;
		embedded?: boolean;
		tree?: HierarchyFilterNode[];
	}>(),
	{ embedded: false, tree: () => [] },
);
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();
</script>

<template>
	<HierarchyFilter v-bind="$props" @update:model-value="emit('update:modelValue', $event)" />
</template>
