<script setup lang="ts">
import { computed, ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import ActivitiesPage from "../features/activities/ActivitiesPage.vue";
import { documentDestination, exportDestination } from "../lib/nativeNavigation";
import type { ReportQuery } from "../lib/reportContract";
const route = useRoute(),
	router = useRouter();
const page = ref<InstanceType<typeof ActivitiesPage>>();
onBeforeRouteLeave(() => page.value?.requestLeave() ?? true);
onBeforeRouteUpdate(() => page.value?.requestLeave() ?? true);
const mode = computed(() =>
	route.path.endsWith("/new") || route.path.endsWith("/edit")
		? "form"
		: route.params.name
			? "detail"
			: "list",
);
function navigate(mode: "list" | "detail" | "form", name?: string, query?: ReportQuery) {
	const path =
		mode === "list"
			? "/activities"
			: mode === "form"
				? name
					? `/activities/${encodeURIComponent(name)}/edit`
					: "/activities/new"
				: `/activities/${encodeURIComponent(name || "")}`;
	void router.push({ path, query: query ? { query: JSON.stringify(query) } : {} });
}
function changed(query: ReportQuery) {
	const encoded = JSON.stringify(query);
	if (route.query.query !== encoded)
		void router.replace({ path: route.path, query: { ...route.query, query: encoded } });
}
</script>
<template>
	<ActivitiesPage
		ref="page"
		:mode="mode"
		:name="route.params.name ? String(route.params.name) : undefined"
		:route-query="
			route.query.query === undefined
				? undefined
				: typeof route.query.query === 'string'
					? route.query.query
					: '{'
		"
		:recovery-id="typeof route.query.recovery === 'string' ? route.query.recovery : undefined"
		@navigate="navigate"
		@query-change="changed"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@new-movement="
			(kind, activity) => router.push({ path: `/new/${kind}`, query: { activity } })
		"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
