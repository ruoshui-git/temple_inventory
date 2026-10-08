<script setup lang="ts">
import Scanner from "../../components/Scanner.vue";
import ExportDialog from "../../components/ExportDialog.vue";
import { type ExpiryController } from "./useExpiryController";

const props = defineProps<{ controller: ExpiryController }>();
const { exportOpen, exportFilters, scanner, scanBusy, scan } = props.controller;
</script>

<template>
	<Scanner
		v-if="scanner"
		presentation="modal"
		:paused="scanBusy"
		@scan="scan"
		@close="scanner = false"
	/>
	<ExportDialog
		v-model:open="exportOpen"
		report-type="expiry"
		:filters="exportFilters"
		title="导出效期批次"
		summary="沿用当前搜索、类别、位置、库存和效期条件，按批次与位置导出。"
	/>
</template>
