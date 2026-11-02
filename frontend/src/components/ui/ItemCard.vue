<script setup lang="ts">
import BrowseCard from "./BrowseCard.vue";
import ItemImage from "../ItemImage.vue";
import UnitText from "./UnitText.vue";
import type { StockItem } from "../../lib/stockPresentation";
import { computed } from "vue";

type CardImage = Pick<StockItem, "code" | "name"> & Partial<Pick<StockItem, "image" | "files">>;
const props = withDefaults(
	defineProps<{
		rowKey: string;
		name: string;
		code?: string;
		category?: string;
		image?: CardImage;
		quantity?: number | string;
		quantityLabel?: string;
		unit?: unknown;
		status?: string;
		statusTone?: "neutral" | "warning" | "danger";
		selecting: boolean;
		selected: boolean;
		selectLabel: string;
		stale?: boolean;
	}>(),
	{ statusTone: "neutral" },
);
const emit = defineEmits<{ open: []; toggle: [] }>();
const mediaItem = computed(
	() => props.image || { code: props.code || "", name: props.name, image: "", files: [] },
);
</script>

<template>
	<BrowseCard
		:row-key="rowKey"
		:selecting="selecting"
		:selected="selected"
		:select-label="selectLabel"
		variant="card"
		:stale="stale"
		class="item-card"
		@open="emit('open')"
		@toggle="emit('toggle')"
	>
		<template #media>
			<div class="item-card-image">
				<slot name="media">
					<ItemImage
						:item="mediaItem"
						frame
						interaction="detail"
						@detail="!selecting && emit('open')"
					/>
				</slot>
			</div>
		</template>
		<template #badges>
			<span v-if="status" class="badge art-badge" :class="statusTone">{{ status }}</span>
		</template>
		<template #default="{ activate }">
			<div class="item-card-content">
				<span class="eyebrow"
					><span class="item-card-category">{{ category || "未分类" }}</span>
					<span class="item-card-code">{{ code }}</span></span
				>
				<button class="item-name" @click="activate">{{ name }}</button>
				<slot name="flags" />
				<div v-if="quantity !== undefined" class="stock-number">
					<span
						><strong>{{ quantity }}</strong> <UnitText :name="unit"
					/></span>
					<small v-if="quantityLabel">{{ quantityLabel }}</small>
				</div>
				<div v-if="$slots.default" class="item-card-details"><slot /></div>
			</div>
		</template>
	</BrowseCard>
</template>
