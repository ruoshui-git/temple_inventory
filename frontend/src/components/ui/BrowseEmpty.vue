<script setup lang="ts">
import InventoryIcon from "../InventoryIcon.vue";

defineProps<{ text: string }>();
</script>

<template>
	<div class="browse-empty" role="status">
		<span><InventoryIcon name="search" /></span>
		<p>{{ text }}</p>
		<slot />
	</div>
</template>
