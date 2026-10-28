<script setup lang="ts">
import { computed, ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import ActivitiesPage from "../features/activities/ActivitiesPage.vue";
import {
	documentDestination,
	exportDestination,
	operationDestination,
} from "../lib/nativeNavigation";
import {
	browseRouteTarget,
	browseRouteQuery,
	routeTarget,
	serializeBrowseQuery,
} from "../lib/routeRegistry";
import { useRouteBreadcrumbLabel } from "../lib/routeBreadcrumbLabel";
import type { ReportQuery } from "../lib/reportContract";
const route = useRoute(),
	router = useRouter();
const page = ref<InstanceType<typeof ActivitiesPage>>();
useRouteBreadcrumbLabel(() => page.value?.breadcrumbLabel());
onBeforeRouteLeave(() => page.value?.requestLeave() ?? true);
onBeforeRouteUpdate(() => page.value?.requestLeave() ?? true);
const mode = computed(() =>
	route.name === "activity-new" || route.name === "activity-edit"
		? "form"
		: route.params.name
			? "detail"
			: "list",
);
function navigate(mode: "list" | "detail" | "form", name?: string, query?: ReportQuery) {
	const encoded = query ? serializeBrowseQuery(query) : undefined;
	const target =
		mode === "list"
			? query
				? browseRouteTarget(query)
				: routeTarget("activities")
			: mode === "form"
				? name
					? routeTarget("activity-edit", { name })
					: routeTarget("activity-new")
				: routeTarget("activity-detail", { name: name || "" });
	void router.push({
		...target,
		query: query
			? {
					view: query.view,
					...(encoded ? { query: encoded } : {}),
				}
			: target.query,
	});
}
function changed(query: ReportQuery) {
	const encoded = serializeBrowseQuery(query);
	if (route.query.query !== encoded || route.query.view !== query.view)
		void router.replace({
			name: route.name!,
			params: route.params,
			query: {
				...route.query,
				view: query.view,
				...(encoded ? { query: encoded } : { query: undefined }),
			},
		});
}
</script>
<template>
	<ActivitiesPage
		ref="page"
		:mode="mode"
		:name="route.params.name ? String(route.params.name) : undefined"
		:route-query="browseRouteQuery(route.query.query, 'activities', route.query.view)"
		:recovery-id="typeof route.query.recovery === 'string' ? route.query.recovery : undefined"
		@navigate="navigate"
		@query-change="changed"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@new-movement="(kind, activity) => router.push(operationDestination(kind, { activity }))"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
