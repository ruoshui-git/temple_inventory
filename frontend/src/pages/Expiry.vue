<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import ExpiryBrowsePage from "../features/expiry/ExpiryBrowsePage.vue";
import { exportDestination } from "../lib/nativeNavigation";
import { operationDestination } from "../lib/nativeNavigation";
import { browseRouteTarget, restoreBrowseQueryPayload, routeTarget } from "../lib/routeRegistry";
import type { ReportQuery } from "../lib/reportContract";
const route = useRoute(),
	router = useRouter();
function changed(query: ReportQuery) {
	const target = browseRouteTarget(query);
	if (route.query.query !== target.query?.query || route.query.view !== target.query?.view)
		void router.replace(target);
}
</script>

<template>
	<ExpiryBrowsePage
		:route-query="restoreBrowseQueryPayload(route.query.query, 'expiry', route.query.view)"
		@query-change="changed"
		@item="
			router.push({
				...routeTarget('item-detail', { code: $event }),
				query: { tab: 'batches' },
			})
		"
		@open-batch="
			router.push({
				...routeTarget('batch-detail', { name: $event }),
				query: { back: route.fullPath },
			})
		"
		@new-operation="router.push(operationDestination($event))"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
