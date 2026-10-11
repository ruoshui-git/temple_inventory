<script setup lang="ts">
import { useWarehousesController } from "./useWarehousesController";
import WarehousesView from "./WarehousesView.vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";

const controller = useWarehousesController();
const { surface } = useResponsiveLayout();
</script>

<template>
	<WarehousesView :controller="controller" :surface="surface" />
</template>
