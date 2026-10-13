<script setup lang="ts">
import { ref, useId } from "vue";
import PreviewItemImage from "../PreviewItemImage.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import type { StockItem } from "../model";
defineProps<{ item?: StockItem; name: string; context: string }>();
const open = ref(false);
const id = useId();
</script>
<template>
	<article class="preview-group browse-card">
		<div class="preview-group-heading">
			<div v-if="item" class="preview-group-thumbnail">
				<PreviewItemImage :item="item" />
			</div>
			<h2>
				<button
					class="preview-group-trigger"
					:aria-expanded="open"
					:aria-controls="id"
					@click="open = !open"
				>
					<span
						><strong>{{ name }}</strong
						><small>{{ context }}</small
						><span class="preview-group-metrics"><slot name="metrics" /></span
					></span>
					<InventoryIcon name="chevron-down" :class="{ 'is-expanded': open }" />
				</button>
			</h2>
		</div>
		<div v-show="open" :id="id"><slot /></div>
	</article>
</template>
