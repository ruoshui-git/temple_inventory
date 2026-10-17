<script setup lang="ts">
import { useConfiguration } from "./useConfiguration";
import ConfigurationView from "./ConfigurationView.vue";
const emit = defineEmits<{ changed: [] }>();
const controller = useConfiguration(() => emit("changed"));
defineExpose({ controller });
</script>
<template><ConfigurationView :controller="controller" /></template>
