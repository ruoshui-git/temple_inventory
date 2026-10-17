<script setup lang="ts">
import { computed, onDeactivated, ref, watch } from "vue";
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
	}>(),
	{ interaction: "lightbox" },
);
const emit = defineEmits<{ detail: [] }>();
const artwork = useItemArtwork();
const hasArtwork = computed(() => props.hasArtwork || artwork?.has(props.item.code));
const open = ref(false);
const source = computed(
	() =>
		props.item.image ||
		props.item.files?.find((file) => file.type.startsWith("image/") && file.state === "ready")
			?.url ||
		"",
);
watch(
	() => [source.value, props.item.code],
	() => {
		open.value = false;
	},
);
onDeactivated(() => {
	open.value = false;
});
</script>
<template>
	<div v-if="interaction === 'detail'" class="preview-item-image">
		<button
			class="preview-image-detail"
			:aria-label="`查看${item.name}详情`"
			@click.stop="emit('detail')"
		>
			<slot v-if="hasArtwork && !source" name="artwork"
				><component v-if="artwork" :is="artwork.component" :code="item.code" /></slot
			><AsyncImage
				v-else
				:src="source"
				:alt="item.name"
				fit="contain"
				width="100%"
				height="100%"
			/>
		</button>
		<button
			v-if="source || hasArtwork"
			class="preview-image-enlarge"
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
		:aria-label="`放大查看${item.name}图片`"
		title="查看大图"
		@click.stop="open = true"
	>
		<slot v-if="hasArtwork && !source" name="artwork"
			><component v-if="artwork" :is="artwork.component" :code="item.code" /></slot
		><AsyncImage
			v-else
			:src="source"
			:alt="item.name"
			fit="contain"
			width="100%"
			height="100%"
		/><span class="image-magnifier" aria-hidden="true">⊕</span>
	</button>
	<AsyncImage v-else :alt="item.name" fit="contain" width="100%" height="100%" />
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
.preview-item-image,
.item-image-button {
	width: 100%;
	height: auto;
	aspect-ratio: 1;
	flex: none;
}
.preview-image-detail {
	display: block;
	width: 100%;
	height: 100%;
}
.preview-item-image :deep(.product-art),
.item-image-button :deep(.product-art) {
	width: 100%;
	height: 100%;
	aspect-ratio: 1;
	object-fit: contain;
}
.lightbox-image :deep(.async-image) {
	max-height: none;
}
</style>
