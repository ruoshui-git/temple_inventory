<script setup lang="ts">
import UiButton from "./UiButton.vue";

// Phone document lists switch 列表/表格 from the page's "…" menu, so the switch never
// adds a row to the browse header.
const view = defineModel<"card" | "table">({ required: true });
</script>

<template>
	<UiButton
		:icon="view === 'card' ? 'table' : 'list'"
		@click="view = view === 'card' ? 'table' : 'card'"
		>{{ view === "card" ? "以表格显示" : "以列表显示" }}</UiButton
	>
</template>
