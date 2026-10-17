<script setup lang="ts">
import ConfigurationPage from "../features/setup/ConfigurationPage.vue";
function changed() {
	document.dispatchEvent(new Event("inventory-configuration-changed"));
}
</script>
<template><ConfigurationPage @changed="changed" /></template>
