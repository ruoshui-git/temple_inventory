<script setup lang="ts">
import UnitsView from "../features/units/UnitsView.vue";
import { useUnitsController } from "../features/units/useUnitsController";

const controller = useUnitsController();
</script>

<template><UnitsView :controller="controller" /></template>
