<script setup lang="ts">
import CategoriesPage from "../features/references/CategoriesPage.vue";
import { onBeforeRouteLeave } from "vue-router";
import { useCategoriesController } from "../features/references/useCategoriesController";
const controller = useCategoriesController();
onBeforeRouteLeave(() => controller.requestLeave());
</script>

<template><CategoriesPage :controller="controller" /></template>
