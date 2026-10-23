<script setup lang="ts">
import { computed, ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import NativeWarehousesPage from "../features/warehouses/NativeWarehousesPage.vue";
import {
	browseDestination,
	documentDestination,
	exportDestination,
	operationDestination,
	countDestination,
} from "../lib/nativeNavigation";
import { routeTarget } from "../lib/routeRegistry";
import { useRouteBreadcrumbLabel } from "../lib/routeBreadcrumbLabel";
const route = useRoute(),
	router = useRouter(),
	page = ref<InstanceType<typeof NativeWarehousesPage>>();
useRouteBreadcrumbLabel(
	() =>
		page.value?.controller.selected.value?.full_label ||
		page.value?.controller.selected.value?.label,
);
onBeforeRouteLeave(() => page.value?.controller.requestLeave() ?? true);
onBeforeRouteUpdate(() => page.value?.controller.requestLeave() ?? true);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const validQuery = computed(() =>
	["warehouse", "search", "edit", "recovery"].every(
		(key) => route.query[key] === undefined || typeof route.query[key] === "string",
	),
);
function selection(warehouse: string, search: string) {
	if (
		route.params.warehouse ||
		(route.query.warehouse === warehouse && String(route.query.search || "") === search)
	)
		return;
	void router.replace({ query: { ...route.query, warehouse, search: search || undefined } });
}
function back() {
	if (window.history.state.back) router.back();
	else void router.push(routeTarget("warehouses"));
}
function count(warehouse: string) {
	void router.push(countDestination({ warehouse, editor: crypto.randomUUID() }));
}
function operation(kind: string, warehouse: string) {
	void router.push(operationDestination(kind, { warehouse, editor: crypto.randomUUID() }));
}
function saved() {
	document.dispatchEvent(new Event("inventory-configuration-changed"));
}
</script>
<template>
	<NativeWarehousesPage
		v-if="validQuery"
		ref="page"
		:name="text(route.params.warehouse)"
		:initial-warehouse="text(route.query.warehouse)"
		:initial-search="text(route.query.search)"
		:edit-name="text(route.query.edit)"
		:recovery-id="text(route.query.recovery)"
		@selection="selection"
		@warehouse="(name) => router.push(routeTarget('warehouse-detail', { warehouse: name }))"
		@back="back"
		@item="(code) => router.push(routeTarget('item-detail', { code }))"
		@browse="router.push(browseDestination($event))"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@open-loan="(name) => router.push(routeTarget('loan-overview', { name }))"
		@open-export="router.push(exportDestination($event))"
		@new-count="count"
		@new-operation="operation"
		@saved="saved"
	/>
	<p v-else role="alert">仓库链接中的选择无效，请返回仓库列表重新打开。</p>
</template>
