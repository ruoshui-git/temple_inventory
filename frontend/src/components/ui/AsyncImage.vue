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
		natural?: boolean;
		fit?: "contain" | "cover" | "fill" | "none" | "scale-down";
		placeholderLabel?: string;
		class?: string | string[] | Record<string, boolean>;
	}>(),
	{
		src: "",
		loading: "lazy",
		decoding: "async",
		fit: "contain",
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
		:style="{
			width: dimension(width ?? height) || '100%',
			height: 'auto',
			aspectRatio: natural ? undefined : '1',
		}"
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
			:style="{
				objectFit: fit,
				height: natural ? 'auto' : '100%',
				position: natural ? 'static' : 'absolute',
				inset: natural ? undefined : '0',
			}"
			@load="handleLoad"
			@error="handleError"
		/>
		<span
			v-if="state === 'empty' || state === 'error'"
			class="async-image__fallback"
			:title="state === 'error' ? '图片加载失败' : placeholderLabel"
		>
			<slot name="fallback">
				<svg
					class="async-image__placeholder"
					viewBox="0 0 32 32"
					fill="none"
					aria-hidden="true"
					focusable="false"
				>
					<rect x="4.5" y="5.5" width="23" height="21" rx="3" />
					<circle cx="12" cy="12" r="2.25" />
					<path d="m7 23 6-6 4 4 3-3 5 5" />
				</svg>
				<span class="async-image__fallback-label sr-only">{{
					state === "error" ? "图片加载失败" : placeholderLabel
				}}</span>
			</slot>
		</span>
	</span>
</template>

<style scoped>
.async-image {
	position: relative;
	display: inline-grid;
	container-name: async-image;
	container-type: inline-size;
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
	background: linear-gradient(
		100deg,
		var(--p-soft) 20%,
		var(--p-surface) 40%,
		var(--p-soft) 60%
	);
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
	display: grid;
	box-sizing: border-box;
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
	place-items: center;
	padding: 2px;
	background: var(--p-canvas);
	color: var(--p-muted);
	text-align: center;
}
.async-image__placeholder {
	width: min(28px, 70%);
	height: min(28px, 70%);
	stroke: currentColor;
	stroke-width: 1.6;
	stroke-linecap: round;
	stroke-linejoin: round;
}
@container async-image (max-width: 32px) {
	.async-image__fallback {
		padding: 0;
		gap: 0;
	}
	.async-image__placeholder {
		width: 65%;
		height: 65%;
	}
	.async-image__placeholder {
		grid-area: 1 / 1;
	}
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
