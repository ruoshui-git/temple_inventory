<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import ExpiryBrowsePage from "../features/expiry/ExpiryBrowsePage.vue";
import { exportDestination } from "../lib/nativeNavigation";
import type { ReportQuery } from "../lib/reportContract";
const route = useRoute(),
	router = useRouter();
function changed(query: ReportQuery) {
	const encoded = JSON.stringify(query);
	if (route.query.query !== encoded) void router.replace({ query: { query: encoded } });
}
</script>

<template>
	<ExpiryBrowsePage
		:route-query="
			route.query.query === undefined
				? undefined
				: typeof route.query.query === 'string'
					? route.query.query
					: JSON.stringify(route.query.query)
		"
		@query-change="changed"
		@item="
			router.push({ path: `/item/${encodeURIComponent($event)}`, query: { tab: 'batches' } })
		"
		@new-operation="router.push(`/new/${$event}`)"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
