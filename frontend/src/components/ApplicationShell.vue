<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AppFrame from "./AppFrame.vue";
import NotificationCenter from "../features/notifications/NotificationCenter.vue";
import PushPrompt from "../features/notifications/PushPrompt.vue";
import RouteBreadcrumbs from "./RouteBreadcrumbs.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import { useReferenceData } from "../services/contracts";
import { provideRouteBreadcrumbLabel } from "../lib/routeBreadcrumbLabel";
import {
	primaryNavigation,
	mobilePrimaryNavigation,
	inventoryNavigation,
	destinationForRoute,
	inventorySectionForRoute,
} from "../lib/appNavigation";
const route = useRoute(),
	router = useRouter(),
	reference = useReferenceData();
const { isMobile } = useResponsiveLayout();
const active = computed(() => destinationForRoute(String(route.meta.owner || "")));
const inventoryExpanded = ref(false);
const breadcrumbLabel = ref<string>();
provideRouteBreadcrumbLabel(breadcrumbLabel);
watch(
	() => `${String(route.name)}:${JSON.stringify(route.params)}`,
	() => (breadcrumbLabel.value = undefined),
);
const inventorySection = computed(() => inventorySectionForRoute(String(route.name || "")));
const hidePhoneBreadcrumb = computed(() => isMobile.value);
const stockTabLabels: Record<string, string> = {
	stock: "库存",
	expiry: "效期",
	warehouses: "仓库",
	pending: "损坏",
	categories: "分类",
};
async function navigate(target: Parameters<typeof router.push>[0]) {
	document.dispatchEvent(new Event("inventory-navigation"));
	const forcedTarget =
		typeof target === "string" ? { path: target, force: true } : { ...target, force: true };
	if (!(await router.push(forcedTarget as Parameters<typeof router.push>[0])))
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
		:user="reference.user"
		@primary="navigate"
		@inventory="navigate"
		@more="navigate"
	>
		<template #notifications><NotificationCenter /></template>
		<PushPrompt />
		<RouteBreadcrumbs v-if="!hidePhoneBreadcrumb" />
		<nav
			v-if="isMobile && active === 'inventory'"
			class="mobile-context"
			aria-label="库存子页面"
		>
			<RouterLink
				v-for="item in inventoryNavigation"
				:key="item.key"
				:to="item.route"
				:aria-current="inventorySection === item.key ? 'page' : undefined"
				>{{ stockTabLabels[item.key] }}</RouterLink
			>
		</nav>
		<slot />
	</AppFrame>
</template>
