<script setup lang="ts">
import { exportDestination } from "../lib/nativeNavigation";
import { computed, ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { decodeItemSelection } from "../lib/routeSelection";
import CountEditorPage from "../features/counts/CountEditorPage.vue";
import { useNativeEditorRoute } from "../lib/nativeEditorRoute";
const route = useRoute(),
	router = useRouter();
const editor = ref<InstanceType<typeof CountEditorPage>>();
useNativeEditorRoute(() => editor.value?.controller);
const selection = computed(() => decodeItemSelection(route.query.items));
const name = computed(() => (route.params.name ? String(route.params.name) : undefined));
onBeforeRouteLeave(() => editor.value?.controller.requestLeave() ?? true);
onBeforeRouteUpdate(() => editor.value?.controller.requestLeave() ?? true);
function back() {
	if (window.history.state.back) router.back();
	else void router.push("/counts");
}
function nextCount() {
	void router.push({ path: "/reconcile/new", query: { editor: crypto.randomUUID() } });
}
</script>
<template>
	<CountEditorPage
		v-if="!selection.error"
		ref="editor"
		:key="name || String(route.query.editor || 'new')"
		:name="name"
		:initial-items="selection.items"
		:warehouse="typeof route.query.warehouse === 'string' ? route.query.warehouse : undefined"
		:recovery-id="typeof route.query.recovery === 'string' ? route.query.recovery : undefined"
		@back="back"
		@open-export="router.push(exportDestination($event))"
		@new-count="nextCount"
		@open-document="
			(doctype, documentName) =>
				router.push(
					`/documents/${encodeURIComponent(doctype)}/${encodeURIComponent(documentName)}`,
				)
		"
	/>
	<p v-else role="alert">{{ selection.error }}</p>
</template>
