<script setup lang="ts">
import InventoryIcon from "../InventoryIcon.vue";

defineProps<{ ariaLabel: string }>();
const view = defineModel<"card" | "table">({ required: true });
</script>

<template>
	<div class="segmented stock-view-icons" :aria-label="ariaLabel">
		<button
			:aria-label="'卡片视图'"
			:title="'卡片'"
			:aria-pressed="view === 'card'"
			@click="view = 'card'"
		>
			<InventoryIcon name="card" /><span>卡片</span>
		</button>
		<button
			:aria-label="'列表视图'"
			:title="'列表'"
			:aria-pressed="view === 'table'"
			@click="view = 'table'"
		>
			<InventoryIcon name="table" /><span>列表</span>
		</button>
	</div>
</template>
