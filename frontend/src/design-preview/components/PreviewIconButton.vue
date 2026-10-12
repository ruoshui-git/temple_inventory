<script setup lang="ts">
withDefaults(
	defineProps<{
		label: string;
		title?: string;
		variant?: "primary" | "secondary" | "ghost" | "danger";
		disabled?: boolean;
		loading?: boolean;
	}>(),
	{ variant: "ghost", disabled: false, loading: false },
);
</script>
<template>
	<button
		type="button"
		class="icon-button"
		:class="`icon-button--${variant}`"
		:aria-label="label"
		:disabled="disabled || loading"
		:aria-busy="loading || undefined"
	>
		<span v-if="loading" class="ui-button-spinner" aria-hidden="true"></span
		><slot v-else /><span class="icon-button-tooltip" role="tooltip">{{
			title || label
		}}</span>
	</button>
</template>
