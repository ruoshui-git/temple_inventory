<script setup lang="ts">
import { useReportsController } from "./useReportsController";
import ReportsView from "./ReportsView.vue";

const controller = useReportsController();
</script>

<template>
	<ReportsView :controller="controller" />
</template>
