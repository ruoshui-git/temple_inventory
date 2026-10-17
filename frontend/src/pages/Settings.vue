<script setup lang="ts">
import { useRouter } from "vue-router";
import DisplaySettingsPage from "../features/settings/DisplaySettingsPage.vue";
const router = useRouter();
</script>
<template><DisplaySettingsPage @back="router.push('/more')" /></template>
