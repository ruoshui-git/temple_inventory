<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import StockBrowsePage from "../features/inventory/StockBrowsePage.vue";
import { decodeReportQuery } from "../lib/reportQuery";
import type { ReportQuery } from "../lib/reportContract";
import { exportDestination } from "../lib/nativeNavigation";
const route = useRoute(),
	router = useRouter();
const decoded = computed(() => decodeReportQuery(route.query.query));
const query = computed(() => decoded.value.query);
function changed(query: ReportQuery) {
	const encoded = JSON.stringify(query);
	if (route.query.query !== encoded)
		void router.replace({ path: route.path, query: { query: encoded } });
}
</script>
<template>
	<StockBrowsePage
		:initial-query="query"
		:query-error="decoded.error"
		@query-change="changed"
		@clear-route="router.push('/stock')"
		@new-operation="
			(kind, codes) =>
				router.push({
					path:
						kind === 'Item'
							? '/items/new'
							: kind === 'Reconcile'
								? '/reconcile/new'
								: `/new/${kind}`,
					query: codes?.length ? { items: JSON.stringify(codes) } : {},
				})
		"
		@open-item="(code) => router.push(`/item/${encodeURIComponent(code)}`)"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
