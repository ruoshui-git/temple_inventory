<script setup lang="ts">
import ProductDetailView from "./ProductDetailView.vue";
import { useProductDetail } from "./useProductDetail";
import type { ReportQuery } from "../../lib/reportContract";
const props = withDefaults(defineProps<{ code: string; tab?: string; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	edit: [code: string];
	back: [];
	tab: [value: string];
	browse: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
	openExport: [query: ReportQuery];
	openBatch: [name: string];
	deleted: [];
}>();
const controller = useProductDetail(props);
defineExpose({ controller });
</script>
<template>
	<ProductDetailView
		:controller="controller"
		:active="active"
		@edit="emit('edit', $event)"
		@back="emit('back')"
		@tab="emit('tab', $event)"
		@browse="emit('browse', $event)"
		@open-document="(doctype, name) => emit('openDocument', doctype, name)"
		@open-loan="emit('openLoan', $event)"
		@open-export="emit('openExport', $event)"
		@open-batch="emit('openBatch', $event)"
		@deleted="emit('deleted')"
	/>
</template>
