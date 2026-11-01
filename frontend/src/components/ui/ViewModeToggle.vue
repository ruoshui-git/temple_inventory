<script setup lang="ts">
import InventoryIcon from "../InventoryIcon.vue";

// Item pages switch 卡片/列表; document lists switch two-line 列表 rows and the 表格.
const props = withDefaults(defineProps<{ ariaLabel: string; kind?: "cards" | "rows" }>(), {
	kind: "cards",
});
const view = defineModel<"card" | "table">({ required: true });
const first =
	props.kind === "rows" ? { label: "列表", icon: "list" } : { label: "卡片", icon: "card" };
const second = props.kind === "rows" ? { label: "表格" } : { label: "列表" };
</script>

<template>
	<div class="segmented stock-view-icons" :aria-label="ariaLabel">
		<button
			:aria-label="`${first.label}视图`"
			:title="first.label"
			:aria-pressed="view === 'card'"
			@click="view = 'card'"
		>
			<InventoryIcon :name="first.icon" /><span>{{ first.label }}</span>
		</button>
		<button
			:aria-label="`${second.label}视图`"
			:title="second.label"
			:aria-pressed="view === 'table'"
			@click="view = 'table'"
		>
			<InventoryIcon name="table" /><span>{{ second.label }}</span>
		</button>
	</div>
</template>
