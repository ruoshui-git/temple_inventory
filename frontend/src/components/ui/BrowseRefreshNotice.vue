<script setup lang="ts">
import UiButton from "./UiButton.vue";

defineProps<{ show: boolean; retry: () => void }>();
</script>

<template>
	<p v-if="show" class="browse-refresh-notice notice-bar warning" role="status">
		<span>更新失败</span><UiButton variant="ghost" @click="retry">重试</UiButton>
	</p>
</template>
