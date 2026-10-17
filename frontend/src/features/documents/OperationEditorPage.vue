<script setup lang="ts">
import type { NativeIdentity } from "../../lib/browserRecovery";
import type { InitialAllocation } from "../../lib/routeSelection";
import type { OperationDraft, OperationKind } from "./operationModel";
import OperationEditorView from "./OperationEditorView.vue";
import { useOperationEditor } from "./useOperationEditor";
const props = withDefaults(
	defineProps<{
		kind?: OperationKind;
		identity?: NativeIdentity;
		initialItems?: string[];
		initialAllocations?: InitialAllocation[];
		initialActivity?: string;
		initialWarehouse?: string;
		initialValues?: OperationDraft;
		initialReturnOutcome?: "returned" | "damaged";
		originalLoan?: string;
		recoveryId?: string;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{ back: []; notify: [message: string] }>();
const controller = useOperationEditor(props);
defineExpose({ controller });
</script>
<template>
	<OperationEditorView
		:controller="controller"
		:active="active"
		@back="emit('back')"
		@notify="emit('notify', $event)"
	/>
</template>
