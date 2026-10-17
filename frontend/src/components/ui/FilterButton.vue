<script setup lang="ts">
import UiButton from "./UiButton.vue";
defineProps<{ expanded: boolean; count: number }>();
</script>
<template>
	<UiButton icon="filter" :aria-expanded="expanded">
		筛选<span v-if="count" class="count-dot">{{ count }}</span>
	</UiButton>
</template>
