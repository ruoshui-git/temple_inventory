<script setup lang="ts">
import { ref, watch } from "vue";
import ExpiryBrowsePage from "../../src/features/expiry/ExpiryBrowsePage.vue";
import { newReportQuery, type ReportQuery } from "../../src/lib/reportContract";
import { reviewSession } from "./reviewModel";
import { provideGalleryReference } from "./fixtureReference";
import { openFullReport } from "./reportModel";
provideGalleryReference();
const props = withDefaults(defineProps<{ variant: string; active?: boolean }>(), { active: true });
const emit = defineEmits<{ navigate: [page: string, variant: string] }>();
const initial = ref(newReportQuery("expiry"));
watch(
	() => props.variant,
	() => {
		const value: ReportQuery = JSON.parse(
			JSON.stringify(reviewSession.nativeExpiryQuery || newReportQuery("expiry")),
		);
		value.scope = JSON.parse(JSON.stringify(reviewSession.filters.expiry.scope));
		value.includeZero = !reviewSession.filters.expiry.inStock;
		if (!reviewSession.nativeExpiryQuery) value.sortBy = "date";
		value.expiryWindow =
			props.variant === "soon"
				? "next_30"
				: ["expired", "unexpired", "undated"].includes(props.variant)
					? props.variant
					: "period";
		initial.value = value;
	},
	{ immediate: true },
);
function changed(value: ReportQuery) {
	reviewSession.nativeExpiryQuery = JSON.parse(JSON.stringify(value));
	reviewSession.filters.expiry.scope = JSON.parse(JSON.stringify(value.scope));
	reviewSession.filters.expiry.inStock = !value.includeZero;
}
</script>
<template>
	<ExpiryBrowsePage
		:initial-query="initial"
		:active="active"
		@query-change="changed"
		@item="
			(code) => {
				reviewSession.selectedItemCode = code;
				emit('navigate', 'item-detail', 'batches');
			}
		"
		@new-operation="
			(kind) => {
				reviewSession.selectedDraftName = '';
				emit('navigate', 'movement-form', kind);
			}
		"
		@open-export="
			(query) => {
				openFullReport(query);
				emit('navigate', 'reports', query.dataset);
			}
		"
	/>
</template>
