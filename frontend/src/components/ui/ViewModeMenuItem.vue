<script setup lang="ts">
import UiButton from "./UiButton.vue";
import type { BrowseView } from "../../composables/useBrowseViewMode";

// Phone document lists switch 列表/表格 from the page's "…" menu, so the switch never
// adds a row to the browse header. It names the layout it switches to.
const view = defineModel<BrowseView>({ required: true });
</script>

<template>
	<UiButton
		:icon="view === 'list' ? 'table' : 'list'"
		@click="view = view === 'list' ? 'table' : 'list'"
		>{{ view === "list" ? "以表格显示" : "以列表显示" }}</UiButton
	>
</template>
