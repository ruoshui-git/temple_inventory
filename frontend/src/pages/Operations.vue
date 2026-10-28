<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import OperationBrowsePage from "../features/movements/OperationBrowsePage.vue";
import {
	browseDestination,
	documentDestination,
	exportDestination,
	browseStateDestination,
	operationDestination,
} from "../lib/nativeNavigation";
import type { ReportQuery } from "../lib/reportContract";
import { browseRouteQuery, routeTarget } from "../lib/routeRegistry";
const props = defineProps<{ family: "movements" | "loans" }>();
const route = useRoute(),
	router = useRouter();
const records = computed(() => route.query.view === "records");
const encodedQuery = computed(() =>
	browseRouteQuery(route.query.query, props.family, route.query.view),
);
function changed(query: ReportQuery) {
	const target = browseStateDestination(
		props.family,
		records.value ? "records" : "items",
		query,
	);
	if (route.query.query !== target.query?.query)
		void router.replace({ ...target, query: { ...route.query, ...target.query } });
}
function switchView(records: boolean, query: ReportQuery) {
	void router.push(browseStateDestination(props.family, records ? "records" : "items", query));
}
</script>
<template>
	<OperationBrowsePage
		:family="family"
		:records="records"
		:route-query="encodedQuery"
		@query-change="changed"
		@switch-view="switchView"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@open-loan="router.push(routeTarget('loan-overview', { name: $event }))"
		@open-item="router.push(routeTarget('item-detail', { code: $event }))"
		@settle="router.push(operationDestination('Return', { loan: $event }))"
		@browse="router.push(browseDestination($event))"
		@open-export="router.push(exportDestination($event))"
		@new-operation="router.push(operationDestination($event))"
	/>
</template>
