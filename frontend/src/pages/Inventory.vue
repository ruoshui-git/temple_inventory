<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import StockBrowsePage from "../features/inventory/StockBrowsePage.vue";
import { decodeReportQuery } from "../lib/reportQuery";
import type { ReportQuery } from "../lib/reportContract";
import { exportDestination } from "../lib/nativeNavigation";
import { countDestination, operationDestination } from "../lib/nativeNavigation";
import { browseRouteTarget, restoreBrowseQueryPayload, routeTarget } from "../lib/routeRegistry";
const route = useRoute(),
	router = useRouter();
const decoded = computed(() =>
	decodeReportQuery(
		restoreBrowseQueryPayload(route.query.query, "inventory", route.query.view),
		"inventory",
	),
);
const query = computed(() => decoded.value.query);
function changed(query: ReportQuery) {
	const target = browseRouteTarget(query);
	if (route.query.query !== target.query?.query || route.query.view !== target.query?.view)
		void router.replace(target);
}
</script>
<template>
	<StockBrowsePage
		:initial-query="query"
		:query-error="decoded.error"
		@query-change="changed"
		@clear-route="router.push(routeTarget('stock'))"
		@new-operation="
			(kind, codes) =>
				kind === 'Item'
					? router.push(
							routeTarget(
								'item-new',
								{},
								codes?.length ? { items: JSON.stringify(codes) } : {},
							),
						)
					: kind === 'Reconcile'
						? router.push(
								countDestination(
									codes?.length ? { items: JSON.stringify(codes) } : {},
								),
							)
						: router.push(
								operationDestination(
									kind,
									codes?.length ? { items: JSON.stringify(codes) } : {},
								),
							)
		"
		@open-item="(code) => router.push(routeTarget('item-detail', { code }))"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
