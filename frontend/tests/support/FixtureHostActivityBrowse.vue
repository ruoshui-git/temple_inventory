<script setup lang="ts">
import { computed, onActivated, ref, watch } from "vue";
import OperationBrowsePage from "../../src/features/movements/OperationBrowsePage.vue";
import { newReportQuery, type ReportQuery } from "../../src/lib/reportContract";
import { provideGalleryReference } from "./fixtureReference";
import { reviewSession, type PreviewPage } from "./reviewModel";
import { openFullReport } from "./reportModel";
provideGalleryReference();
const props = defineProps<{ family: "movement" | "loan"; records: boolean; variant: string }>();
const emit = defineEmits<{
	navigate: [page: PreviewPage, variant: string];
	movement: [name: string];
	loan: [name: string];
	return: [name: string];
	notify: [message: string];
}>();
const family = computed(() =>
	props.family === "movement" ? ("movements" as const) : ("loans" as const),
);
const initial = ref<ReportQuery>(newReportQuery(family.value));
const queries = (reviewSession.nativeBrowseQueries ||= {});
const key = () => `${family.value}/${props.records ? "records" : "items"}`;
function enter(applyVariant = false) {
	const query = JSON.parse(
		JSON.stringify(queries[key()] || newReportQuery(family.value)),
	) as ReportQuery;
	query.scope = JSON.parse(
		JSON.stringify(
			props.family === "movement"
				? reviewSession.filters.movementScope
				: reviewSession.filters.loanScope,
		),
	);
	query.search =
		props.family === "movement"
			? reviewSession.filters.movementItems.search
			: reviewSession.filters.loanItems.search;
	query.view = props.records ? "records" : props.family === "movement" ? "summary" : "outcomes";
	query.sortBy = props.records ? "date" : "item_name";
	query.sort = query.sortBy === "date" ? "desc" : "asc";
	if (applyVariant) {
		if (props.family === "movement")
			query.statuses = [
				props.variant === "draft" ? 0 : props.variant === "cancelled" ? 2 : 1,
			];
		else if (props.records) {
			query.statuses = props.variant === "draft" ? [0] : [1];
			query.loanStatus = ["open", "settled"].includes(props.variant) ? props.variant : "all";
		} else
			query.loanOutcome = ["outstanding", "returned", "damaged", "lost"].includes(
				props.variant,
			)
				? props.variant
				: "all";
	}
	initial.value = query;
}
watch(
	() => [props.family, props.records, props.variant],
	() => enter(true),
	{ immediate: true },
);
onActivated(() => enter());
function changed(query: ReportQuery) {
	queries[key()] = JSON.parse(JSON.stringify(query));
	const filters = reviewSession.filters;
	if (props.family === "movement") {
		filters.movementScope = JSON.parse(JSON.stringify(query.scope));
		filters.movementItems.search = query.search;
	} else {
		filters.loanScope = JSON.parse(JSON.stringify(query.scope));
		filters.loanItems.search = query.search;
	}
}
function switchView(records: boolean, query: ReportQuery) {
	queries[`${family.value}/${records ? "records" : "items"}`] = query;
	emit(
		"navigate",
		props.family === "movement"
			? records
				? "movement-records"
				: "movement-items"
			: records
				? "loan-records"
				: "loan-items",
		props.family === "movement"
			? records
				? "completed"
				: "list"
			: records
				? "all"
				: "outstanding",
	);
}
</script>
<template>
	<OperationBrowsePage
		:family="family"
		:records="records"
		:initial-query="initial"
		@query-change="changed"
		@switch-view="switchView"
		@open-document="(_doctype, name) => emit('movement', name)"
		@open-loan="emit('loan', $event)"
		@settle="emit('return', $event)"
		@open-item="
			(code) => {
				reviewSession.selectedItemCode = code;
				emit('navigate', 'item-detail', 'overview');
			}
		"
		@open-export="
			(query) => {
				openFullReport(query);
				emit('navigate', 'reports', query.dataset);
			}
		"
		@browse="
			(query) => {
				reviewSession.filters.movementScope = query.scope;
				reviewSession.filters.movementItems.search = query.search;
				emit('navigate', 'movement-records', 'completed');
			}
		"
		@new-operation="emit('navigate', 'movement-form', $event)"
	/>
</template>
