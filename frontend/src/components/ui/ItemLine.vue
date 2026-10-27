<script setup lang="ts">
import ItemImage from "../ItemImage.vue";
import type { StockItem } from "../../lib/stockPresentation";

withDefaults(
	defineProps<{
		item: Pick<StockItem, "code" | "name" | "image" | "files">;
		size?: number;
		interactive?: boolean;
	}>(),
	{ size: 24, interactive: false },
);
const emit = defineEmits<{ open: [code: string] }>();
</script>

<template>
	<span class="item-line">
		<ItemImage :item="item" :thumbnail-size="size" :target-size="size" />
		<span class="item-line-text">
			<button
				v-if="interactive"
				type="button"
				class="item-line-name"
				:title="item.name"
				@click="emit('open', item.code)"
			>
				{{ item.name }}
			</button>
			<strong v-else class="item-line-name" :title="item.name">{{ item.name }}</strong>
			<small v-if="$slots.secondary" class="item-line-secondary"
				><slot name="secondary"
			/></small>
		</span>
	</span>
</template>
