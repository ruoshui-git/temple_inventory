<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import ReportsPage from "../features/export/ReportsPage.vue";
import { documentDestination, exportDestination } from "../lib/nativeNavigation";
import type { ReportQuery } from "../lib/reportContract";
import { routeTarget } from "../lib/routeRegistry";
const route = useRoute(),
	router = useRouter();
function changed(query: ReportQuery) {
	const encoded = JSON.stringify(query);
	if (route.query.query !== encoded)
		void router.replace({ ...routeTarget("reports"), query: { query: encoded } });
}
</script>
<template>
	<ReportsPage
		:route-query="
			route.query.query === undefined
				? undefined
				: typeof route.query.query === 'string'
					? route.query.query
					: '{'
		"
		@query-change="changed"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
