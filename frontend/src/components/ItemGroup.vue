<script setup lang="ts">
import { computed, ref, useId } from "vue";
import ItemImage from "./ItemImage.vue";
import DisclosureIcon from "./ui/DisclosureIcon.vue";
import type { StockItem } from "../lib/stockPresentation";
const props = defineProps<{
	item?: StockItem;
	name: string;
	context: string;
	summary?: string;
	mobileList?: boolean;
	expanded?: boolean;
}>();
const localOpen = ref(false);
const open = computed(() => props.expanded ?? localOpen.value);
const emit = defineEmits<{ expanded: [open: boolean] }>();
const id = useId();
</script>
<template>
	<article
		class="preview-group"
		:class="{
			'preview-group--mobile-list': mobileList,
			'browse-card': !mobileList,
		}"
	>
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
					<template v-if="mobileList">
						<span class="preview-group-identity"
							><strong>{{ name }}</strong
							><small>{{ context }}</small></span
						><span class="preview-group-metrics">{{ summary }}</span>
						<DisclosureIcon variant="inline" />
					</template>
					<template v-else>
						<DisclosureIcon variant="inline" />
						<span
							><strong>{{ name }}</strong
							><small>{{ context }}</small
							><span v-if="summary" class="preview-group-metrics">{{
								summary
							}}</span>
							<span v-else class="preview-group-metrics"
								><slot name="metrics" /></span
						></span>
					</template>
				</button>
			</h2>
		</div>
		<div v-show="open" :id="id" class="preview-group-content"><slot /></div>
	</article>
</template>
