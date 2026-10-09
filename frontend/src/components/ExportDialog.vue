<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { downloadReport, type ExportFormat, type ReportType } from "../lib/api";
import UiButton from "./UiButton.vue";

const props = defineProps<{
	open: boolean;
	reportType: ReportType;
	filters: Record<string, unknown>;
	title: string;
	summary: string;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const busy = ref<ExportFormat | "">("");
const error = ref("");

async function download(format: ExportFormat) {
	if (busy.value) return;
	busy.value = format;
	error.value = "";
	try {
		await downloadReport(props.reportType, format, props.filters);
	} catch (cause: any) {
		error.value = cause?.message || "导出失败，请重试";
	} finally {
		busy.value = "";
	}
}
function close() {
	if (!busy.value) emit("update:open", false);
}
function onKeydown(event: KeyboardEvent) {
	if (props.open && event.key === "Escape") close();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
	<Teleport to="body">
		<div v-if="open" class="modal export-dialog" role="presentation" @click.self="close">
			<section
				role="dialog"
				aria-modal="true"
				:aria-labelledby="`${reportType}-export-title`"
			>
				<header>
					<h2 :id="`${reportType}-export-title`">{{ title }}</h2>
					<button
						type="button"
						aria-label="关闭导出窗口"
						:disabled="Boolean(busy)"
						@click="close"
					>
						×
					</button>
				</header>
				<p>{{ summary }}</p>
				<p class="muted">将导出符合当前筛选条件的全部记录，不限于已经加载的页面。</p>
				<p v-if="error" class="error" role="alert">{{ error }}</p>
				<div class="export-dialog-actions">
					<UiButton
						variant="primary"
						icon="download"
						:loading="busy === 'xlsx'"
						:disabled="Boolean(busy)"
						@click="download('xlsx')"
						>导出 Excel</UiButton
					>
					<UiButton
						icon="download"
						:loading="busy === 'csv'"
						:disabled="Boolean(busy)"
						@click="download('csv')"
						>导出 CSV</UiButton
					>
				</div>
			</section>
		</div>
	</Teleport>
</template>

<style scoped>
.export-dialog section {
	max-width: 480px;
}
.export-dialog header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}
.export-dialog h2 {
	margin: 0;
}
.export-dialog header button {
	font-size: 24px;
	line-height: 1;
}
.export-dialog-actions {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 10px;
	margin-top: 18px;
}
@media (max-width: 480px) {
	.export-dialog-actions {
		grid-template-columns: 1fr;
	}
}
</style>
