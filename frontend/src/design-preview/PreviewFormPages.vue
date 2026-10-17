<script setup lang="ts">
import { ref } from "vue";
import PreviewMovementEditor from "./PreviewMovementEditor.vue";
import ItemEditorPage from "../features/items/ItemEditorPage.vue";
import CountEditorPage from "../features/counts/CountEditorPage.vue";
import { provideGalleryReference, galleryReference } from "./fixtureReference";
import { reviewSession } from "./reviewModel";
import { registerFixtureCount } from "./fixtureNativeDocuments";
provideGalleryReference();
const props = withDefaults(defineProps<{ page: string; variant: string; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
}>();
const generation = ref(0);
const recoveryId = props.page === "movement-form" ? undefined : reviewSession.selectedRecoveryId;
if (props.page !== "movement-form") reviewSession.selectedRecoveryId = undefined;
const count =
	props.page === "reconciliation-form" && props.variant === "detail"
		? reviewSession.drafts.find(
				(row) => row.name === reviewSession.selectedDraftName && row.kind === "Reconcile",
			)
		: undefined;
if (count) registerFixtureCount(count);
</script>
<template>
	<PreviewMovementEditor
		v-if="page === 'movement-form'"
		:key="variant + reviewSession.selectedDraftName"
		:variant="variant"
		:active="active"
		@navigate="(page, variant) => emit('navigate', page, variant)"
		@notify="emit('notify', $event)"
	/>
	<ItemEditorPage
		v-else-if="page === 'item-form'"
		:key="variant + reviewSession.selectedItemCode"
		:code="variant === 'edit' ? reviewSession.selectedItemCode : undefined"
		:recovery-id="recoveryId"
		@cancel="emit('navigate', 'inventory', 'list')"
		@saved="
			(item) => {
				reviewSession.selectedItemCode = item.item_code;
				emit('navigate', 'item-detail', 'overview');
			}
		"
	/>
	<CountEditorPage
		v-else-if="page === 'reconciliation-form'"
		:key="generation"
		:name="count?.name"
		:recovery-id="recoveryId"
		:active="active"
		:warehouse="
			!count && galleryReference.physicalLeaves.includes(reviewSession.selectedWarehouse)
				? reviewSession.selectedWarehouse
				: undefined
		"
		@back="emit('navigate', 'inventory', 'list')"
		@new-count="generation++"
	/>
</template>
