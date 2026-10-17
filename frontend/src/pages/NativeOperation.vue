<script setup lang="ts">
import { computed, ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import OperationEditorPage from "../features/documents/OperationEditorPage.vue";
import { decodeItemSelection, decodeAllocationSelection } from "../lib/routeSelection";
import { usePageDomain } from "../lib/pageDomain";
import { operationLabels } from "../features/documents/operationCodec";
import type { OperationKind } from "../features/documents/operationModel";
import { useNativeEditorRoute } from "../lib/nativeEditorRoute";
const route = useRoute(),
	router = useRouter();
const editor = ref<InstanceType<typeof OperationEditorPage>>();
useNativeEditorRoute(() => editor.value?.controller);
const kind = computed(() => String(route.params.kind || "Receive") as OperationKind);
usePageDomain(() => {
	const value = editor.value?.controller.draft.value;
	const operation = value?.kind || kind.value;
	return ["Loan", "Return"].includes(operation) || !!value?.loanName || !!route.query.loan
		? "loans"
		: "movements";
});
const identity = computed(() =>
	route.params.name
		? { doctype: "Stock Entry" as const, name: String(route.params.name) }
		: undefined,
);
const selection = computed(() => decodeItemSelection(route.query.items));
const allocations = computed(() => decodeAllocationSelection(route.query.allocations));
const warehouseError = computed(() =>
	route.query.warehouse !== undefined && typeof route.query.warehouse !== "string"
		? "仓库选择无效，请返回原页面重新打开"
		: "",
);
const valid = computed(
	() =>
		(!route.params.doctype || route.params.doctype === "Stock Entry") &&
		(!!identity.value || Object.hasOwn(operationLabels, kind.value)),
);
onBeforeRouteLeave(() => editor.value?.controller.requestLeave() ?? true);
onBeforeRouteUpdate(() => editor.value?.controller.requestLeave() ?? true);
function back() {
	if (window.history.state.back) router.back();
	else void router.push("/movements/records");
}
</script>
<template>
	<OperationEditorPage
		v-if="valid && !selection.error && !allocations.error && !warehouseError"
		ref="editor"
		:key="String(route.params.name || route.params.kind) + String(route.query.editor || '')"
		:kind="kind"
		:identity="identity"
		:initial-items="selection.items"
		:initial-allocations="allocations.allocations"
		:initial-activity="
			typeof route.query.activity === 'string' ? route.query.activity : undefined
		"
		:initial-warehouse="
			typeof route.query.warehouse === 'string' ? route.query.warehouse : undefined
		"
		:original-loan="typeof route.query.loan === 'string' ? route.query.loan : undefined"
		:initial-return-outcome="route.query.outcome === 'damaged' ? 'damaged' : 'returned'"
		:recovery-id="typeof route.query.recovery === 'string' ? route.query.recovery : undefined"
		@back="back"
	/>
	<p v-else role="alert">
		{{
			selection.error ||
			allocations.error ||
			warehouseError ||
			"不支持的操作类型，请返回货物流动列表。"
		}}
	</p>
</template>
