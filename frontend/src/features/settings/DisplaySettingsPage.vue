<script setup lang="ts">
import { useDisplaySettings } from "./useDisplaySettings";
import DisplaySettingsView from "./DisplaySettingsView.vue";
const emit = defineEmits<{ back: [] }>();
const controller = useDisplaySettings();
defineExpose({ controller });
</script>
<template><DisplaySettingsView :controller="controller" @back="emit('back')" /></template>
