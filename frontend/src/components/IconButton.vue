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

<style scoped>
.icon-button {
	position: relative;
}
.icon-button :deep(svg) {
	width: 22px;
	height: 22px;
	fill: none;
	stroke: currentColor;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 1.8;
}
.icon-button-tooltip {
	display: none;
}
@media (min-width: 1024px) {
	.icon-button:hover .icon-button-tooltip,
	.icon-button:focus-visible .icon-button-tooltip {
		position: absolute;
		z-index: var(--ti-layer-popover);
		top: calc(100% + 6px);
		left: 50%;
		display: block;
		transform: translateX(-50%);
		width: max-content;
		max-width: 220px;
		padding: var(--ti-space-1) var(--ti-space-2);
		border-radius: var(--ti-radius-control);
		background: var(--ti-ink);
		color: var(--ti-surface);
		font-size: var(--ti-font-small);
		font-weight: 600;
		pointer-events: none;
	}
}
</style>
