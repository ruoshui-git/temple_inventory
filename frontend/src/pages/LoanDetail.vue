<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import LoanDetailPage from "../features/loans/LoanDetailPage.vue";
import { documentDestination, exportDestination } from "../lib/nativeNavigation";
import type { SettlementAction } from "../features/loans/useLoanDetail";
const route = useRoute(),
	router = useRouter();
function settle(name: string, action: SettlementAction) {
	void router.push({
		path: `/new/${action === "lost" ? "Loss" : "Return"}`,
		query: { loan: name, outcome: action, editor: crypto.randomUUID() },
	});
}
</script>

<template>
	<LoanDetailPage
		:name="String(route.params.name)"
		@back="router.back()"
		@item="router.push(`/item/${encodeURIComponent($event)}`)"
		@activity="router.push(`/activities/${encodeURIComponent($event)}`)"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@open-export="router.push(exportDestination($event))"
		@settle="settle"
	/>
</template>
