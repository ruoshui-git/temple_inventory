<script setup lang="ts">
import { ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import ProductDetailPage from "../features/items/ProductDetailPage.vue";
import {
	documentDestination,
	browseDestination,
	exportDestination,
} from "../lib/nativeNavigation";
import { routeTarget } from "../lib/routeRegistry";
import { useRouteBreadcrumbLabel } from "../lib/routeBreadcrumbLabel";
import { useConfirm } from "../services/confirm";
const detail = ref<InstanceType<typeof ProductDetailPage>>();
const { confirm } = useConfirm();
useRouteBreadcrumbLabel(() => detail.value?.controller.item.value?.item_name);
async function leave() {
	if (!detail.value?.controller.conversionDirty.value) return true;
	return confirm({ title: "放弃换算？", message: "尚未保存的常用换算将丢失。" });
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate((to, from) => to.params.code === from.params.code || leave());
const route = useRoute(),
	router = useRouter();
</script>
<template>
	<ProductDetailPage
		ref="detail"
		:code="String(route.params.code)"
		:tab="typeof route.query.tab === 'string' ? route.query.tab : undefined"
		@back="router.back()"
		@edit="router.push(routeTarget('item-edit', { code: $event }))"
		@tab="router.replace({ query: { ...route.query, tab: $event } })"
		@browse="router.push(browseDestination($event))"
		@open-export="router.push(exportDestination($event))"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@open-loan="(name) => router.push(routeTarget('loan-overview', { name }))"
		@deleted="router.push(routeTarget('stock'))"
		@open-batch="
			(name) =>
				router.push({
					...routeTarget('batch-detail', { name }),
					query: { back: route.fullPath },
				})
		"
	/>
</template>
