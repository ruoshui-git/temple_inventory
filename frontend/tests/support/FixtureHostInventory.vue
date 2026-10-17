<script setup lang="ts">
import PreviewProduct from "./FixtureHostProduct.vue";
import StockBrowsePage from "../../src/features/inventory/StockBrowsePage.vue";
import { provideGalleryReference } from "./fixtureReference";
import { openFullReport } from "./reportModel";
import { newReportQuery } from "../../src/lib/reportContract";
import { computed } from "vue";
import { reviewSession } from "./reviewModel";
provideGalleryReference();
const props = withDefaults(
	defineProps<{ pattern?: string; variant?: string; active?: boolean }>(),
	{ active: true },
);
const emit = defineEmits<{
	receive: [];
	navigate: [page: string, variant: string];
	notify: [message: string];
}>();
const query = computed(() => {
	const value = newReportQuery("inventory");
	value.scope = JSON.parse(JSON.stringify(reviewSession.filters.inventory.scope));
	if (props.variant === "filtered") value.search = "东北";
	if (props.variant === "empty") value.search = "无匹配示例";
	return value;
});
</script>
<template>
	<StockBrowsePage
		:active="active"
		:has-artwork="
			(item) =>
				reviewSession.stock.find((row) => row.code === item.code)?.illustration !== 'none'
		"
		:initial-query="query"
		@new-operation="
			(kind) =>
				kind === 'Item'
					? emit('navigate', 'item-form', 'new')
					: kind === 'Receive'
						? emit('receive')
						: emit('navigate', 'movement-form', kind)
		"
		@open-item="
			(code) => {
				reviewSession.selectedItemCode = code;
				emit('navigate', 'item-detail', 'overview');
			}
		"
		@open-export="
			(value) => {
				openFullReport(value);
				emit('navigate', 'reports', value.dataset);
			}
		"
		><template #artwork="{ item }"
			><PreviewProduct
				:kind="
					reviewSession.stock.find((row) => row.code === item.code)?.illustration ||
					'none'
				"
				:name="item.name" /></template
		><template #context><slot name="context" /></template
		><template #context-actions><slot name="context-actions" /></template
	></StockBrowsePage>
</template>
