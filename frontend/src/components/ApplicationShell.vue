<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AppFrame from "./AppFrame.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import { useReferenceData } from "../services/contracts";
import {
	primaryNavigation,
	mobilePrimaryNavigation,
	inventoryNavigation,
	destinationForPath,
	inventorySectionForPath,
} from "../lib/appNavigation";
import { providePageDomain } from "../lib/pageDomain";
import { movementLabels } from "../lib/filterPresentation";
const route = useRoute(),
	router = useRouter(),
	reference = useReferenceData();
const { isMobile } = useResponsiveLayout();
const pageDomain = providePageDomain();
const active = computed(
	() =>
		pageDomain.value?.domain ||
		destinationForPath(route.path, String(route.params.kind || ""), !!route.query.loan),
);
const inventoryExpanded = ref(true);
const inventorySection = computed(() => inventorySectionForPath(route.path));
const owner = computed(
	() => primaryNavigation.find((item) => item.key === active.value)?.label || "更多",
);
const title = computed(() => {
	if (route.params.doctype) return String(route.params.name || route.params.doctype);
	if (route.params.kind) return movementLabels[String(route.params.kind)] || "库存操作";
	if (route.path.startsWith("/reconcile") || route.path.startsWith("/counts")) return "盘点调整";
	if (route.path.startsWith("/activities")) return "活动";
	if (
		route.path.startsWith("/loans/") &&
		!["/loans/items", "/loans/records"].includes(route.path)
	)
		return "借用详情";
	if (route.path.startsWith("/item/")) return "物品资料";
	if (route.path.startsWith("/batch/")) return "批次资料";
	if (route.path === "/items/new") return "新建物品";
	if (route.path === "/settings") return "显示设置";
	if (route.path === "/drafts") return "草稿";
	return inventoryNavigation.find((item) => item.route === route.path)?.label || owner.value;
});
watch(active, (value) => {
	if (value === "inventory") inventoryExpanded.value = true;
});
async function navigate(path: string) {
	document.dispatchEvent(new Event("inventory-navigation"));
	if (!(await router.push({ path, force: true })))
		window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}
</script>
<template>
	<AppFrame
		:primary="primaryNavigation"
		:mobile-primary="mobilePrimaryNavigation"
		:inventory="inventoryNavigation"
		:active="active"
		:inventory-section="inventorySection"
		v-model:inventory-expanded="inventoryExpanded"
		more-route="/more"
		:user="reference.user"
		@primary="navigate"
		@inventory="navigate"
		@more="navigate"
	>
		<nav class="sample-breadcrumb" aria-label="面包屑">
			<RouterLink to="/">寺院物资</RouterLink>
			<template v-if="owner !== title">
				<span aria-hidden="true">/</span>
				<RouterLink
					:to="primaryNavigation.find((item) => item.key === active)?.route || '/more'"
					>{{ owner }}</RouterLink
				>
			</template>
			<span aria-hidden="true">/</span><span aria-current="page">{{ title }}</span>
		</nav>
		<nav
			v-if="isMobile && active === 'inventory'"
			class="mobile-context"
			aria-label="库存页面"
		>
			<button
				v-for="item in inventoryNavigation"
				:key="item.key"
				:aria-current="inventorySection === item.key ? 'page' : undefined"
				@click="navigate(item.route)"
			>
				{{ item.label }}
			</button>
		</nav>
		<slot />
	</AppFrame>
</template>
