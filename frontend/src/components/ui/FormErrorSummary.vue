<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{
	errors: Record<string, string> | { field: string; message: string }[];
	title?: string;
}>();
const rows = computed(() =>
	Array.isArray(props.errors)
		? props.errors
		: Object.entries(props.errors).map(([field, message]) => ({ field, message })),
);
</script>
<template>
	<div v-if="rows.length" class="utility-error form-error-summary" role="alert">
		<strong>{{ title || "请修正以下内容后继续" }}</strong>
		<ul>
			<li v-for="item in rows" :key="item.field">{{ item.message }}</li>
		</ul>
	</div>
</template>
