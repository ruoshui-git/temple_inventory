<script setup lang="ts">
import { computed, watch } from "vue";
import { installActivitiesReviewFixtures } from "./activitiesReviewFixtures";
import ActivitiesPage from "../features/activities/ActivitiesPage.vue";
import { provideGalleryReference } from "./fixtureReference";
import { activityQueries, activityUi } from "./activityUiState";
import { newReportQuery, type ReportQuery as NativeReportQuery } from "../lib/reportContract";
import { openFullReport, type ReportQuery } from "./reportModel";
import { createDraft, reviewSession, type OperationKind } from "./reviewModel";
provideGalleryReference();
const recoveryId = reviewSession.selectedRecoveryId;
reviewSession.selectedRecoveryId = undefined;
const props = withDefaults(defineProps<{ page: string; variant: string; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
}>();
watch(
	() => props.variant,
	(variant) => {
		if (variant === "large") installActivitiesReviewFixtures();
	},
	{ immediate: true },
);
const mode = computed(() =>
	props.page === "activity-form" ? "form" : props.page === "activity-detail" ? "detail" : "list",
);
const name = computed(() =>
	props.variant === "new"
		? undefined
		: props.variant.startsWith("edit-ACT-")
			? props.variant.slice(5)
			: props.variant.startsWith("ACT-")
				? props.variant
				: activityUi.selected,
);
const queryKey = computed(
	() => `${mode.value}/${mode.value === "list" ? props.variant : name.value || "new"}`,
);
const routeQuery = computed(() => {
	const query = activityQueries[queryKey.value];
	if (query) return JSON.stringify(query);
	if (mode.value === "list" && ["all", "archived"].includes(props.variant))
		return JSON.stringify({ ...newReportQuery("activities"), activityStatus: props.variant });
	return undefined;
});
function navigate(next: "list" | "detail" | "form", id?: string, query?: NativeReportQuery) {
	if (id) activityUi.selected = id;
	if (query) activityQueries[`${next}/${id || "active"}`] = query;
	emit(
		"navigate",
		`activity-${next}`,
		next === "form" ? (id ? `edit-${id}` : "new") : id || "active",
	);
}
function movement(kind: string, activity: string) {
	const draft = createDraft(kind as OperationKind);
	draft.activity = activity;
	reviewSession.selectedDraftName = draft.name;
	emit("navigate", "movement-form", kind);
}
function exportPage(query: ReportQuery) {
	openFullReport(query);
	emit("navigate", "reports", query.dataset);
}
function openDocument(doctype: string, id: string) {
	if (doctype === "Stock Reconciliation") {
		reviewSession.selectedDraftName = id;
		emit("navigate", "reconciliation-form", "detail");
	} else {
		reviewSession.selectedMovementName = id;
		emit("navigate", "movement-records", "selected");
	}
}
</script>
<template>
	<ActivitiesPage
		:mode="mode"
		:recovery-id="recoveryId"
		:name="mode === 'list' ? undefined : name"
		:active="active"
		:route-query="routeQuery"
		@navigate="navigate"
		@query-change="activityQueries[queryKey] = $event"
		@new-movement="movement"
		@open-document="openDocument"
		@open-export="exportPage"
	/>
</template>
