<script setup lang="ts">
import { ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import ItemEditorPage from "../features/items/ItemEditorPage.vue";
const editor = ref<InstanceType<typeof ItemEditorPage>>();
onBeforeRouteLeave(() => editor.value?.controller.requestLeave() ?? true);
onBeforeRouteUpdate(() => editor.value?.controller.requestLeave() ?? true);
const route = useRoute(),
	router = useRouter();
</script>
<template>
	<ItemEditorPage
		ref="editor"
		:key="route.fullPath"
		:code="route.params.code ? String(route.params.code) : undefined"
		:barcode="typeof route.query.barcode === 'string' ? route.query.barcode : undefined"
		:recovery-id="typeof route.query.recovery === 'string' ? route.query.recovery : undefined"
		@cancel="router.back()"
		@saved="router.replace(`/item/${encodeURIComponent($event.item_code)}`)"
	/>
</template>
