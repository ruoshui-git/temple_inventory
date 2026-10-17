<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import PendingPage from "../features/pending/PendingPage.vue";
import type { ReportQuery } from "../lib/reportContract";
import type { InitialAllocation } from "../lib/routeSelection";
import { exportDestination } from "../lib/nativeNavigation";
const route = useRoute(),
	router = useRouter();
const encoded = computed(() =>
	route.query.query === undefined
		? undefined
		: typeof route.query.query === "string"
			? route.query.query
			: JSON.stringify(route.query.query),
);
function changed(value: ReportQuery) {
	const query = JSON.stringify(value);
	if (route.query.query !== query) void router.replace({ query: { query } });
}
function operation(kind: "Repair" | "Disposal", allocation: InitialAllocation) {
	void router.push({
		path: `/new/${kind}`,
		query: { allocations: JSON.stringify([allocation]), editor: crypto.randomUUID() },
	});
}
</script>
<template>
	<PendingPage
		:route-query="encoded"
		@query-change="changed"
		@operation="operation"
		@item="router.push(`/item/${encodeURIComponent($event)}`)"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
