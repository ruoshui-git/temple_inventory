<script setup lang="ts">
import { exportDestination } from "../lib/nativeNavigation";
import { computed, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import CountEditorPage from "../features/counts/CountEditorPage.vue";
import OpeningEditorView from "../features/opening/OpeningEditorView.vue";
import { useInventoryServices } from "../services/contracts";
import { useNativeEditorRoute } from "../lib/nativeEditorRoute";
import { documentDestination } from "../lib/nativeNavigation";
import { routeTarget } from "../lib/routeRegistry";
import type { NativeDocument } from "../features/documents/nativeEditor";
import DocumentLoadingState from "../components/ui/DocumentLoadingState.vue";
import ForbiddenState from "../components/ui/ForbiddenState.vue";
import { isForbiddenError } from "../lib/serviceFailure";
import UiButton from "../components/ui/UiButton.vue";

const route = useRoute(),
	router = useRouter();
const editor = ref<InstanceType<typeof CountEditorPage>>();
const openingEditor = ref<InstanceType<typeof OpeningEditorView>>();
const services = useInventoryServices();
const name = computed(() => (route.params.name ? String(route.params.name) : undefined));
const opening = ref<boolean>();
const dispatching = ref(false),
	dispatchError = ref(""),
	dispatchForbidden = ref(false),
	initialDocument = ref<NativeDocument>();
let dispatchEpoch = 0;
async function dispatchDocument() {
	const epoch = ++dispatchEpoch;
	dispatchError.value = "";
	dispatchForbidden.value = false;
	initialDocument.value = undefined;
	if (!name.value) {
		dispatching.value = false;
		opening.value = route.name === "opening-new";
		return;
	}
	dispatching.value = true;
	opening.value = undefined;
	try {
		const doc = await services.call<NativeDocument>("native_api.load_document", {
			doctype: "Stock Reconciliation",
			name: name.value,
		});
		if (epoch !== dispatchEpoch) return;
		initialDocument.value = doc;
		opening.value = doc.purpose === "Opening Stock";
	} catch (error) {
		if (epoch !== dispatchEpoch) return;
		dispatchForbidden.value = isForbiddenError(error);
		dispatchError.value = error instanceof Error ? error.message : "记录读取失败，请重试。";
	} finally {
		if (epoch === dispatchEpoch) dispatching.value = false;
	}
}
watch(name, () => void dispatchDocument(), { immediate: true });
watch(
	() => route.name,
	() => {
		if (!name.value) void dispatchDocument();
	},
);
useNativeEditorRoute(() => openingEditor.value?.controller || editor.value?.controller);
onBeforeRouteLeave(
	() =>
		openingEditor.value?.controller.requestLeave() ??
		editor.value?.controller.requestLeave() ??
		true,
);
onBeforeRouteUpdate(
	() =>
		openingEditor.value?.controller.requestLeave() ??
		editor.value?.controller.requestLeave() ??
		true,
);
function back() {
	const state = window.history.state as { back?: unknown; tiOverlay?: unknown };
	if (state.back) {
		if (state.tiOverlay) window.history.go(-2);
		else router.back();
	} else void router.push(routeTarget("counts"));
}
function nextCount() {
	void router.push(routeTarget("count-new", {}, { editor: crypto.randomUUID() }));
}
</script>
<template>
	<DocumentLoadingState v-if="dispatching" label="盘点记录加载中…" :announce="false" />
	<ForbiddenState v-else-if="dispatchForbidden" @back="router.push(routeTarget('counts'))" />
	<p v-else-if="dispatchError" class="notice-bar danger" role="alert">
		{{ dispatchError }}
		<UiButton @click="dispatchDocument">重新读取</UiButton>
	</p>
	<OpeningEditorView
		v-else-if="opening"
		:key="name || 'opening-new'"
		ref="openingEditor"
		:name="name"
		:recovery-id="typeof route.query.recovery === 'string' ? route.query.recovery : undefined"
		:initial-document="initialDocument"
	/>
	<CountEditorPage
		v-else-if="opening === false"
		:key="name || 'count-new'"
		ref="editor"
		:name="name"
		:warehouse="typeof route.query.warehouse === 'string' ? route.query.warehouse : undefined"
		:recovery-id="typeof route.query.recovery === 'string' ? route.query.recovery : undefined"
		:initial-document="initialDocument"
		@back="back"
		@open-export="router.push(exportDestination($event))"
		@new-count="nextCount"
		@open-document="
			(doctype, documentName) => router.push(documentDestination(doctype, documentName))
		"
	/>
</template>
