<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { siteDateTime } from "../lib/nativeTime";
import { scopeFilterChips } from "../lib/filterPresentation";
import { reportFilterChips } from "../lib/reportFilters";
import { reportDefinitions, type ReportDataset, type ReportQuery } from "../lib/reportContract";
import { markExportWatched } from "../features/export/watchedExport";
import { useQuickExport } from "../features/export/useQuickExport";
import { useInventoryServices, useReferenceData } from "../services/contracts";
import { showToast } from "../services/toast";
import UiButton from "./ui/UiButton.vue";
import SkeletonBlock from "./ui/SkeletonBlock.vue";
import Overlay from "./ui/Overlay.vue";
import InventoryIcon from "./InventoryIcon.vue";

const props = withDefaults(
	defineProps<{
		query: ReportQuery;
		table?: string;
		columns?: string[];
		title: string;
		sortBy?: string;
		sort?: "asc" | "desc";
		active?: boolean;
		disabled?: boolean;
		showTrigger?: boolean;
		allowDatasetSelection?: boolean;
		queryForDataset?: (dataset: ReportDataset) => ReportQuery;
		initialDataset?: ReportDataset;
	}>(),
	{
		active: true,
		disabled: false,
		showTrigger: true,
		allowDatasetSelection: false,
	},
);
const emit = defineEmits<{ commitDataset: [dataset: ReportDataset] }>();
const reference = useReferenceData();
const services = useInventoryServices();
const watchedJobs = new Set<string>();
const selectedDataset = ref(props.initialDataset || props.query.dataset);
const query = computed(() =>
	props.allowDatasetSelection && props.queryForDataset
		? props.queryForDataset(selectedDataset.value)
		: props.query,
);
const title = computed(() => props.title);
const table = computed(() => (props.allowDatasetSelection ? undefined : props.table));
const columns = computed(() => (props.allowDatasetSelection ? undefined : props.columns));
const sortBy = computed(() => props.sortBy);
const sort = computed(() => props.sort);
const filterLabels = computed(() =>
	[
		...scopeFilterChips(query.value.scope, reference),
		...reportFilterChips(query.value, reference),
	].map((chip) => chip.label),
);
const controller = useQuickExport(query, table, columns, title, sortBy, sort, filterLabels);
const {
	open,
	format,
	grouped,
	includeFiles,
	matchedCount,
	error,
	loading,
	generating,
	job,
	downloading,
	downloadProgress,
	downloadError,
	count,
	status,
	generate,
	download,
	canGenerate,
} = controller;
const hasGrouping = computed(() => query.value.groupBy.length > 0);
watch(
	() => props.active,
	(value) => {
		if (!value) open.value = false;
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
	async (value, previous) => {
		if (value === "Completed" && previous !== "Completed")
			showToast("导出文件已准备好", "success", {
				label: "下载",
				action: () => {
					void download();
				},
			});
		const watchedKey = `${job.value?.name}:${job.value?.attempt}:${value}`;
		if (
			(value === "Completed" || value === "Failed") &&
			open.value &&
			job.value?.name &&
			!watchedJobs.has(watchedKey)
		) {
			watchedJobs.add(watchedKey);
			try {
				await markExportWatched(services, job.value.name);
			} catch {
				watchedJobs.delete(watchedKey);
			}
		}
	},
);
function commitDataset() {
	if (props.allowDatasetSelection) emit("commitDataset", selectedDataset.value);
}
function generateSelected() {
	commitDataset();
	void generate();
}
function openDialog() {
	if (!props.disabled) open.value = true;
}
defineExpose({ open: openDialog });
</script>
<template>
	<UiButton v-if="showTrigger" class="quick-report" :disabled="disabled" @click="openDialog"
		><InventoryIcon name="export" />导出</UiButton
	>
	<Overlay
		v-if="open"
		title="导出"
		panel-class="quick-export-dialog"
		content-class="quick-export-content"
		@close="open = false"
	>
		<div class="quick-export-intro form-fields">
			<p v-if="!job" class="muted">文件将在后台生成，完成后会发送通知并提供下载。</p>
			<p class="content-long-text">
				范围：{{ title }} · {{ filterLabels.join("；") || "全部有权查看的结果" }}
			</p>
			<p class="quick-export-match-count" aria-live="polite">
				<SkeletonBlock
					v-if="loading && matchedCount === undefined"
					variant="lines"
					:count="1"
				/>
				<template v-else>共 {{ matchedCount ?? "—" }} 行</template>
			</p>
		</div>
		<p v-if="error" role="alert">
			{{ error }}
			<UiButton @click="job && matchedCount !== undefined ? status() : count()"
				>重试读取</UiButton
			>
		</p>
		<div class="quick-export-options form-fields">
			<label v-if="allowDatasetSelection" class="form-field"
				>数据范围<select v-model="selectedDataset" aria-label="数据范围">
					<option v-for="(definition, id) in reportDefinitions" :key="id" :value="id">
						{{ definition.label }}
					</option>
				</select></label
			>
			<label class="form-field"
				>格式<select v-model="format" aria-label="格式" :disabled="generating">
					<option value="xlsx">XLSX</option>
					<option value="csv">CSV</option>
				</select></label
			>
			<div v-if="hasGrouping" class="quick-export-related">
				<label class="form-choice-label">
					<input
						v-model="grouped"
						type="checkbox"
						:disabled="format === 'csv' || generating"
					/>
					按当前分组输出
				</label>
				<p v-if="format === 'csv'" class="muted">CSV 只输出明细行</p>
			</div>
			<fieldset>
				<legend>附带文件</legend>
				<label class="form-choice-label"
					><input
						v-model="includeFiles"
						type="radio"
						value="none"
						:disabled="generating"
					/>无</label
				>
				<label class="form-choice-label"
					><input
						v-model="includeFiles"
						type="radio"
						value="images"
						:disabled="generating"
					/>物品图片</label
				>
				<label class="form-choice-label"
					><input
						v-model="includeFiles"
						type="radio"
						value="all"
						:disabled="generating"
					/>图片和附件</label
				>
				<p class="muted">选择后打包为 ZIP；图片以物品编号命名</p>
			</fieldset>
		</div>
		<p v-if="generating" class="muted">可以关闭此窗口继续工作，完成后会通知你。</p>
		<p v-if="job" role="status">
			{{
				job.status === "Completed"
					? "已生成"
					: job.status === "Failed"
						? "生成失败"
						: `${job.stage || "后台生成中"} · ${job.progress}%${job.progress_detail ? ` · ${job.progress_detail}` : ""}`
			}}<span v-if="job.generated_at"> · {{ siteDateTime(job.generated_at) }}</span>
		</p>
		<progress
			v-if="generating && job"
			class="quick-export-progress"
			:max="100"
			:value="job.progress"
			:aria-label="job.stage || '导出进度'"
		/>
		<p v-if="job?.error" role="alert">{{ job.error }}；选择已保留。</p>
		<UiButton
			v-if="job?.status === 'Completed' && job.download_url"
			:loading="downloading"
			:loading-label="downloadProgress || '正在准备下载…'"
			:disabled="downloading"
			@click="download"
			>下载 {{ job.file_label || format.toUpperCase() }} · {{ job.row_count }} 行</UiButton
		>
		<p v-if="downloadError" class="notice-bar danger" role="alert">
			{{ downloadError }}
			<UiButton v-if="job?.download_url && !downloading" size="compact" @click="download"
				>重试下载</UiButton
			>
		</p>
		<template #footer
			><UiButton @click="open = false">关闭</UiButton
			><UiButton
				variant="primary"
				:disabled="!canGenerate"
				:loading="loading || generating"
				:loading-label="loading ? '正在读取数量…' : '正在生成…'"
				@click="generateSelected"
				>{{ job?.status === "Failed" ? "重试生成" : "开始导出" }}</UiButton
			></template
		>
	</Overlay>
</template>

<style scoped>
.quick-export-progress {
	display: block;
	width: 100%;
	margin-block: var(--p-space-2);
	accent-color: var(--p-accent);
}
</style>
