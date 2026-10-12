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
	min-height: var(--ti-control-height);
	align-items: center;
	justify-content: center;
	gap: var(--ti-space-1);
	padding: var(--ti-space-2) var(--ti-space-3);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-control);
	background: var(--ti-surface);
	color: var(--ti-muted);
	font-size: var(--ti-font-body);
	font-weight: 600;
}
@media (max-width: 1023px) {
	.column-summary-trigger {
		min-height: var(--ti-density-control);
	}
}
.column-summary-trigger :deep(svg) {
	width: 16px;
	height: 16px;
}
</style>
