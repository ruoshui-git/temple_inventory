<script setup lang="ts">
import InventoryIcon from "./InventoryIcon.vue";

withDefaults(
	defineProps<{
		variant?: "primary" | "secondary" | "ghost" | "danger";
		size?: "default" | "compact";
		icon?: string;
		iconOnly?: boolean;
		loading?: boolean;
		disabled?: boolean;
		type?: "button" | "submit" | "reset";
		label?: string;
	}>(),
	{
		variant: "secondary",
		size: "default",
		iconOnly: false,
		loading: false,
		disabled: false,
		type: "button",
	},
);
</script>

<template>
	<button
		:type="type"
		:class="[
			'ui-button',
			`ui-button--${variant}`,
			`ui-button--${size}`,
			{ 'is-icon-only': iconOnly, primary: variant === 'primary' },
		]"
		:disabled="disabled || loading"
		:aria-busy="loading || undefined"
		:aria-label="iconOnly ? label : undefined"
	>
		<span v-if="loading" class="ui-button-spinner" aria-hidden="true"></span>
		<template v-else>
			<InventoryIcon v-if="icon" :name="icon" />
			<slot v-if="!iconOnly" />
		</template>
		<span v-if="loading && !iconOnly" class="ui-button-loading-label">正在处理…</span>
	</button>
</template>
