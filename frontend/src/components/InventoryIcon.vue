<script setup lang="ts">
const props = withDefaults(defineProps<{ name: string; strokeWidth?: number }>(), {
	strokeWidth: 2,
});
// Lucide icons are ISC-licensed; https://lucide.dev/license
const paths: Record<string, string> = {
	image: "M4 4h16v16H4V4Zm0 12 5-5 4 4 3-3 4 4M9 9h.01",
	paperclip: "m8 12 7-7a4 4 0 0 1 6 6l-9 9a6 6 0 0 1-8-8l9-9m-1 10 7-7",
	expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
	contract: "M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5",
	box: "m3 7 9-4 9 4v10l-9 4-9-4V7Zm9-4v8m9-4-9 4-9-4m9 4v10",
	document: "M6 3h8l4 4v14H6V3Zm8 0v5h5M9 12h6m-6 4h6",
	device: "M5 3h14v18H5V3Zm5 15h4",
	total: "M4 6h16v12H4V6Zm0 4h16M8 14h8",
	movement: "M4 7h14l-3-3m3 3-3 3M20 17H6l3 3m-3-3 3-3",
	adjust: "M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 2v4",
	activity: "M3 12h4l2-7 4 14 2-7h6",
	calendar: "M5 4v3m14-3v3M4 8h16M5 5h14v15H5zM8 12h2m4 0h2M8 16h2m4 0h2",
	tag: "M20 13 11 22 2 13V4h9l9 9Zm-12-5h.01",
	sliders: "M4 6h10m4 0h2M4 12h2m4 0h10M4 18h10m4 0h2M14 4v4m-4 2v4m4 2v4",
	warehouse: "m3 10 9-7 9 7v10H3V10Zm4 10v-6h10v6M7 10h10",
	area: "M3 4h18v16H3zM7 8h4v4H7zm6 0h4m-4 4h4m-10 4h10",
	room: "M4 4h16v16H4zM8 20v-7h8v7M8 8h.01M16 8h.01",
	shelf: "M3 5h18M3 12h18M3 19h18M7 5v7m5 0v7m5-14v7",
	location: "M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
	more: "M4 12h1m6 0h1m6 0h1",
	notice: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
	settings:
		"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M3 12h2m14 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42",
	cancel: "M5 5l14 14M19 5 5 19",
	count: "M8 4h8l2 2h2v15H4V6h2l2-2Zm0 8 2.5 2.5L16 9",
	expiry: "M12 3v9l6 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
	receive: "M4 4h16v16H4V4Zm8 2v9m0 0 4-4m-4 4-4-4",
	issue: "M4 4h16v16H4V4Zm8 14V9m0 0 4 4m-4-4-4 4",
	transfer: "M4 8h16m0 0-4-4m4 4-4 4M20 16H4m0 0 4 4m-4-4 4-4",
	return: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
	repair: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z",
	loan: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
	damage: "M4 7h16v13H4V7Zm0 0 3-4h10l3 4m-9 4 4 4m0-4-4 4",
	loss: "M21 21l-5-5m1-6a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-9-3 4 6m0-6-4 6",
	disposal: "M4 7h16m-14 0 1 14h10l1-14M9 7V4h6v3m-5 4v7m4-7v7",
	outside: "M13 4h7v16h-7M4 12h12m-5-5 5 5-5 5M4 4v4m0 8v4",
	export: "M14 3H6v18h12V7l-4-4Zm0 0v4h4m-8 7h8m-4-4 4 4-4 4",
	report: "M4 20V10h4v10H4Zm6 0V4h4v16h-4Zm6 0v-7h4v7h-4Z",
	refresh: "M20 7v5h-5M4 17v-5h5m10-2a7 7 0 0 0-12-3L4 9m16 6-3 3a7 7 0 0 1-12-3",
	download: "M12 3v10m0 0 4-4m-4 4-4-4M4 16v4h16v-4",
	search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
	scan: "M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M7 12h10M8 9v6m4-6v6m4-6v6",
	filter: "M3 4h18l-7 8v7l-4 2v-9L3 4Z",
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
const aliases: Record<string, string> = { trash: "disposal" };
const resolvedName = aliases[props.name] || props.name;
if (import.meta.env.DEV && !paths[resolvedName])
	console.warn(`[InventoryIcon] Unknown icon name: ${props.name}`);
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
		<path :d="paths[resolvedName] || paths.box" />
	</svg>
</template>
<style scoped>
svg {
	width: 19px;
	height: 19px;
	flex-shrink: 0;
}
</style>
