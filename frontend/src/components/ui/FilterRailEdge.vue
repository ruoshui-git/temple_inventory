<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import InventoryIcon from "../InventoryIcon.vue";

const props = defineProps<{ open: boolean; active?: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
const control = ref<HTMLButtonElement>();
let focusAfterChange = false;
function toggle() {
	focusAfterChange = true;
	emit("toggle");
}
watch(
	() => props.open,
	async () => {
		if (!focusAfterChange) return;
		focusAfterChange = false;
		await nextTick();
		control.value?.focus({ preventScroll: true });
	},
);
</script>

<template>
	<button
		v-if="open"
		ref="control"
		class="filter-rail-collapse"
		type="button"
		aria-label="收起筛选侧栏"
		title="收起筛选侧栏"
		@click="toggle"
	>
		<InventoryIcon name="chevron-left" />
	</button>
	<button
		v-else
		ref="control"
		class="filter-rail-edge"
		type="button"
		aria-label="展开筛选侧栏"
		title="展开筛选侧栏"
		@click="toggle"
	>
		<span class="filter-rail-edge-icon" aria-hidden="true"
			><InventoryIcon name="chevron-right"
		/></span>
		<span class="filter-rail-edge-label" aria-hidden="true">筛选</span>
		<span v-if="active" class="filter-rail-edge-dot" aria-hidden="true"></span>
	</button>
</template>
