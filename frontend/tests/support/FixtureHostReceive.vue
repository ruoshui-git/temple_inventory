<script setup lang="ts">
import { provideGalleryReference } from "./fixtureReference";
provideGalleryReference();
import OperationEditorPage from "../../src/features/documents/OperationEditorPage.vue";
import { registerFixtureDraft } from "./fixtureNativeDocuments";
import { reviewSession } from "./reviewModel";
import { previewDate, locations, type Pattern } from "./model";
withDefaults(defineProps<{ pattern: Pattern; active?: boolean }>(), { active: true });
const emit = defineEmits<{ notify: [message: string]; back: [] }>();
const item = reviewSession.stock[0]!;
const doc = registerFixtureDraft({
	name: "GALLERY-RECEIVE",
	kind: "Receive",
	status: "draft",
	postingDate: previewDate,
	activity: "",
	borrower: "",
	note: "",
	source: "社区善心捐赠",
	lines: [
		{
			id: "GALLERY-RECEIVE-ROW",
			code: item.code,
			qty: 12,
			uom: item.uom,
			location: locations[0]!,
			batch: "RICE-2610",
			expiry: "2027-03-01",
		},
	],
});
</script>
<template>
	<OperationEditorPage
		:identity="{ doctype: 'Stock Entry', name: doc.name }"
		:active="active"
		@back="emit('back')"
		@notify="emit('notify', $event)"
	/>
</template>
