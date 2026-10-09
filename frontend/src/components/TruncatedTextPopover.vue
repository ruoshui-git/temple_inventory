<script setup lang="ts">
import { computed } from "vue";
import DetailPopover from "./DetailPopover.vue";

const props = withDefaults(
	defineProps<{
		text?: string | null;
		label?: string;
		mobileLines?: number;
	}>(),
	{ text: "", label: "查看完整备注", mobileLines: 2 },
);
const hasText = computed(() => Boolean(props.text?.trim()));
</script>

<template>
	<span v-if="!hasText" class="truncated-text">—</span>
	<DetailPopover v-else :label="label" trigger-class="truncated-text-popover-trigger">
		<template #trigger
			><span class="truncated-text" :style="{ '--mobile-lines': mobileLines }">{{
				text
			}}</span></template
		>
		<p>{{ text }}</p>
	</DetailPopover>
</template>

<style scoped>
.truncated-text {
	display: -webkit-box;
	max-width: 180px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	-webkit-box-orient: vertical;
}
@media (max-width: 1023px) {
	.truncated-text {
		max-width: min(62vw, 250px);
		white-space: normal;
		-webkit-line-clamp: var(--mobile-lines);
	}
}
</style>
