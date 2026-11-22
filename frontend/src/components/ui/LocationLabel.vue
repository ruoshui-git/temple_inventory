<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{ label?: string; title?: string }>(), {
	label: "",
	title: "",
});
const segments = computed(() => props.label.split(" / "));
const site = computed(() => segments.value[0] || props.label);
const remainder = computed(() => segments.value.slice(1).join(" / "));
</script>

<template>
	<span class="location-label" :title="title || label" :aria-label="title || label">
		<span class="location-label-site">{{ site }}{{ remainder ? " / " : "" }}</span>
		<span v-if="remainder" class="location-label-tail" dir="rtl">
			<bdi>{{ remainder }}</bdi>
		</span>
	</span>
</template>
