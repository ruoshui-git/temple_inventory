<script setup lang="ts">
import LoanDetailView from "./LoanDetailView.vue";
import { useLoanDetail, type SettlementAction } from "./useLoanDetail";
import type { ReportQuery } from "../../lib/reportContract";
const props = withDefaults(defineProps<{ name: string; active?: boolean }>(), { active: true });
const emit = defineEmits<{
	back: [];
	openDocument: [doctype: string, name: string];
	item: [code: string];
	activity: [name: string];
	settle: [name: string, action: SettlementAction];
	openExport: [query: ReportQuery];
}>();
const controller = useLoanDetail(props);
defineExpose({ controller });
</script>
<template>
	<LoanDetailView
		:controller="controller"
		:active="active"
		@back="emit('back')"
		@open-document="(doctype, name) => emit('openDocument', doctype, name)"
		@item="emit('item', $event)"
		@activity="emit('activity', $event)"
		@settle="(name, action) => emit('settle', name, action)"
		@open-export="emit('openExport', $event)"
	/>
</template>
