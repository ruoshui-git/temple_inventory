<script setup lang="ts">
import { ref } from "vue";
import PreviewProduct from "./PreviewProduct.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import type { StockItem } from "./model";
defineProps<{ item: StockItem }>();
const open = ref(false);
</script>
<template>
	<PreviewProduct
		v-if="item.illustration === 'none'"
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
		><p class="preview-image-experiment">图片灯箱是实验交互，正式物品卡片图片保持不可点击。</p>
		<div class="lightbox-image">
			<PreviewProduct :kind="item.illustration" :name="item.name" />
		</div>
		<p class="muted">示意插画 · {{ item.code }}</p></PreviewOverlay
	>
</template>
