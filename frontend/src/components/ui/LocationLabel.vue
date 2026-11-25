<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{ label?: string; title?: string }>(), {
	label: "",
	title: "",
});
// Split at the first slash only for truncation; site + "/" + remainder is always the label itself.
const slash = computed(() => props.label.indexOf("/"));
const site = computed(() => (slash.value > 0 ? props.label.slice(0, slash.value) : props.label));
const remainder = computed(() => (slash.value > 0 ? props.label.slice(slash.value + 1) : ""));
</script>

<template>
	<span class="location-label" :title="title || label" :aria-label="title || label">
		<span class="location-label-site">{{ site }}{{ remainder ? "/" : "" }}</span>
		<span v-if="remainder" class="location-label-tail" dir="rtl">
			<bdi>{{ remainder }}</bdi>
		</span>
	</span>
</template>
