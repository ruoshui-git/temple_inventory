<script setup lang="ts">
import { ref, onDeactivated } from "vue";
import PreviewProduct from "./PreviewProduct.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import type { StockItem } from "./model";
withDefaults(defineProps<{ item: StockItem; interaction?: "detail" | "lightbox" }>(), {
	interaction: "lightbox",
});
const emit = defineEmits<{ detail: [] }>();
const open = ref(false);
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
			<PreviewProduct :kind="item.illustration" :name="item.name" />
		</button>
		<button
			v-if="item.illustration !== 'none'"
			class="preview-image-enlarge"
			:aria-label="`放大查看${item.name}图片`"
			@click.stop="open = true"
		>
			查看大图
		</button>
	</div>
	<PreviewProduct
		v-else-if="item.illustration === 'none'"
		:kind="item.illustration"
		:name="item.name"
	/>
	<button
		v-else
		type="button"
		class="item-image-button"
		:aria-label="`放大查看${item.name}图片`"
		@click.stop="open = true"
	>
		<PreviewProduct :kind="item.illustration" :name="item.name" /><span
			class="image-magnifier"
			aria-hidden="true"
			>⊕</span
		>
	</button>
	<PreviewOverlay v-if="open" :title="`${item.name} · 图片`" @close="open = false"
		><div class="lightbox-image">
			<PreviewProduct :kind="item.illustration" :name="item.name" />
		</div>
		<p class="muted">示意插画 · {{ item.code }}</p></PreviewOverlay
	>
</template>
