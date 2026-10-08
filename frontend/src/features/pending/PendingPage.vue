<script setup lang="ts">
import { usePendingController } from "./usePendingController";
import PendingView from "./PendingView.vue";

const controller = usePendingController();
const surface = controller.surface;
</script>

<template>
	<PendingView :controller="controller" :surface="surface" />
</template>
