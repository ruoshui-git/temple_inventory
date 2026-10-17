<script setup lang="ts">
import { ref } from "vue";
import DashboardPage from "../features/dashboard/DashboardPage.vue";
import { dashboardSections } from "../features/dashboard/useDashboardController";
import { provideGalleryReference } from "./fixtureReference";
import { fixtureDashboardScenario } from "./fixtureServices";
import { reviewSession, type PreviewPage } from "./reviewModel";
import { openFullReport, type ReportQuery } from "./reportModel";
provideGalleryReference();
withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const emit = defineEmits<{
	navigate: [page: PreviewPage, variant: string];
	movement: [name: string];
	loan: [name: string];
}>();
const page = ref<InstanceType<typeof DashboardPage>>();
function browse(query: ReportQuery) {
	if (query.dataset === "inventory") {
		reviewSession.filters.inventory.scope = query.scope;
		emit("navigate", "inventory", "list");
	} else if (query.dataset === "expiry") {
		reviewSession.nativeExpiryQuery = JSON.parse(JSON.stringify(query));
		reviewSession.filters.expiry.scope = query.scope;
		reviewSession.filters.expiry.inStock = !query.includeZero;
		reviewSession.filters.expiry.status =
			query.expiryWindow === "expired"
				? "expired"
				: query.expiryWindow === "next_30"
					? "soon"
					: "all";
		emit("navigate", "expiry", reviewSession.filters.expiry.status);
	} else if (query.dataset === "loans") {
		reviewSession.filters.loanScope = query.scope;
		emit("navigate", "loan-records", "open");
	} else {
		reviewSession.filters.movementScope = query.scope;
		emit("navigate", "movement-records", "completed");
	}
}
function exportPage(query: ReportQuery) {
	openFullReport(query);
	emit("navigate", "reports", query.dataset);
}
</script>
<template>
	<details class="preview-state-controls">
		<summary>图库服务状态</summary>
		<label
			>失败区块<select v-model="fixtureDashboardScenario.failed">
				<option value="">无</option>
				<option v-for="(label, key) in dashboardSections" :key="key" :value="key">
					{{ label }}
				</option>
			</select></label
		><label><input type="checkbox" v-model="fixtureDashboardScenario.empty" />空数据</label
		><label
			><input
				type="checkbox"
				v-model="fixtureDashboardScenario.missingContext"
			/>缺少名称与活动（回退示例）</label
		><label
			>请求延迟<input
				type="number"
				min="0"
				max="5000"
				v-model="fixtureDashboardScenario.delay" /></label
		><button @click="page?.controller.refresh()">应用服务状态</button>
	</details>
	<DashboardPage
		ref="page"
		:active="active"
		@browse="browse"
		@open-document="(_, name) => emit('movement', name)"
		@open-export="exportPage"
	/>
</template>
