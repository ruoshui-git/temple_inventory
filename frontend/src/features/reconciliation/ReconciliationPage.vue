<script setup lang="ts">
import { useReconciliationController } from "./useReconciliationController";
import ReconciliationView from "./ReconciliationView.vue";

const controller = useReconciliationController();
</script>

<template>
	<ReconciliationView :controller="controller" />
</template>
