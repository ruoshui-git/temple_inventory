<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useItemArtwork } from "../services/itemArtwork";
import { browseSelectingKey } from "../composables/useBrowseSelection";
import { thumbnailUrl } from "../lib/itemImages";
import AsyncImage from "./ui/AsyncImage.vue";
import ItemLightbox from "./ItemLightbox.vue";
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
const selecting = inject(browseSelectingKey, null);
const hasArtwork = computed(() => props.hasArtwork || artwork?.has(props.item.code));
const open = ref(false);
const lightboxIndex = ref(0);
const source = computed(() => props.item.image || "");
const displayHost = ref<HTMLElement>();
const renderedWidth = ref(0);
const pixelRatio = ref(1);
const hostMeasured = ref(false);
let resizeObserver: ResizeObserver | undefined;
const updateRatio = () => (pixelRatio.value = window.devicePixelRatio || 1);
const derivativeSource = computed(() => {
	if (!source.value || !hostMeasured.value) return "";
	const cssWidth = renderedWidth.value || props.targetSize || props.thumbnailSize || 160;
	return thumbnailUrl(props.item.code, source.value, cssWidth, pixelRatio.value);
});
function showLightbox() {
	lightboxIndex.value = 0;
	open.value = true;
}
onMounted(() => {
	updateRatio();
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
watch(
	() => selecting?.value,
	(value) => {
		if (value) open.value = false;
	},
);
onDeactivated(() => {
	open.value = false;
});
</script>
<template>
	<div
		v-if="selecting"
		class="item-image"
		ref="displayHost"
		:class="{ 'item-image--frame': frame }"
		:style="targetSize ? { width: `${targetSize}px`, height: `${targetSize}px` } : undefined"
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
		/>
	</div>
	<div
		v-else-if="interaction === 'detail'"
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
			@click.stop="showLightbox"
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
		@click.stop="showLightbox"
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
	<ItemLightbox
		v-if="open"
		:item="item"
		v-model:index="lightboxIndex"
		:has-artwork="hasArtwork && !source"
		@close="open = false"
	>
		<template #artwork>
			<slot v-if="hasArtwork && !source" name="artwork">
				<component v-if="artwork" :is="artwork.component" :code="item.code" />
			</slot>
		</template>
	</ItemLightbox>
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
</style>
