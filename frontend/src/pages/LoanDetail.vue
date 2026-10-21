<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import LoanDetailPage from "../features/loans/LoanDetailPage.vue";
import { documentDestination, exportDestination } from "../lib/nativeNavigation";
import { operationDestination } from "../lib/nativeNavigation";
import { routeTarget } from "../lib/routeRegistry";
import type { SettlementAction } from "../features/loans/useLoanDetail";
const route = useRoute(),
	router = useRouter();
function settle(name: string, action: SettlementAction) {
	void router.push(
		operationDestination(action === "lost" ? "Loss" : "Return", {
			loan: name,
			outcome: action,
			editor: crypto.randomUUID(),
		}),
	);
}
</script>

<template>
	<LoanDetailPage
		:name="String(route.params.name)"
		@back="router.back()"
		@item="router.push(routeTarget('item-detail', { code: $event }))"
		@activity="router.push(routeTarget('activity-detail', { name: $event }))"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@open-export="router.push(exportDestination($event))"
		@settle="settle"
	/>
</template>
