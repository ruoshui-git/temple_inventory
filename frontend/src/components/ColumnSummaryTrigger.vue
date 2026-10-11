<script setup lang="ts">
import InventoryIcon from "./InventoryIcon.vue";

withDefaults(defineProps<{ label?: string; disabled?: boolean }>(), {
	label: "列汇总",
	disabled: false,
});
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
	<button
		type="button"
		class="column-summary-trigger"
		:disabled="disabled"
		@click="emit('click', $event)"
	>
		<InventoryIcon name="sigma" /><span>{{ label }}</span>
	</button>
</template>

<style scoped>
.column-summary-trigger {
	box-sizing: border-box;
	display: inline-flex;
	min-width: 40px;
	min-height: 40px;
	align-items: center;
	justify-content: center;
	gap: 6px;
	padding: 7px 11px;
	border: 1px solid #d8d1c6;
	border-radius: 7px;
	background: #fff;
	color: #5e574d;
	font-size: 14px;
	font-weight: 600;
}
.column-summary-trigger :deep(svg) {
	width: 16px;
	height: 16px;
}
</style>
