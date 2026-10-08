<script setup lang="ts">
import { useHistoryController } from "./useHistoryController";
import HistoryView from "./HistoryView.vue";

const props = defineProps<{ destination?: "movements" | "drafts" }>();
const controller = useHistoryController(props.destination || "movements");
const surface = controller.surface;
</script>

<template>
	<HistoryView :controller="controller" :surface="surface" />
</template>
