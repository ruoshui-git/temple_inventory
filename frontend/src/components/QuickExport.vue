<script setup lang="ts">
import { siteDateTime } from "../lib/nativeTime";
import { computed, ref, watch } from "vue";
import UiButton from "./ui/UiButton.vue";
import SkeletonBlock from "./ui/SkeletonBlock.vue";
import Overlay from "./ui/Overlay.vue";
import ReportTable from "./ui/ReportTable.vue";
import InventoryIcon from "./InventoryIcon.vue";
import { useQuickExport } from "../features/export/useQuickExport";
import { reportDefinitions, type ReportDataset, type ReportQuery } from "../lib/reportContract";
import { scopeFilterChips } from "../lib/filterPresentation";
import { reportFilterChips } from "../lib/reportFilters";
import { useReferenceData } from "../services/contracts";
import { showToast } from "../services/toast";
const props = withDefaults(
	defineProps<{
		query: ReportQuery;
		active?: boolean;
		allowDatasetSelection?: boolean;
		showOpenReport?: boolean;
		initialDataset?: ReportDataset;
		queryForDataset?: (dataset: ReportDataset) => ReportQuery;
	}>(),
	{ active: true, allowDatasetSelection: false, showOpenReport: true },
);
const emit = defineEmits<{
	openFull: [query: ReportQuery];
	commitDataset: [dataset: ReportDataset];
}>();
const reference = useReferenceData();
const selectedDataset = ref(props.initialDataset || props.query.dataset);
const query = computed(() =>
	props.allowDatasetSelection && props.queryForDataset
		? props.queryForDataset(selectedDataset.value)
		: props.query,
);
const controller = useQuickExport(query);
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
watch(open, (value) => {
	if (value && props.allowDatasetSelection)
		selectedDataset.value = props.initialDataset || props.query.dataset;
});
watch(
	() => props.initialDataset,
	(value) => {
		if (!open.value && value) selectedDataset.value = value;
	},
);
watch(
	() => job.value?.status,
	(value, previous) => {
		if (value === "Completed" && previous !== "Completed")
			showToast("导出文件已准备好", "success", {
				label: "下载",
				action: () => {
					const url = job.value?.download_url;
					if (url) window.open(url, "_blank", "noopener");
				},
			});
	},
);
function commitDataset() {
	if (props.allowDatasetSelection) emit("commitDataset", selectedDataset.value);
}
function full() {
	commitDataset();
	emit("openFull", JSON.parse(JSON.stringify(query.value)));
	open.value = false;
}
function generateSelected() {
	commitDataset();
	void generate();
}
</script>
<template>
	<UiButton class="preview-quick-report" @click="open = true"
		><InventoryIcon name="download" />导出</UiButton
	>
	<Overlay v-if="open" title="导出" @close="open = false">
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
		<p v-if="page">
			当前预览表共 {{ page.matched_count }} 条匹配结果；文件包含所选表的完整结果。
		</p>
		<p v-if="page" class="muted">
			范围快照（站点时间） {{ siteDateTime(page.snapshot) }} ·
			{{
				page.period.date_from
					? `${page.period.date_from} 至 ${page.period.date_to}`
					: "全部时间"
			}}
		</p>
		<SkeletonBlock v-if="loading && !page" variant="lines" :count="4" />
		<p v-if="error" role="alert">
			{{ error }} <UiButton @click="job ? status() : preview()">重试读取</UiButton>
		</p>
		<div class="form-fields">
			<label v-if="allowDatasetSelection" class="preview-field"
				>数据范围<select v-model="selectedDataset" aria-label="数据范围">
					<option v-for="(definition, id) in reportDefinitions" :key="id" :value="id">
						{{ definition.label }}
					</option>
				</select></label
			>
			<label class="preview-field"
				>文件格式<select v-model="format" aria-label="文件格式" :disabled="generating">
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
				>{{
					format === "csv"
						? "CSV 导出表（仅一张表）"
						: "XLSX 预览表（不改变工作表选择）"
				}}<select
					v-model="selectedTable"
					:aria-label="format === 'csv' ? 'CSV 导出表' : 'XLSX 预览表'"
					:disabled="generating"
				>
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
			:preference-id="`quick-export.${query.dataset}.${query.view}.${page.table}`"
			:table="{
				id: page.table,
				label: page.tables.find((table) => table.id === page!.table)?.label || '',
				columns: page.columns,
				rows: page.rows,
			}"
			:document-links="false"
			:limit="5"
			:total="page.matched_count"
		/>
		<p class="muted">
			最多预览 5 行。XLSX 工作表在上方单独选择，导出全部匹配结果；CSV
			只导出所选的一张表。附件仅包含有权限的文件及记录引用，不含文件内容或临时链接。
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
			><UiButton v-if="showOpenReport" @click="full">打开报表</UiButton
			><UiButton @click="open = false">取消</UiButton
			><UiButton
				variant="primary"
				:disabled="!canGenerate"
				:loading="generating"
				@click="generateSelected"
				>{{ job?.status === "Failed" ? "重试生成" : "生成文件" }}</UiButton
			></template
		>
	</Overlay>
</template>
