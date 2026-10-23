<script setup lang="ts">
import InventoryIcon from "../InventoryIcon.vue";

const props = defineProps<{ variant: "inline" | "popup" }>();
const iconNames = { inline: "chevron-right", popup: "chevron-down" } as const;
</script>

<template>
	<span
		class="ti-disclosure-icon"
		:class="`ti-disclosure-icon--${props.variant}`"
		aria-hidden="true"
	>
		<InventoryIcon :name="iconNames[props.variant]" :stroke-width="2.25" />
	</span>
</template>
