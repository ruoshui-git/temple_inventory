<script setup lang="ts">
import { useMovementsController } from "./useMovementsController";
import MovementsView from "./MovementsView.vue";

const controller = useMovementsController();
const surface = controller.surface;
</script>

<template>
	<MovementsView :controller="controller" :surface="surface" />
</template>
