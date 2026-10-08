<script setup lang="ts">
import { useWarehousesController } from "./useWarehousesController";
import WarehousesView from "./WarehousesView.vue";

const controller = useWarehousesController();
</script>

<template>
	<WarehousesView :controller="controller" />
</template>
