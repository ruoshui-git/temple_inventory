<script setup lang="ts">
import ReportsPage from "../features/export/ReportsPage.vue";
import { reportWorkspace, type ReportQuery } from "./reportModel";
import { provideGalleryReference } from "./fixtureReference";
import { ref, watch, onActivated } from "vue";
import { reviewSession } from "./reviewModel";
provideGalleryReference();
const props = withDefaults(defineProps<{ page: string; variant: string; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
}>();
const incoming = ref<ReportQuery>();
function enter() {
	if (reportWorkspace.incoming) {
		incoming.value = reportWorkspace.incoming;
		reportWorkspace.incoming = undefined;
	}
}
watch(() => props.variant, enter, { immediate: true });
onActivated(enter);
function openDocument(doctype: string, name: string) {
	if (doctype === "Stock Reconciliation") {
		reviewSession.selectedDraftName = name;
		emit("navigate", "reconciliation-form", "detail");
	} else {
		reviewSession.selectedMovementName = name;
		emit("navigate", "movement-records", "selected");
	}
}
</script>
<template>
	<ReportsPage
		:variant="variant"
		:active="active"
		:initial-query="incoming"
		@open-export="incoming = $event"
		@open-document="openDocument"
	/>
</template>
