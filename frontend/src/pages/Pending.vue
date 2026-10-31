<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import PendingPage from "../features/pending/PendingPage.vue";
import type { ReportQuery } from "../lib/reportContract";
import type { InitialAllocation } from "../lib/routeSelection";
import { exportDestination, operationDestination } from "../lib/nativeNavigation";
import { browseRouteQuery, browseRouteTarget, routeTarget } from "../lib/routeRegistry";
const route = useRoute(),
	router = useRouter();
const encoded = computed(() => browseRouteQuery(route.query.query, "inventory", route.query.view));
function changed(value: ReportQuery) {
	const target = browseRouteTarget(value);
	if (route.query.query !== target.query?.query || route.query.view !== target.query?.view)
		void router.replace(target);
}
function operation(kind: "Repair" | "Disposal", allocations: InitialAllocation[]) {
	void router.push(
		operationDestination(kind, {
			allocations: JSON.stringify(allocations),
			editor: crypto.randomUUID(),
		}),
	);
}
</script>
<template>
	<PendingPage
		:route-query="encoded"
		@query-change="changed"
		@operation="operation"
		@item="router.push(routeTarget('item-detail', { code: $event }))"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
