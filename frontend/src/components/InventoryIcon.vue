<script setup lang="ts">
defineProps<{ name: string }>();
const paths: Record<string, string> = {
	box: "m3 7 9-4 9 4v10l-9 4-9-4V7Zm9-4v8m9-4-9 4-9-4m9 4v10",
	total: "M4 6h16v12H4V6Zm0 4h16M8 14h8",
	movement: "M4 7h14l-3-3m3 3-3 3M20 17H6l3 3m-3-3 3-3",
	adjust: "M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 2v4",
	loan: "M8 5 3 10l5 5M3 10h11a5 5 0 0 1 0 10h-3",
	warehouse: "m3 10 9-7 9 7v10H3V10Zm4 10v-6h10v6M7 10h10",
	more: "M4 12h1m6 0h1m6 0h1",
	notice: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
	search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
	scan: "M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M7 12h10M8 9v6m4-6v6m4-6v6",
	filter: "M3 4h18l-7 8v7l-4 2v-9L3 4Z",
	download: "M12 3v12m0 0 5-5m-5 5-5-5M4 17v3h16v-3",
	table: "M3 4h18v16H3V4Zm0 5h18M3 14h18M9 4v16",
	card: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7",
	warning: "m12 3 10 18H2L12 3Zm0 6v5m0 3v1",
	select: "M5 12l4 4L19 6M4 21h16",
	open: "m9 18 6-6-6-6",
};
</script>
<template>
	<svg
		aria-hidden="true"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.6"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path :d="paths[name] || paths.box" />
	</svg>
</template>
<style scoped>
svg {
	width: 19px;
	height: 19px;
	flex-shrink: 0;
}
</style>
