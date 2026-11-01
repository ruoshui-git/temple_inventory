<script setup lang="ts">
import { useActivityTypesController } from "../features/activityTypes/useActivityTypesController";
import ActivityTypesView from "../features/activityTypes/ActivityTypesView.vue";
const controller = useActivityTypesController();
</script>
<template><ActivityTypesView :controller="controller" /></template>
