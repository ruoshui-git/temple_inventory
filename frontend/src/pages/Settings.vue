<script setup lang="ts">
import { useRouter } from "vue-router";
import DisplaySettingsPage from "../features/settings/DisplaySettingsPage.vue";
import { routeTarget } from "../lib/routeRegistry";
const router = useRouter();
</script>
<template><DisplaySettingsPage @back="router.push(routeTarget('more'))" /></template>
