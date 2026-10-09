<script setup lang="ts">
withDefaults(
	defineProps<{
		image?: string | null;
		alt: string;
		placeholderLabel?: string;
	}>(),
	{ image: null, placeholderLabel: "暂无图片" },
);
</script>

<template>
	<div class="image-forward-card">
		<div class="image-forward-card__media">
			<img v-if="image" :src="image" :alt="alt" loading="lazy" decoding="async" />
			<slot v-else name="placeholder"
				><span aria-hidden="true">□</span><small>{{ placeholderLabel }}</small></slot
			>
		</div>
		<div class="image-forward-card__body"><slot /></div>
	</div>
</template>

<style scoped>
.image-forward-card {
	display: flex;
	min-width: 0;
	flex-direction: column;
	overflow: hidden;
	border-radius: inherit;
}
.image-forward-card__media {
	display: grid;
	width: 100%;
	aspect-ratio: 1;
	place-items: center;
	overflow: hidden;
	background: #f6f4ef;
	color: #aaa397;
}
.image-forward-card__media img {
	width: 100%;
	height: 100%;
	object-fit: contain;
}
.image-forward-card__media :deep(svg) {
	width: 28px;
	height: 28px;
}
.image-forward-card__body {
	min-width: 0;
}
</style>
