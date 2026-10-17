<script setup lang="ts">
import { computed, ref, useId } from "vue";
import ItemImage from "./ItemImage.vue";
import InventoryIcon from "./InventoryIcon.vue";
import type { StockItem } from "../lib/stockPresentation";
const props = defineProps<{
	item?: StockItem;
	name: string;
	context: string;
	expanded?: boolean;
}>();
const localOpen = ref(false);
const open = computed(() => props.expanded ?? localOpen.value);
const emit = defineEmits<{ expanded: [open: boolean] }>();
const id = useId();
</script>
<template>
	<article class="preview-group browse-card">
		<div class="preview-group-heading">
			<div v-if="item" class="preview-group-thumbnail">
				<ItemImage :item="item" />
			</div>
			<h2>
				<button
					class="preview-group-trigger"
					:aria-expanded="open"
					:aria-controls="id"
					@click="
						localOpen = !open;
						emit('expanded', localOpen);
					"
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
