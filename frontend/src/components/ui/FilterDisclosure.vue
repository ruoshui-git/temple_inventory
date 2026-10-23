<script setup lang="ts">
import DisclosureIcon from "./DisclosureIcon.vue";
withDefaults(
	defineProps<{
		label: string;
		summary?: string;
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
			<small>{{ summary }}</small>
		</summary>
		<slot />
	</details>
	<section v-else class="browse-filter-static" :data-filter-field="field">
		<h4>{{ label }}</h4>
		<slot />
	</section>
</template>
