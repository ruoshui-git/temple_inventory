<script setup lang="ts">
import { vTip } from "../../directives/tip";
import type { TooltipValue } from "../../lib/tooltip";
import DisclosureIcon from "./DisclosureIcon.vue";
withDefaults(
	defineProps<{
		label: string;
		summary?: string;
		summaryTip?: TooltipValue;
		field?: string;
		disclosure?: boolean;
	}>(),
	{ summary: "不限", disclosure: true },
);
</script>
<template>
	<details v-if="disclosure" class="browse-filter-disclosure" :data-filter-field="field">
		<summary>
			<DisclosureIcon variant="inline" />
			{{ label }}
			<small v-tip="summaryTip">{{ summary }}</small>
		</summary>
		<slot />
	</details>
	<section v-else class="browse-filter-static" :data-filter-field="field">
		<h4>{{ label }}</h4>
		<slot />
	</section>
</template>
<style scoped>
.browse-filter-disclosure :deep(.period-filter-heading),
.browse-filter-static :deep(.period-filter-heading) {
	display: none;
}
</style>
