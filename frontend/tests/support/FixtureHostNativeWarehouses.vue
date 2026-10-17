<script setup lang="ts">
import NativeWarehousesPage from "../../src/features/warehouses/NativeWarehousesPage.vue";
import { provideGalleryReference } from "./fixtureReference";
import { reviewSession, type PreviewPage } from "./reviewModel";
import { openFullReport } from "./reportModel";
const props = withDefaults(
	defineProps<{ detail?: boolean; active?: boolean; create?: boolean }>(),
	{ active: true },
);
const emit = defineEmits<{ navigate: [page: PreviewPage, variant: string] }>();
provideGalleryReference();
const recoveryId = reviewSession.selectedRecoveryId;
reviewSession.selectedRecoveryId = undefined;
</script>
<template>
	<NativeWarehousesPage
		:name="detail ? reviewSession.selectedWarehouse : undefined"
		:initial-create="create"
		:initial-warehouse="reviewSession.selectedWarehouse"
		:initial-search="reviewSession.filters.warehouses.search"
		:recovery-id="recoveryId"
		:active="props.active"
		@selection="
			(name, search) => {
				reviewSession.selectedWarehouse = name;
				reviewSession.filters.warehouses.search = search;
			}
		"
		@warehouse="
			(name) => {
				reviewSession.selectedWarehouse = name;
				emit('navigate', 'warehouse-detail', 'overview');
			}
		"
		@back="emit('navigate', 'warehouses', 'tree')"
		@item="
			(code) => {
				reviewSession.selectedItemCode = code;
				emit('navigate', 'item-detail', 'overview');
			}
		"
		@browse="
			(query) => {
				reviewSession.filters.inventory.scope = query.scope;
				emit('navigate', 'inventory', 'list');
			}
		"
		@open-document="
			(_doctype, name) => {
				reviewSession.selectedMovementName = name;
				emit('navigate', 'movement-records', 'selected');
			}
		"
		@open-export="
			(query) => {
				openFullReport(query);
				emit('navigate', 'reports', query.dataset);
			}
		"
		@new-count="
			(name) => {
				reviewSession.selectedWarehouse = name;
				reviewSession.selectedDraftName = '';
				emit('navigate', 'reconciliation-form', 'new');
			}
		"
		@new-operation="
			(kind, warehouse) => {
				reviewSession.selectedDraftName = '';
				reviewSession.selectedOperationWarehouse = warehouse;
				emit('navigate', 'movement-form', kind);
			}
		"
	/>
</template>
