<script setup lang="ts">
import NativeRecordsPage from "../features/drafts/NativeRecordsPage.vue";
import { provideGalleryReference } from "./fixtureReference";
import { reviewSession, type PreviewPage } from "./reviewModel";
import type { RecoverySnapshot } from "../lib/browserRecovery";
import { openFullReport } from "./reportModel";
const props = withDefaults(
	defineProps<{ active?: boolean; variant?: string; mode?: "drafts" | "counts" }>(),
	{
		active: true,
		mode: "drafts",
	},
);
const emit = defineEmits<{ navigate: [page: PreviewPage, variant: string] }>();
provideGalleryReference();
function open(doctype: string, name: string) {
	const selected = reviewSession.drafts.find((row) => row.name === name);
	if (!selected) return;
	reviewSession.selectedDraftName = name;
	emit(
		"navigate",
		doctype === "Stock Reconciliation" ? "reconciliation-form" : "movement-form",
		doctype === "Stock Reconciliation" ? "detail" : selected.kind,
	);
}
function recover(entry: RecoverySnapshot) {
	reviewSession.selectedRecoveryId = entry.editorId;
	reviewSession.selectedDraftName = entry.identity?.name || "";
	if (entry.editorKind === "Stock Entry")
		emit("navigate", "movement-form", String(entry.values.kind || "Receive"));
	else if (entry.editorKind === "Stock Reconciliation")
		emit("navigate", "reconciliation-form", entry.identity ? "detail" : "new");
	else if (entry.editorKind === "Item") {
		reviewSession.selectedItemCode = String(entry.values.editingCode || "");
		emit("navigate", "item-form", reviewSession.selectedItemCode ? "edit" : "new");
	} else if (entry.editorKind === "Inventory Activity") {
		const name = String(entry.values.editingActivity || "");
		emit("navigate", "activity-form", name ? `edit-${name}` : "new");
	} else if (entry.editorKind === "Warehouse") emit("navigate", "warehouses", "tree");
}
</script>
<template>
	<NativeRecordsPage
		:mode="mode"
		@new-count="
			reviewSession.selectedDraftName = '';
			emit('navigate', 'reconciliation-form', 'new');
		"
		:active="props.active"
		@open-document="open"
		@recover="recover"
		@open-export="
			(query) => {
				openFullReport(query);
				emit('navigate', 'reports', query.dataset);
			}
		"
	/>
</template>
