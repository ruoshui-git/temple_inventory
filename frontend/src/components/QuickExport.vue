<script setup lang="ts">
import { siteDateTime } from "../lib/nativeTime";
import { toRef, watch } from "vue";
import UiButton from "./ui/UiButton.vue";
import Overlay from "./ui/Overlay.vue";
import ReportTable from "./ui/ReportTable.vue";
import InventoryIcon from "./InventoryIcon.vue";
import { useQuickExport } from "../features/export/useQuickExport";
import { reportDefinitions, type ReportQuery } from "../lib/reportContract";
import { scopeFilterChips } from "../lib/filterPresentation";
import { reportFilterChips } from "../lib/reportFilters";
import { useReferenceData } from "../services/contracts";
const props = withDefaults(defineProps<{ query: ReportQuery; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{ openFull: [query: ReportQuery] }>();
const reference = useReferenceData();
const controller = useQuickExport(toRef(props, "query"));
const {
	open,
	format,
	related,
	selectedTable,
	selectedSheets,
	page,
	error,
	loading,
	generating,
	job,
	generate,
	preview,
	status,
	canGenerate,
} = controller;
watch(
	() => props.active,
	(value) => {
		if (value === false) open.value = false;
	},
);
function full() {
	emit("openFull", JSON.parse(JSON.stringify(props.query)));
	open.value = false;
}
</script>
<template>
	<UiButton class="preview-quick-report" @click="open = true"
		><InventoryIcon name="download" />快速导出</UiButton
	>
	<Overlay v-if="open" title="快速导出" @close="open = false">
		<p class="preview-long-text">
			范围：{{ reportDefinitions[query.dataset].label }} ·
			{{
				reportDefinitions[query.dataset].views.find((view) => view.id === query.view)
					?.label
			}}
			·
			{{
				[
					...scopeFilterChips(query.scope, reference),
					...reportFilterChips(query, reference),
				]
					.map((chip) => chip.label)
					.join("；") || "全部有权查看的结果"
			}}
		</p>
		<p v-if="page">{{ page.matched_count }} 行完整结果 · 与显示页数无关</p>
		<p v-if="page" class="muted">
			范围快照（站点时间） {{ siteDateTime(page.snapshot) }} ·
			{{
				page.period.date_from
					? `${page.period.date_from} 至 ${page.period.date_to}`
					: "全部时间"
			}}
		</p>
		<p v-if="loading" role="status">正在读取完整范围与预览…</p>
		<p v-if="error" role="alert">
			{{ error }} <UiButton @click="job ? status() : preview()">重试读取</UiButton>
		</p>
		<div class="form-fields">
			<label class="preview-field"
				>文件格式<select v-model="format" :disabled="generating">
					<option value="xlsx">XLSX · 汇总与明细表</option>
					<option value="csv">CSV · 单一平面表</option>
				</select></label
			>
			<label class="preview-choice-label"
				><input
					type="checkbox"
					v-model="related"
					:disabled="generating"
				/>包含相关资料表</label
			>
			<label class="preview-field"
				>{{ format === "csv" ? "CSV 导出表" : "预览表"
				}}<select v-model="selectedTable" :disabled="generating">
					<option v-for="table in page?.tables || []" :key="table.id" :value="table.id">
						{{ table.label }}（{{ table.count }}）
					</option>
				</select></label
			>
		</div>
		<fieldset v-if="format === 'xlsx' && page">
			<legend>工作表</legend>
			<label v-for="table in page.tables" :key="table.id" class="preview-choice-label"
				><input
					type="checkbox"
					v-model="selectedSheets"
					:value="table.id"
					:disabled="generating"
				/>{{ table.label }}（{{ table.count }}）</label
			>
		</fieldset>
		<ReportTable
			v-if="page"
			:table="{
				id: page.table,
				label: page.tables.find((table) => table.id === page!.table)?.label || '',
				columns: page.columns,
				rows: page.rows,
			}"
			:limit="5"
			:total="page.matched_count"
		/>
		<p class="muted">
			最多预览 5 行。附件仅包含有权限的文件及记录引用，不含文件内容或临时链接。
		</p>
		<p v-if="job" role="status">
			{{
				job.status === "Completed"
					? "已生成"
					: job.status === "Failed"
						? "生成失败"
						: `后台生成中 · ${job.progress}%`
			}}<span v-if="job.generated_at"> · {{ siteDateTime(job.generated_at) }}</span>
		</p>
		<p v-if="job?.error" role="alert">{{ job.error }}；选择已保留。</p>
		<a v-if="job?.download_url" :href="job.download_url"
			>下载 {{ format.toUpperCase() }} · {{ job.row_count }} 行</a
		>
		<template #footer
			><UiButton @click="full">打开导出页面</UiButton
			><UiButton @click="open = false">取消</UiButton
			><UiButton
				variant="primary"
				:disabled="!canGenerate"
				:loading="generating"
				@click="generate"
				>{{ job?.status === "Failed" ? "重试生成" : "生成文件" }}</UiButton
			></template
		>
	</Overlay>
</template>
