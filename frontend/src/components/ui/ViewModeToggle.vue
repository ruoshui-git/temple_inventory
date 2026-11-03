<script setup lang="ts">
import { computed } from "vue";
import InventoryIcon from "../InventoryIcon.vue";
import type { BrowseView } from "../../composables/useBrowseViewMode";

const props = defineProps<{ ariaLabel: string; options: BrowseView[] }>();
const view = defineModel<BrowseView>({ required: true });
const meta: Record<BrowseView, { label: string; icon: string }> = {
	table: { label: "表格", icon: "table" },
	list: { label: "列表", icon: "list" },
	card: { label: "卡片", icon: "card" },
};
const items = computed(() => props.options.map((value) => ({ value, ...meta[value] })));
</script>

<template>
	<div v-if="options.length > 1" class="segmented stock-view-icons" :aria-label="ariaLabel">
		<button
			v-for="item in items"
			:key="item.value"
			:aria-label="`${item.label}视图`"
			:title="item.label"
			:aria-pressed="view === item.value"
			@click="view = item.value"
		>
			<InventoryIcon :name="item.icon" /><span>{{ item.label }}</span>
		</button>
	</div>
</template>
