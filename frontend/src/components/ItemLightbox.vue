<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { fileMime, type NativeFile } from "../lib/catalogPresentation";
import { galleryImages, originalUrl, type ItemGalleryImage } from "../lib/itemImages";
import { useOptionalInventoryServices } from "../services/contracts";
import AsyncImage from "./ui/AsyncImage.vue";
import Overlay from "./ui/Overlay.vue";

const props = withDefaults(
	defineProps<{
		item: { code: string; name: string; image?: string | null };
		images?: ItemGalleryImage[];
		index?: number;
		hasArtwork?: boolean;
	}>(),
	{ index: 0, hasArtwork: false },
);
const emit = defineEmits<{ close: []; "update:index": [index: number] }>();
const services = useOptionalInventoryServices();
const loadedImages = ref<ItemGalleryImage[]>(galleryImages(props.item, []));
const visibleImages = computed(() => props.images ?? loadedImages.value);
const selected = computed(() =>
	visibleImages.value.length
		? Math.max(0, Math.min(props.index, visibleImages.value.length - 1))
		: 0,
);
const current = computed(() => visibleImages.value[selected.value]);
let request: AbortController | undefined;
let generation = 0;
let pointerX = 0;
let swiped = false;

function move(delta: number) {
	const count = visibleImages.value.length;
	if (count > 1) emit("update:index", (selected.value + delta + count) % count);
}
function keydown(event: KeyboardEvent) {
	if (event.key === "ArrowRight") {
		event.preventDefault();
		move(1);
	} else if (event.key === "ArrowLeft") {
		event.preventDefault();
		move(-1);
	}
}
function pointerDown(event: PointerEvent) {
	pointerX = event.clientX;
}
function pointerUp(event: PointerEvent) {
	const distance = event.clientX - pointerX;
	if (Math.abs(distance) > 40) {
		swiped = true;
		window.setTimeout(() => (swiped = false), 500);
		move(distance < 0 ? 1 : -1);
	}
}
function suppressSwipeClick(event: MouseEvent) {
	if (!swiped) return;
	swiped = false;
	event.preventDefault();
	event.stopPropagation();
}
function fetchImages() {
	request?.abort();
	const currentGeneration = ++generation;
	loadedImages.value = galleryImages(props.item, []);
	if (props.images || !services || (props.hasArtwork && !props.item.image) || !props.item.code)
		return;
	const controller = new AbortController();
	request = controller;
	void services
		.call<NativeFile[]>(
			"native_files.attachments",
			{ doctype: "Item", name: props.item.code },
			controller.signal,
		)
		.then((files) => {
			if (controller.signal.aborted || currentGeneration !== generation) return;
			const normalized = files.map((file) => ({
				key: file.name,
				label: file.file_name,
				type: fileMime(file),
				url: services.fileDisplayUrl?.(file) || file.file_url,
			}));
			loadedImages.value = galleryImages(props.item, normalized);
		})
		.catch(() => {
			// Keep the cover visible when attachments are unavailable.
		});
}
onMounted(fetchImages);
watch(() => [props.item.code, props.item.image], fetchImages);
onMounted(() => document.addEventListener("keydown", keydown));
onBeforeUnmount(() => {
	generation++;
	request?.abort();
	document.removeEventListener("keydown", keydown);
});
function original(image: ItemGalleryImage) {
	return image.primary ? originalUrl(props.item.code, image.url) : image.url;
}
watch(
	() => [visibleImages.value, selected.value] as const,
	([images, index]) => {
		if (images.length < 2) return;
		for (const neighbour of [
			images[(index - 1 + images.length) % images.length],
			images[(index + 1) % images.length],
		]) {
			if (neighbour) new Image().src = original(neighbour);
		}
	},
	{ immediate: true },
);
</script>

<template>
	<Overlay :title="`${item.name} · 图片`" @close="emit('close')">
		<div class="item-lightbox">
			<div class="item-lightbox-stage">
				<button
					v-if="visibleImages.length > 1"
					type="button"
					aria-label="上一张"
					@click="move(-1)"
				>
					‹
				</button>
				<div
					class="item-lightbox-artwork lightbox-image"
					@pointerdown="pointerDown"
					@pointerup="pointerUp"
					@click="suppressSwipeClick"
				>
					<slot v-if="hasArtwork && !item.image" name="artwork" />
					<AsyncImage
						v-else
						natural
						:src="current ? original(current) : ''"
						:alt="item.name"
						fit="contain"
						width="100%"
						height="100%"
					>
						<template #fallback>图片加载失败，请稍后重试</template>
					</AsyncImage>
				</div>
				<button
					v-if="visibleImages.length > 1"
					type="button"
					aria-label="下一张"
					@click="move(1)"
				>
					›
				</button>
			</div>
			<p class="item-lightbox-caption muted" aria-live="polite">
				<span v-if="visibleImages.length > 1"
					>{{ selected + 1 }} / {{ visibleImages.length }} · </span
				>{{ item.code }}
			</p>
		</div>
	</Overlay>
</template>

<style scoped>
.item-lightbox {
	min-width: 0;
}
.item-lightbox-stage {
	display: flex;
	align-items: center;
	gap: var(--p-control-gap);
	height: min(70dvh, 720px);
	min-height: 160px;
	touch-action: pan-y;
}
.item-lightbox-artwork {
	flex: 1;
	min-width: 0;
	height: 100%;
}
.item-lightbox-artwork :deep(.async-image) {
	width: 100%;
	height: 100%;
	max-height: none;
}
.item-lightbox-artwork :deep(.product-art) {
	width: 100%;
	height: 100%;
	object-fit: contain;
}
.item-lightbox-stage > button {
	flex: none;
	min-width: 44px;
	min-height: 44px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	background: var(--p-surface);
	color: var(--p-ink);
	/* Optical arrow glyph size. */
	font-size: 1.75rem;
}
.item-lightbox-caption {
	margin: var(--p-field-gap) 0 0;
	text-align: center;
}
</style>
