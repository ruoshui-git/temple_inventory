<script setup lang="ts">
import { useInventoryController } from "./useInventoryController";
import InventoryDesktopView from "./InventoryDesktopView.vue";
import InventoryMobileView from "./InventoryMobileView.vue";
import InventorySharedOverlays from "./InventorySharedOverlays.vue";

const controller = useInventoryController();
const surface = controller.surface;
</script>

<template>
	<InventoryDesktopView v-if="surface === 'desktop'" :controller="controller" />
	<InventoryMobileView v-else :controller="controller" />
	<InventorySharedOverlays :controller="controller" />
</template>
