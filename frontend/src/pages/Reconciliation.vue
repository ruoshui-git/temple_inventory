<script setup lang="ts">
import { exportDestination } from "../lib/nativeNavigation";
import { computed, ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import CountEditorPage from "../features/counts/CountEditorPage.vue";
import { useNativeEditorRoute } from "../lib/nativeEditorRoute";
import { documentDestination } from "../lib/nativeNavigation";
import { routeTarget } from "../lib/routeRegistry";
const route = useRoute(),
	router = useRouter();
const editor = ref<InstanceType<typeof CountEditorPage>>();
useNativeEditorRoute(() => editor.value?.controller);
const name = computed(() => (route.params.name ? String(route.params.name) : undefined));
onBeforeRouteLeave(() => editor.value?.controller.requestLeave() ?? true);
onBeforeRouteUpdate(() => editor.value?.controller.requestLeave() ?? true);
function back() {
	if (window.history.state.back) router.back();
	else void router.push(routeTarget("counts"));
}
function nextCount() {
	void router.push(routeTarget("count-new", {}, { editor: crypto.randomUUID() }));
}
</script>
<template>
	<CountEditorPage
		ref="editor"
		:name="name"
		:warehouse="typeof route.query.warehouse === 'string' ? route.query.warehouse : undefined"
		:recovery-id="typeof route.query.recovery === 'string' ? route.query.recovery : undefined"
		@back="back"
		@open-export="router.push(exportDestination($event))"
		@new-count="nextCount"
		@open-document="
			(doctype, documentName) => router.push(documentDestination(doctype, documentName))
		"
	/>
</template>
