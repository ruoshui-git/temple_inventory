<script setup lang="ts">
import { useLoansController } from "./useLoansController";
import LoansView from "./LoansView.vue";

const controller = useLoansController();
const surface = controller.surface;
</script>

<template>
	<LoansView :controller="controller" :surface="surface" />
</template>
