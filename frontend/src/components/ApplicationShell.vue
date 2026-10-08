<script setup lang="ts">
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import ApplicationShellDesktopView from "../features/shell/ApplicationShellDesktopView.vue";
import ApplicationShellMobileView from "../features/shell/ApplicationShellMobileView.vue";
import { useApplicationShellController } from "../features/shell/useApplicationShellController";

const controller = useApplicationShellController();
const { surface } = useResponsiveLayout();
const {
	route,
	boot,
	inventoryExpanded,
	destinations,
	activeDestination,
	inventoryContextItems,
	contextItems,
	contextKey,
	pending,
	expiryCount,
	logout,
	closeNavigationContext,
} = controller;
</script>

<template>
	<div class="application-shell">
		<ApplicationShellDesktopView
			v-if="surface === 'desktop'"
			:destinations="destinations"
			:active-destination="activeDestination"
			:inventory-expanded="inventoryExpanded"
			:inventory-context-items="inventoryContextItems"
			:context-items="contextItems"
			:context-key="contextKey"
			:pending="pending"
			:expiry-count="expiryCount"
			:user="String(boot?.user || '')"
			@toggle-inventory="inventoryExpanded = !inventoryExpanded"
			@close-context="closeNavigationContext"
			@logout="logout"
		/>
		<main class="shell-content"><slot /></main>
		<ApplicationShellMobileView
			v-if="surface === 'mobile'"
			:destinations="destinations"
			:active-destination="activeDestination"
			:context-items="contextItems"
			:context-key="contextKey"
			:path="route.path"
		/>
	</div>
</template>

<style>
.application-shell {
	min-height: 100dvh;
}

.shell-content {
	min-width: 0;
}
</style>
