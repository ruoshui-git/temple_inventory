<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import OperationBrowsePage from "../features/movements/OperationBrowsePage.vue";
import {
	browseDestination,
	documentDestination,
	exportDestination,
} from "../lib/nativeNavigation";
import type { ReportQuery } from "../lib/reportContract";
const props = defineProps<{ family: "movements" | "loans" }>();
const route = useRoute(),
	router = useRouter();
const records = computed(() => route.path.endsWith("/records"));
const encodedQuery = computed(() =>
	route.query.query === undefined
		? undefined
		: typeof route.query.query === "string"
			? route.query.query
			: JSON.stringify(route.query.query),
);
function changed(query: ReportQuery) {
	const encoded = JSON.stringify(query);
	if (route.query.query !== encoded)
		void router.replace({ path: route.path, query: { query: encoded } });
}
function switchView(records: boolean, query: ReportQuery) {
	void router.push({
		path: `/${props.family}/${records ? "records" : "items"}`,
		query: { query: JSON.stringify(query) },
	});
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
		@open-loan="router.push(`/loans/${encodeURIComponent($event)}`)"
		@open-item="router.push(`/item/${encodeURIComponent($event)}`)"
		@settle="router.push({ path: '/new/Return', query: { loan: $event } })"
		@browse="router.push(browseDestination($event))"
		@open-export="router.push(exportDestination($event))"
		@new-operation="router.push(`/new/${$event}`)"
	/>
</template>
