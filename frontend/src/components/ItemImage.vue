<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useItemArtwork } from "../services/itemArtwork";
import AsyncImage from "./ui/AsyncImage.vue";
import Overlay from "./ui/Overlay.vue";
import InventoryIcon from "./InventoryIcon.vue";
import type { StockItem } from "../lib/stockPresentation";
const props = withDefaults(
	defineProps<{
		item: Pick<StockItem, "code" | "name" | "image" | "files">;
		interaction?: "detail" | "lightbox";
		hasArtwork?: boolean;
		frame?: boolean;
		thumbnailSize?: number;
		targetSize?: number;
		fit?: "contain" | "cover";
	}>(),
	{ interaction: "lightbox", frame: false, fit: "contain" },
);
const emit = defineEmits<{ detail: [] }>();
const artwork = useItemArtwork();
const hasArtwork = computed(() => props.hasArtwork || artwork?.has(props.item.code));
const open = ref(false);
const source = computed(() => props.item.image || "");
const displayHost = ref<HTMLElement>();
const renderedWidth = ref(0);
const pixelRatio = ref(1);
const hostMeasured = ref(false);
let resizeObserver: ResizeObserver | undefined;
const updateRatio = () => (pixelRatio.value = window.devicePixelRatio || 1);
function imageVersion(url: string) {
	let hash = 2166136261;
	for (const byte of new TextEncoder().encode(url))
		hash = Math.imul(hash ^ byte, 16777619) >>> 0;
	return hash.toString(16).padStart(8, "0");
}
const derivativeSource = computed(() => {
	if (!source.value || !hostMeasured.value) return "";
	const cssWidth = renderedWidth.value || props.targetSize || props.thumbnailSize || 160;
	const size = cssWidth * pixelRatio.value > 160 ? 640 : 160;
	return `/api/method/temple_inventory.item_images.thumbnail?item=${encodeURIComponent(props.item.code)}&size=${size}&v=${imageVersion(source.value)}`;
});
onMounted(() => {
	pixelRatio.value = window.devicePixelRatio || 1;
	renderedWidth.value =
		displayHost.value?.getBoundingClientRect().width ||
		props.targetSize ||
		props.thumbnailSize ||
		160;
	hostMeasured.value = true;
	window.addEventListener("resize", updateRatio);
	if (displayHost.value && typeof ResizeObserver !== "undefined") {
		resizeObserver = new ResizeObserver(([entry]) => {
			renderedWidth.value = entry?.contentRect.width || 0;
		});
		resizeObserver.observe(displayHost.value);
	}
});
onBeforeUnmount(() => {
	window.removeEventListener("resize", updateRatio);
	resizeObserver?.disconnect();
});
watch([source, () => props.item.code], () => {
	open.value = false;
});
onDeactivated(() => {
	open.value = false;
});
</script>
<template>
	<div
		v-if="interaction === 'detail'"
		class="item-image"
		ref="displayHost"
		:class="{ 'item-image--frame': frame }"
	>
		<button
			class="item-image-detail"
			:aria-label="`查看${item.name}详情`"
			@click.stop="emit('detail')"
		>
			<slot v-if="hasArtwork && !source" name="artwork"
				><component v-if="artwork" :is="artwork.component" :code="item.code" /></slot
			><AsyncImage
				v-else
				:src="derivativeSource"
				:alt="item.name"
				:fit="fit"
				width="100%"
				height="100%"
			/>
		</button>
		<button
			v-if="source || hasArtwork"
			class="item-image-enlarge"
			:aria-label="`放大查看${item.name}图片`"
			title="查看大图"
			@click.stop="open = true"
		>
			<InventoryIcon name="expand" />
		</button>
	</div>
	<button
		v-else-if="source || hasArtwork"
		type="button"
		class="item-image-button"
		ref="displayHost"
		:class="{
			'item-image-button--frame': frame,
			'item-image-button--compact-target': targetSize,
		}"
		:aria-label="`放大查看${item.name}图片`"
		title="查看大图"
		:style="targetSize ? { width: `${targetSize}px`, height: `${targetSize}px` } : undefined"
		@click.stop="open = true"
	>
		<slot v-if="hasArtwork && !source" name="artwork"
			><component v-if="artwork" :is="artwork.component" :code="item.code" /></slot
		><AsyncImage
			v-else
			:src="derivativeSource"
			:alt="item.name"
			:fit="fit"
			:width="thumbnailSize || '100%'"
			:height="thumbnailSize || '100%'"
		/><span class="image-magnifier" aria-hidden="true"
			><svg viewBox="0 0 16 16" focusable="false">
				<path
					d="M6 2H2v4M2.2 2.2 7 7m3-5h4v4m-.2-3.8L9 7m5 3v4h-4m3.8-.2L9 9m-3 5H2v-4m.2 3.8L7 9"
				/></svg
		></span>
	</button>
	<div v-else-if="frame" class="item-image item-image--frame">
		<AsyncImage :alt="item.name" fit="contain" width="100%" height="100%" />
	</div>
	<AsyncImage
		v-else
		:alt="item.name"
		fit="contain"
		:width="thumbnailSize || '100%'"
		:height="thumbnailSize || '100%'"
	/>
	<Overlay v-if="open" :title="`${item.name} · 图片`" @close="open = false"
		><div class="lightbox-image">
			<slot v-if="hasArtwork && !source" name="artwork"
				><component v-if="artwork" :is="artwork.component" :code="item.code" /></slot
			><AsyncImage
				natural
				v-else
				:src="source"
				:alt="item.name"
				fit="contain"
				width="100%"
				height="100%"
			/>
		</div>
		<p class="muted">{{ item.code }}</p></Overlay
	>
</template>

<style scoped>
.item-image,
.item-image-button {
	width: 100%;
	height: auto;
	aspect-ratio: 1;
	flex: none;
}
.item-image-button--compact-target {
	display: grid;
	place-items: center;
}
.item-image-button--compact-target .image-magnifier {
	display: none;
}
.item-image--frame,
.item-image-button--frame {
	width: 100%;
	height: 100%;
	min-height: 0;
	aspect-ratio: auto;
}
.item-image--frame :deep(.async-image),
.item-image-button--frame :deep(.async-image) {
	width: 100% !important;
	height: 100% !important;
	aspect-ratio: auto !important;
}
.item-image-detail {
	display: block;
	width: 100%;
	height: 100%;
}
.item-image :deep(.product-art),
.item-image-button :deep(.product-art) {
	width: 100%;
	height: 100%;
	aspect-ratio: 1;
	object-fit: contain;
}
.item-image--frame :deep(.product-art),
.item-image-button--frame :deep(.product-art) {
	width: 100%;
	height: 100%;
	aspect-ratio: auto;
	object-fit: contain;
}
.lightbox-image :deep(.async-image) {
	max-height: none;
}
</style>
