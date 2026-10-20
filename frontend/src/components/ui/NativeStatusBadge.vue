<script setup lang="ts">
import { computed } from "vue";
import { nativeStatusLabel } from "../../lib/nativeLabels";

const props = defineProps<{ status: unknown }>();
const tone = computed(() => {
	if (String(props.status) === "0") return "is-warning";
	if (String(props.status) === "1") return "is-success";
	if (String(props.status) === "2") return "is-danger";
	return "is-neutral";
});
</script>

<template>
	<span class="browse-badge" :class="tone">{{ nativeStatusLabel(status) }}</span>
</template>
