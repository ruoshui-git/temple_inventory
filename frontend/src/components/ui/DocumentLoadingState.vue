<script setup lang="ts">
withDefaults(defineProps<{ label?: string; variant?: "form" | "detail"; announce?: boolean }>(), {
	label: "正在读取记录…",
	variant: "form",
	announce: true,
});
</script>

<template>
	<div
		class="document-loading-state"
		:class="`is-${variant}`"
		:role="announce ? 'status' : undefined"
		:aria-busy="announce ? 'true' : undefined"
	>
		<span v-if="announce" class="visually-hidden">{{ label }}</span>
		<div class="document-loading-card" aria-hidden="true"><i></i><i></i><i></i></div>
		<div class="document-loading-card" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
	</div>
</template>

<style scoped>
.document-loading-state {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(220px, 0.7fr);
	gap: var(--p-gap);
	min-width: 0;
}
.document-loading-card {
	display: grid;
	align-content: start;
	gap: var(--p-space-3);
	min-height: 180px;
	padding: var(--p-card-pad);
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
}
.document-loading-card i {
	display: block;
	width: min(100%, 360px);
	height: 12px;
	border-radius: var(--p-radius-control);
	background: var(--p-soft);
	animation: document-loading-pulse 1.4s ease-in-out infinite alternate;
}
.document-loading-card i:first-child {
	width: 48%;
	height: 18px;
}
.document-loading-card i:last-child {
	width: 70%;
}
.is-detail {
	grid-template-columns: minmax(0, 1fr);
}
.is-detail .document-loading-card {
	min-height: 260px;
}
.visually-hidden {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
@keyframes document-loading-pulse {
	from {
		opacity: 0.55;
	}
	to {
		opacity: 1;
	}
}
@media (max-width: 1023px) {
	.document-loading-state {
		grid-template-columns: minmax(0, 1fr);
	}
	.document-loading-card:nth-child(2) {
		display: none;
	}
}
@media (prefers-reduced-motion: reduce) {
	.document-loading-card i {
		animation: none;
	}
}
</style>
