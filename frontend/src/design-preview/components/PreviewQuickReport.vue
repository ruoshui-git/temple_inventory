<script setup lang="ts">
import { computed, onDeactivated, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import InventoryIcon from "../../components/InventoryIcon.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
import PreviewOverlay from "../PreviewOverlay.vue";
import PreviewReportTable from "./PreviewReportTable.vue";
import { openFullReport, projectReport, type ReportQuery } from "../reportModel";
const props = defineProps<{ query: ReportQuery; active?: boolean }>();
const emit = defineEmits<{
	navigate: [page: import("../reviewModel").PreviewPage, variant: string];
	notify: [message: string];
}>();
const { isMobile } = useResponsiveLayout();
watch(
	() => [props.query.dataset, props.query.view, isMobile.value],
	() => {
		open.value = false;
	},
	{ flush: "sync" },
);
const open = ref(false),
	format = ref("xlsx"),
	tableId = ref("result"),
	related = ref(false),
	failed = ref(false),
	failNext = ref(false);
const projection = computed(() => projectReport(props.query));
const tables = computed(() => [
	...projection.value.tables,
	...(related.value ? projection.value.related : []),
]);
const selected = computed(
	() => tables.value.find((table) => table.id === tableId.value) || tables.value[0]!,
);
watch(tables, (available) => {
	if (!available.some((table) => table.id === tableId.value)) tableId.value = "result";
});
function full() {
	openFullReport(props.query);
	open.value = false;
	emit("navigate", "reports", props.query.dataset);
}
function generate() {
	if (failNext.value) {
		failed.value = true;
		failNext.value = false;
		return;
	}
	failed.value = false;
	open.value = false;
	emit(
		"notify",
		`已模拟生成 ${format.value.toUpperCase()} · ${format.value === "csv" ? selected.value.rows.length : projection.value.count} 行，未生成下载文件`,
	);
}
watch(
	() => props.active,
	(value) => {
		if (value === false) open.value = false;
	},
);
onDeactivated(() => {
	open.value = false;
});
</script>
<template>
	<PreviewUiButton class="preview-quick-report" @click="open = true"
		><InventoryIcon name="download" />快速导出</PreviewUiButton
	>
	<PreviewOverlay v-if="open" title="快速导出" @close="open = false">
		<p class="preview-long-text">范围：{{ projection.scope }}</p>
		<p>{{ projection.count }} 行完整结果 · 与显示页数无关</p>
		<p class="muted">
			固定预览数据 · 模拟导出，不生成文件。生成时间 {{ projection.generated }}
		</p>
		<p v-if="projection.error" role="alert">{{ projection.error }}</p>
		<div class="form-fields">
			<label class="preview-field"
				>文件格式<select v-model="format">
					<option value="xlsx">XLSX · 适用汇总与明细表</option>
					<option value="csv">CSV · 单一平面表</option>
				</select></label
			><label class="preview-choice-label"
				><input type="checkbox" v-model="related" />包含相关资料表</label
			><label class="preview-field"
				>{{ format === "csv" ? "CSV 导出表" : "预览表"
				}}<select v-model="tableId">
					<option v-for="table in tables" :key="table.id" :value="table.id">
						{{ table.label }}（{{ table.rows.length }}）
					</option>
				</select></label
			>
		</div>
		<p v-if="format === 'xlsx'">工作表：{{ tables.map((table) => table.label).join("、") }}</p>
		<PreviewReportTable :table="selected" :limit="5" />
		<p class="muted">最多预览 5 行。附件仅包含可访问文件引用，不含文件内容或临时链接。</p>
		<p v-if="failed" role="alert">模拟生成失败，选择已保留，请重试。</p>
		<details>
			<summary>预览失败状态</summary>
			<label class="preview-choice-label"
				><input v-model="failNext" type="checkbox" />下次模拟生成失败</label
			>
		</details>
		<template #footer
			><PreviewUiButton @click="full">打开导出页面</PreviewUiButton
			><PreviewUiButton @click="open = false">取消</PreviewUiButton
			><PreviewUiButton variant="primary" :disabled="!!projection.error" @click="generate">{{
				failed ? "重试生成" : "模拟生成"
			}}</PreviewUiButton></template
		>
	</PreviewOverlay>
</template>
