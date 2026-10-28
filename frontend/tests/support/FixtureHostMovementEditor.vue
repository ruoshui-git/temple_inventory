<script setup lang="ts">
import { provideGalleryReference } from "./fixtureReference";
provideGalleryReference();
import { computed } from "vue";
import OperationEditorPage from "../../src/features/documents/OperationEditorPage.vue";
import { decodeOperation } from "../../src/features/documents/operationCodec";
import { operationLabels } from "../../src/lib/presentationLabels";
import type { OperationKind } from "../../src/features/documents/operationModel";
import { reviewSession, createDraft, type ReviewDraft } from "./reviewModel";
import { receivingFixture } from "./usabilityFixtures";
import { registerFixtureDraft } from "./fixtureNativeDocuments";
const props = withDefaults(defineProps<{ variant: string; active?: boolean }>(), { active: true });
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
}>();
const kind = computed(() =>
	Object.hasOwn(operationLabels, props.variant) ? (props.variant as OperationKind) : "Receive",
);
const selected = reviewSession.selectedDraftName
	? reviewSession.drafts.find(
			(row) => row.name === reviewSession.selectedDraftName && row.kind === kind.value,
		)
	: undefined;
const input: ReviewDraft = props.variant.startsWith("Receive-50")
	? receivingFixture(props.variant.endsWith("invalid"))
	: selected || createDraft(kind.value);
const doc = registerFixtureDraft(input);
const allocations = selected ? undefined : reviewSession.selectedAllocations;
const settlementLoan = selected ? undefined : reviewSession.selectedSettlementLoan;
const returnOutcome = reviewSession.selectedReturnOutcome;
const recoveryId = reviewSession.selectedRecoveryId;
const warehouse = reviewSession.selectedOperationWarehouse;
reviewSession.selectedOperationWarehouse = undefined;
reviewSession.selectedRecoveryId = undefined;
reviewSession.selectedAllocations = undefined;
reviewSession.selectedSettlementLoan = undefined;
reviewSession.selectedReturnOutcome = undefined;
const initial =
	!selected || props.variant.startsWith("Receive-50")
		? {
				...decodeOperation(doc),
				name: "",
				items: decodeOperation(doc).items.map((line, index) => ({
					...line,
					name: undefined,
					expiry: input.lines[index]?.expiry || "",
					manufacturingDate: input.lines[index]?.manufacturingDate || "",
				})),
			}
		: undefined;
if (props.variant.startsWith("Receive-50")) reviewSession.selectedDraftName = "";
</script>
<template>
	<OperationEditorPage
		:key="doc.name"
		:kind="kind"
		:identity="initial ? undefined : { doctype: 'Stock Entry', name: doc.name }"
		:initial-values="initial && allocations?.length ? { ...initial, items: [] } : initial"
		:initial-allocations="allocations"
		:initial-return-outcome="returnOutcome"
		:active="active"
		:original-loan="settlementLoan"
		:recovery-id="recoveryId"
		:initial-warehouse="warehouse"
		@back="emit('navigate', 'movement-records', 'draft')"
		@notify="emit('notify', $event)"
	/>
</template>
