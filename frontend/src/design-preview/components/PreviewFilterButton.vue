<script setup lang="ts">
import PreviewUiButton from "./PreviewUiButton.vue";
defineProps<{ expanded: boolean; count: number }>();
</script>
<template>
	<PreviewUiButton icon="filter" :aria-expanded="expanded">
		筛选<span v-if="count" class="count-dot">{{ count }}</span>
	</PreviewUiButton>
</template>
