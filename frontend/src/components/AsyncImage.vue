<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = withDefaults(
	defineProps<{
		src?: string | null;
		alt: string;
		width?: number | string;
		height?: number | string;
		loading?: "eager" | "lazy";
		decoding?: "async" | "sync" | "auto";
		fit?: "contain" | "cover" | "fill" | "none" | "scale-down";
		placeholderLabel?: string;
		class?: string | string[] | Record<string, boolean>;
	}>(),
	{
		src: "",
		loading: "lazy",
		decoding: "async",
		fit: "cover",
		placeholderLabel: "暂无图片",
	},
);

const state = ref<"empty" | "loading" | "loaded" | "error">("empty");
const imageVisible = computed(() => Boolean(props.src) && state.value !== "error");

watch(
	() => props.src,
	(value) => {
		state.value = value ? "loading" : "empty";
	},
	{ immediate: true },
);

function dimension(value?: number | string) {
	if (typeof value === "number") return `${value}px`;
	return value && /^\d+(?:\.\d+)?$/.test(value) ? `${value}px` : value;
}

function handleLoad() {
	state.value = "loaded";
}

function handleError() {
	state.value = "error";
}
</script>

<template>
	<span
		class="async-image"
		:class="[
			props.class,
			`async-image--${state}`,
			{ 'async-image--has-source': Boolean(props.src) },
		]"
		:style="{ width: dimension(width), height: dimension(height) }"
		role="img"
		:aria-label="alt"
		:aria-busy="state === 'loading' ? 'true' : undefined"
	>
		<span v-if="state === 'loading'" class="async-image__skeleton" aria-hidden="true"></span>
		<img
			v-if="imageVisible"
			:src="src || undefined"
			alt=""
			:width="width"
			:height="height"
			:loading="loading"
			:decoding="decoding"
			:style="{ objectFit: fit }"
			@load="handleLoad"
			@error="handleError"
		/>
		<span v-if="state === 'empty' || state === 'error'" class="async-image__fallback">
			<slot name="fallback">{{ placeholderLabel }}</slot>
		</span>
	</span>
</template>

<style scoped>
.async-image {
	position: relative;
	display: inline-grid;
	max-width: 100%;
	place-items: center;
	overflow: hidden;
	vertical-align: middle;
}
.async-image__skeleton,
.async-image img,
.async-image__fallback {
	grid-area: 1 / 1;
}
.async-image__skeleton {
	position: absolute;
	inset: 0;
	background: linear-gradient(100deg, #eee9e1 20%, #faf8f4 40%, #eee9e1 60%);
	background-size: 200% 100%;
	animation: async-image-shimmer 1.25s ease-in-out infinite;
}
.async-image img {
	display: block;
	width: 100%;
	height: 100%;
	max-width: 100%;
	transition: opacity 120ms ease;
}
.async-image--loading img {
	opacity: 0;
}
.async-image__fallback {
	display: inline-grid;
	box-sizing: border-box;
	width: 100%;
	height: 100%;
	min-width: 38px;
	min-height: 38px;
	place-items: center;
	padding: 6px;
	background: #f5f1ea;
	color: #8a8176;
	font-size: 11px;
	line-height: 1.2;
	text-align: center;
}
@keyframes async-image-shimmer {
	to {
		background-position: -200% 0;
	}
}
@media (prefers-reduced-motion: reduce) {
	.async-image__skeleton {
		animation: none;
	}
	.async-image img {
		transition: none;
	}
}
</style>
