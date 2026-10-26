<script setup lang="ts">
import { computed, ref } from "vue";
import { useFloatingScrollbar } from "../../composables/useFloatingScrollbar";

const props = defineProps<{ getScrollElement: () => HTMLElement | undefined }>();
const proxyElement = ref<HTMLElement>();
const { visible, style, thumbStyle, spacerWidth, fromProxy } = useFloatingScrollbar(
	computed(() => props.getScrollElement()),
	proxyElement,
);
</script>

<template>
	<div v-if="visible" class="floating-table-scrollbar-shell" :style="style" aria-hidden="true">
		<div class="floating-table-scrollbar" ref="proxyElement" @scroll.passive="fromProxy">
			<div :style="{ width: `${spacerWidth}px`, height: '1px' }"></div>
		</div>
		<span class="floating-table-scrollbar-thumb" :style="thumbStyle"></span>
	</div>
</template>

<style scoped>
.floating-table-scrollbar-shell {
	position: fixed;
	bottom: calc(8px + env(safe-area-inset-bottom));
	height: 18px;
	z-index: var(--p-z-sticky);
	border: 1px solid var(--p-border);
	border-radius: 999px;
	background: color-mix(in srgb, var(--p-surface) 96%, var(--p-ink));
	box-shadow: var(--p-shadow-subtle);
	pointer-events: none;
}
.floating-table-scrollbar {
	position: absolute;
	inset: 0;
	overflow-x: auto;
	overflow-y: hidden;
	border-radius: inherit;
	overscroll-behavior-inline: contain;
	pointer-events: auto;
	scrollbar-color: var(--p-accent-strong) var(--p-soft);
	scrollbar-width: auto;
}
.floating-table-scrollbar::-webkit-scrollbar {
	height: 12px;
	background: var(--p-soft);
	border-radius: 999px;
}
.floating-table-scrollbar::-webkit-scrollbar-track {
	background: var(--p-soft);
	border-radius: 999px;
}
.floating-table-scrollbar::-webkit-scrollbar-thumb {
	background: var(--p-accent-strong);
	border: 2px solid var(--p-soft);
	border-radius: 999px;
}
@media (hover: hover) {
	.floating-table-scrollbar::-webkit-scrollbar-thumb:hover {
		background: var(--p-accent);
	}
}
.floating-table-scrollbar-thumb {
	position: absolute;
	top: 3px;
	height: 10px;
	border-radius: 999px;
	background: var(--p-accent-strong);
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--p-surface) 35%, transparent);
	pointer-events: none;
}
@media (hover: hover) {
	.floating-table-scrollbar-shell:hover .floating-table-scrollbar-thumb {
		background: var(--p-accent);
	}
}
@media not all and (hover: hover) and (pointer: fine) {
	.floating-table-scrollbar-shell {
		display: none !important;
	}
}
@media print {
	.floating-table-scrollbar-shell {
		display: none !important;
	}
}
</style>
