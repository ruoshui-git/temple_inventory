<script setup lang="ts">
import { useWarehouseDetailController } from "./useWarehouseDetailController";
import WarehouseDetailView from "./WarehouseDetailView.vue";

const controller = useWarehouseDetailController();
</script>

<template>
	<WarehouseDetailView :controller="controller" />
</template>
