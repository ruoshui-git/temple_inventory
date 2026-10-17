<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import NativeRecordsPage from "../features/drafts/NativeRecordsPage.vue";
import { documentDestination, exportDestination } from "../lib/nativeNavigation";
import { recoveryDestination } from "../lib/recoveryNavigation";
import type { RecoverySnapshot } from "../lib/browserRecovery";
import type { ReportQuery } from "../lib/reportContract";
const route = useRoute(),
	router = useRouter();
const mode = computed(() => (route.path === "/counts" ? "counts" : "drafts"));
function changed(query: ReportQuery) {
	const value = JSON.stringify(query);
	if (route.query.query !== value)
		void router.replace({ query: { ...route.query, query: value } });
}
function recover(entry: RecoverySnapshot) {
	const destination = recoveryDestination(entry);
	if (destination) void router.push(destination);
}
function newCount() {
	void router.push({ path: "/reconcile/new", query: { editor: crypto.randomUUID() } });
}
</script>
<template>
	<NativeRecordsPage
		:key="mode"
		:mode="mode"
		:route-query="
			route.query.query === undefined
				? undefined
				: typeof route.query.query === 'string'
					? route.query.query
					: '{'
		"
		@query-change="changed"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@recover="recover"
		@new-count="newCount"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
