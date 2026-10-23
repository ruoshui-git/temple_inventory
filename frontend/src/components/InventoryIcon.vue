<script setup lang="ts">
withDefaults(defineProps<{ name: string; strokeWidth?: number }>(), { strokeWidth: 2 });
const paths: Record<string, string> = {
	expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
	contract: "M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5",
	box: "m3 7 9-4 9 4v10l-9 4-9-4V7Zm9-4v8m9-4-9 4-9-4m9 4v10",
	document: "M6 3h8l4 4v14H6V3Zm8 0v5h5M9 12h6m-6 4h6",
	device: "M5 3h14v18H5V3Zm5 15h4",
	total: "M4 6h16v12H4V6Zm0 4h16M8 14h8",
	movement: "M4 7h14l-3-3m3 3-3 3M20 17H6l3 3m-3-3 3-3",
	adjust: "M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 2v4",
	loan: "M8 5 3 10l5 5M3 10h11a5 5 0 0 1 0 10h-3",
	warehouse: "m3 10 9-7 9 7v10H3V10Zm4 10v-6h10v6M7 10h10",
	area: "M3 4h18v16H3zM7 8h4v4H7zm6 0h4m-4 4h4m-10 4h10",
	room: "M4 4h16v16H4zM8 20v-7h8v7M8 8h.01M16 8h.01",
	shelf: "M3 5h18M3 12h18M3 19h18M7 5v7m5 0v7m5-14v7",
	location: "M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
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
	"return-top": "M12 18V6m-6 6 6-6 6 6M5 3h14",
	"chevron-down": "m6 9 6 6 6-6",
	"chevron-right": "m9 6 6 6-6 6",
	"chevron-left": "m15 6-6 6 6 6",
	sigma: "M18 5H7l6 7-6 7h11",
};
</script>
<template>
	<svg
		aria-hidden="true"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		:stroke-width="strokeWidth"
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
