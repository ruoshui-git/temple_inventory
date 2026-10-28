<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import NativeRecordsPage from "../features/drafts/NativeRecordsPage.vue";
import { documentDestination, exportDestination } from "../lib/nativeNavigation";
import { recoveryDestination } from "../lib/recoveryNavigation";
import type { RecoverySnapshot } from "../lib/browserRecovery";
import type { ReportQuery } from "../lib/reportContract";
import { routeTarget } from "../lib/routeRegistry";
import { browseRouteQuery, serializeBrowseQuery } from "../lib/routeRegistry";
const route = useRoute(),
	router = useRouter();
const mode = computed(() => (route.name === "counts" ? "counts" : "drafts"));
const routeQuery = computed(() => {
	const value = route.query.query;
	if (value == null) return undefined;
	if (mode.value === "counts") return browseRouteQuery(value, "counts", route.query.view);
	return typeof value === "string" ? value : JSON.stringify(value);
});
function changed(query: ReportQuery) {
	const value = serializeBrowseQuery(query);
	if (route.query.query !== value || route.query.view !== query.view)
		void router.replace({ query: { ...route.query, view: query.view, query: value } });
}
function recover(entry: RecoverySnapshot) {
	const destination = recoveryDestination(entry);
	if (destination) void router.push(destination);
}
function newCount() {
	void router.push(routeTarget("count-new", {}, { editor: crypto.randomUUID() }));
}
</script>
<template>
	<NativeRecordsPage
		:key="mode"
		:mode="mode"
		:route-query="routeQuery"
		@query-change="changed"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@recover="recover"
		@new-count="newCount"
		@open-export="router.push(exportDestination($event))"
		@new-operation="(kind) => router.push(routeTarget('movement-new', { kind }))"
	/>
</template>
