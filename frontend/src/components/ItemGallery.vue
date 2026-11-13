<script setup lang="ts">
import { computed, ref } from "vue";
import type { StockItem } from "../lib/stockPresentation";
import type { AttachmentEntry } from "../features/attachments/useAttachments";
import { galleryImages, thumbnailUrl } from "../lib/itemImages";
import AsyncImage from "./ui/AsyncImage.vue";
import ItemLightbox from "./ItemLightbox.vue";
import ItemImage from "./ItemImage.vue";

const props = defineProps<{ item: StockItem; attachments: AttachmentEntry[] }>();
const images = computed(() =>
	galleryImages(
		props.item,
		props.attachments
			.filter((file) => file.state === "ready")
			.map((file) => ({
				key: file.id,
				label: file.name,
				type: file.type,
				url: file.url || "",
			})),
	),
);
const selected = ref(0);
const lightbox = ref(false);
let pointerX = 0;
let swiped = false;
function select(index: number) {
	selected.value = Math.max(0, Math.min(index, images.value.length - 1));
}
function move(delta: number) {
	if (images.value.length > 1)
		select((selected.value + delta + images.value.length) % images.value.length);
}
function keydown(event: KeyboardEvent) {
	if (event.key === "ArrowRight") {
		event.preventDefault();
		move(1);
	}
	if (event.key === "ArrowLeft") {
		event.preventDefault();
		move(-1);
	}
	if (event.key === "Enter") {
		event.preventDefault();
		lightbox.value = true;
	}
}
function thumbnailKeydown(event: KeyboardEvent, index: number) {
	if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
	event.preventDefault();
	const delta = event.key === "ArrowRight" ? 1 : -1;
	const next = (index + delta + images.value.length) % images.value.length;
	select(next);
	(event.currentTarget as HTMLElement).parentElement
		?.querySelectorAll<HTMLButtonElement>("button")
		[next]?.focus();
}
function down(event: PointerEvent) {
	pointerX = event.clientX;
}
function up(event: PointerEvent) {
	const distance = event.clientX - pointerX;
	if (Math.abs(distance) > 40) {
		swiped = true;
		window.setTimeout(() => (swiped = false), 500);
		move(distance < 0 ? 1 : -1);
	}
}
function activateHero() {
	if (swiped) {
		swiped = false;
		return;
	}
	lightbox.value = true;
}
function displayUrl(index: number, size: number) {
	const image = images.value[index];
	if (!image) return "";
	if (!image.primary) return image.url;
	return thumbnailUrl(props.item.code, image.url, size);
}
</script>

<template>
	<div class="item-gallery">
		<button
			v-if="images.length"
			class="item-gallery-hero"
			:aria-label="`查看${item.name}图片大图`"
			tabindex="0"
			@keydown="keydown"
			@pointerdown="down"
			@pointerup="up"
			@click="activateHero"
		>
			<AsyncImage
				:src="displayUrl(selected, 360)"
				:alt="item.name"
				fit="contain"
				width="100%"
				height="100%"
			/>
		</button>
		<div v-else class="item-gallery-hero">
			<ItemImage :item="item" frame />
		</div>
		<div
			v-if="images.length > 1"
			class="item-gallery-thumbs"
			role="listbox"
			aria-label="物品图片"
		>
			<button
				v-for="(image, index) in images"
				:key="image.key"
				:aria-label="image.label"
				:aria-selected="selected === index"
				:class="{ selected: selected === index }"
				role="option"
				@keydown="thumbnailKeydown($event, index)"
				@click="select(index)"
			>
				<AsyncImage
					:src="displayUrl(index, 52)"
					:alt="image.label"
					fit="contain"
					width="100%"
					height="100%"
				/>
			</button>
		</div>
		<ItemLightbox
			v-if="lightbox && images.length"
			:item="item"
			:images="images"
			v-model:index="selected"
			@close="lightbox = false"
		/>
	</div>
</template>

<style scoped>
.item-gallery {
	min-width: 0;
}
.item-gallery-hero {
	display: block;
	width: 100%;
	aspect-ratio: 1;
	padding: 0;
	border: 0;
	border-radius: var(--p-radius-card);
	background: var(--p-soft);
	overflow: hidden;
	cursor: zoom-in;
	touch-action: pan-y;
}
.item-gallery-hero :deep(.async-image),
.item-gallery-hero :deep(.item-image) {
	width: 100%;
	height: 100%;
}
.item-gallery-thumbs {
	display: flex;
	gap: var(--p-field-gap);
	overflow-x: auto;
	padding: var(--p-control-pad-y) var(--p-field-gap);
}
.item-gallery-thumbs button {
	flex: 0 0 52px;
	width: 52px;
	height: 52px;
	padding: 3px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	background: var(--p-surface);
}
.item-gallery-thumbs button.selected {
	outline: 2px solid var(--p-accent);
	outline-offset: 1px;
}
</style>
