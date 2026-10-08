<script setup lang="ts">
import HistoryPage from "../features/history/HistoryPage.vue";

const props = defineProps<{
	destination?: "movements" | "adjustments" | "drafts";
}>();
</script>

<template><HistoryPage v-bind="props" /></template>
