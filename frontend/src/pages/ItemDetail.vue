<script setup lang="ts">
import { ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import ProductDetailPage from "../features/items/ProductDetailPage.vue";
import {
	documentDestination,
	browseDestination,
	exportDestination,
} from "../lib/nativeNavigation";
const detail = ref<InstanceType<typeof ProductDetailPage>>();
function leave() {
	if (!detail.value?.controller.conversionDirty.value) return true;
	detail.value.controller.error.value = "请先保存或放弃尚未应用的换算后离开";
	return false;
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
		@edit="router.push(`/item/${encodeURIComponent($event)}/edit`)"
		@tab="router.replace({ query: { ...route.query, tab: $event } })"
		@browse="router.push(browseDestination($event))"
		@open-export="router.push(exportDestination($event))"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
	/>
</template>
