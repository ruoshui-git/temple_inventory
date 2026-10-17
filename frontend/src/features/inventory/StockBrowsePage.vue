<script setup lang="ts">
import StockBrowseView from "./StockBrowseView.vue";
import { useStockBrowseController } from "./useStockBrowseController";
import type { StockItem } from "../../lib/stockPresentation";
import type { ReportQuery } from "../../lib/reportContract";
import UiButton from "../../components/ui/UiButton.vue";
const props = withDefaults(
	defineProps<{
		active?: boolean;
		queryError?: string;
		initialQuery?: ReportQuery;
		hasArtwork?: (item: StockItem) => boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	newOperation: [kind: string, itemCodes?: string[]];
	openItem: [code: string];
	queryChange: [query: ReportQuery];
	openExport: [query: ReportQuery];
	clearRoute: [];
}>();
const controller = useStockBrowseController(
	props,
	(kind, codes) => emit("newOperation", kind, codes),
	(code) => emit("openItem", code),
	(query) => emit("queryChange", query),
);
defineExpose({ controller });
</script>
<template>
	<section v-if="controller.scopeError.value" class="surface form-section">
		<h1>库存</h1>
		<p role="alert">{{ controller.scopeError.value }}</p>
		<UiButton @click="emit('clearRoute')">打开库存默认范围</UiButton>
	</section>
	<StockBrowseView
		v-else
		:controller="controller"
		:query-error="queryError"
		:has-artwork="hasArtwork"
		:active="active"
		@open-export="emit('openExport', $event)"
		><template #artwork="{ item }"><slot name="artwork" :item="item" /></template
		><template #context><slot name="context" /></template
		><template #context-actions><slot name="context-actions" /></template
	></StockBrowseView>
</template>
