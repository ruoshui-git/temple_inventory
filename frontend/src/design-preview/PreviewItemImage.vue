<script setup lang="ts">
import { ref, computed, onDeactivated } from "vue";
import PreviewProduct from "./PreviewProduct.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import type { StockItem } from "./model";
const props = withDefaults(
	defineProps<{ item: StockItem; interaction?: "detail" | "lightbox" }>(),
	{
		interaction: "lightbox",
	},
);
const emit = defineEmits<{ detail: [] }>();
const open = ref(false);
const primary = computed(() =>
	props.item.files?.find(
		(file) => file.type.startsWith("image/") && file.state === "ready" && file.url,
	),
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
			<img
				v-if="primary"
				:src="primary.url"
				:alt="item.name"
				class="uploaded-preview-image"
			/><PreviewProduct v-else :kind="item.illustration" :name="item.name" />
		</button>
		<button
			v-if="primary || item.illustration !== 'none'"
			class="preview-image-enlarge"
			:aria-label="`放大查看${item.name}图片`"
			title="查看大图"
			@click.stop="open = true"
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				width="20"
				height="20"
				fill="none"
				stroke="currentColor"
				stroke-width="1.7"
			>
				<path
					d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8l-5-5m13 5 5-5M8 16l-5 5m13-5 5 5"
				/>
			</svg>
		</button>
	</div>
	<PreviewProduct
		v-else-if="!primary && item.illustration === 'none'"
		:kind="item.illustration"
		:name="item.name"
	/>
	<button
		v-else
		type="button"
		class="item-image-button"
		:aria-label="`放大查看${item.name}图片`"
		title="查看大图"
		@click.stop="open = true"
	>
		<img
			v-if="primary"
			:src="primary.url"
			:alt="item.name"
			class="uploaded-preview-image"
		/><PreviewProduct v-else :kind="item.illustration" :name="item.name" /><span
			class="image-magnifier"
			aria-hidden="true"
			>⊕</span
		>
	</button>
	<PreviewOverlay v-if="open" :title="`${item.name} · 图片`" @close="open = false"
		><div class="lightbox-image">
			<img
				v-if="primary"
				:src="primary.url"
				:alt="item.name"
				class="uploaded-preview-image"
			/><PreviewProduct v-else :kind="item.illustration" :name="item.name" />
		</div>
		<p class="muted">
			{{ primary ? primary.name : "示意插画" }} · {{ item.code }}
		</p></PreviewOverlay
	>
</template>

<style scoped>
.uploaded-preview-image {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
}
.lightbox-image .uploaded-preview-image {
	max-height: 60dvh;
}
</style>
