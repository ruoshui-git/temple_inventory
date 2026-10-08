<script setup lang="ts">
import { useMovementOverviewController } from "./useMovementOverviewController";
import MovementOverviewView from "./MovementOverviewView.vue";

const controller = useMovementOverviewController();
const surface = controller.surface;
</script>

<template>
	<MovementOverviewView :controller="controller" :surface="surface" />
</template>
