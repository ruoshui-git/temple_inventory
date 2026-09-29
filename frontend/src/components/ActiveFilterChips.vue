<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
export interface FilterChip {
	key: string;
	label: string;
	value?: string;
}
const props = defineProps<{ chips: FilterChip[] }>();
const emit = defineEmits<{ remove: [chip: FilterChip]; clear: [] }>();
const expanded = ref(false);
const overflowTrigger = ref<HTMLButtonElement>();
const visibleChips = computed(() => (expanded.value ? props.chips : props.chips.slice(0, 6)));
const hiddenCount = computed(() => Math.max(0, props.chips.length - visibleChips.value.length));
watch(
	() => props.chips.length,
	(value) => {
		if (value <= 6) expanded.value = false;
	},
);
async function toggleOverflow() {
	expanded.value = !expanded.value;
	await nextTick();
	if (!expanded.value) overflowTrigger.value?.focus();
}
</script>
<template>
	<div v-if="chips.length" class="active-filter-chips" aria-label="已选筛选条件">
		<span
			v-for="chip in visibleChips"
			:key="`${chip.key}:${chip.value || chip.label}`"
			class="filter-chip"
			><span>{{ chip.label }}</span
			><button
				type="button"
				:aria-label="`移除 ${chip.label}`"
				@click="emit('remove', chip)"
			>
				×
			</button></span
		><button
			v-if="hiddenCount || expanded"
			ref="overflowTrigger"
			type="button"
			class="chip-overflow"
			:aria-expanded="expanded"
			@click="toggleOverflow"
		>
			{{ expanded ? "收起" : `另有 ${hiddenCount} 项` }}</button
		><button type="button" class="clear-filters" @click="emit('clear')">清除全部</button>
	</div>
</template>

<style scoped>
.active-filter-chips {
	display: flex;
	align-items: center;
	gap: 5px;
	overflow: auto;
	scrollbar-width: none;
}
.filter-chip {
	display: inline-flex;
	align-items: center;
	min-height: 25px;
	padding: 2px 5px 2px 8px;
	border-radius: 20px;
	background: #f0ebe3;
	color: #756044;
	font-size: 12px;
	white-space: nowrap;
}
.filter-chip button {
	min-height: 20px;
	padding: 0 3px;
	border: 0;
	background: transparent;
	color: inherit;
}
.chip-overflow,
.clear-filters {
	min-height: 25px;
	padding: 0 4px;
	border: 0;
	background: transparent;
	color: #926d3f;
	font-size: 12px;
	white-space: nowrap;
}
</style>
