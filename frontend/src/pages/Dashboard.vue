<script setup lang="ts">
import DashboardView from "../features/dashboard/DashboardView.vue";
import { useDashboardController } from "../features/dashboard/useDashboardController";

const controller = useDashboardController();
</script>

<template><DashboardView :controller="controller" /></template>
