<script setup lang="ts">
import { useExpiryController } from "./useExpiryController";
import ExpiryDesktopView from "./ExpiryDesktopView.vue";
import ExpiryMobileView from "./ExpiryMobileView.vue";
import ExpirySharedOverlays from "./ExpirySharedOverlays.vue";

const controller = useExpiryController();
const surface = controller.surface;
</script>

<template>
	<ExpiryDesktopView v-if="surface === 'desktop'" :controller="controller" />
	<ExpiryMobileView v-else :controller="controller" />
	<ExpirySharedOverlays :controller="controller" />
</template>
