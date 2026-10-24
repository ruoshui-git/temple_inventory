<script setup lang="ts">
import UiButton from "./UiButton.vue";
withDefaults(defineProps<{ label?: string; disabled?: boolean }>(), {
	label: "返回",
	disabled: false,
});
const emit = defineEmits<{ click: [] }>();
</script>

<template>
	<UiButton
		class="back-button"
		variant="ghost"
		icon="chevron-left"
		:aria-label="label"
		:disabled="disabled"
		@click="emit('click')"
		><span>{{ label }}</span></UiButton
	>
</template>

<style scoped>
.back-button {
	flex-wrap: nowrap;
	white-space: nowrap;
}
@media (max-width: 520px) {
	.back-button span {
		display: none;
	}
}
</style>
