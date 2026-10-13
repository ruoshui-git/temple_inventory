<script setup lang="ts">
import { computed, ref } from "vue";
import { reviewSession, type ReviewDraft } from "../reviewModel";
import {
	countLocationLines,
	countSummary,
	refreshCountBaseline,
	physicalLeafWarehouses,
} from "../workflowModel";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
const props = defineProps<{ draft: ReviewDraft; disabled?: boolean }>();
const pendingLocation = ref(""),
	changeOpen = ref(false),
	itemCode = ref("");
const places = computed(() => physicalLeafWarehouses().map((row) => row.name));
const summary = computed(() => countSummary(props.draft));
function useLocation(value: string) {
	if (value === props.draft.countLocation) return;
	if (props.draft.lines.some((line) => line.countedQty !== undefined)) {
		pendingLocation.value = value;
		changeOpen.value = true;
	} else applyLocation(value);
}
function applyLocation(value: string) {
	props.draft.countLocation = value;
	props.draft.lines = props.draft.countMode === "full" ? countLocationLines(value) : [];
	props.draft.baselineStale = false;
	props.draft.baselineReviewed = true;
	changeOpen.value = false;
}
function mode(value: string) {
	props.draft.countMode = value as "selective" | "full";
	if (value === "full") {
		const previous = props.draft.lines;
		const current = countLocationLines(props.draft.countLocation || "");
		props.draft.lines = [
			...current.map(
				(row) =>
					previous.find((line) => line.code === row.code && line.batch === row.batch) ||
					row,
			),
			...previous.filter(
				(line) =>
					!current.some((row) => row.code === line.code && row.batch === line.batch),
			),
		];
	}
}
function add() {
	const item = reviewSession.stock.find((row) => row.code === itemCode.value);
	if (!item || !props.draft.countLocation) return;
	const candidates = countLocationLines(props.draft.countLocation).filter(
		(row) => row.code === itemCode.value,
	);
	if (!candidates.length && !item.tracksBatch)
		candidates.push({
			id: `${item.code}/${props.draft.countLocation}/`,
			code: item.code,
			location: props.draft.countLocation,
			batch: "",
			uom: item.uom,
			qty: 0,
			countedQty: undefined,
			countState: undefined,
			reason: "",
		});
	for (const line of candidates)
		if (!props.draft.lines.some((row) => row.id === line.id)) props.draft.lines.push(line);
	itemCode.value = "";
}
props.draft.countMode ||= "selective";
</script>
<template>
	<section class="form-section">
		<h2>盘点范围</h2>
		<PreviewSearchSelect
			label="盘点库位"
			:model-value="draft.countLocation"
			:options="places"
			:disabled="disabled"
			@update:model-value="useLocation"
		/>
		<div v-if="changeOpen" role="alert">
			更换库位将清除本次盘点输入。<PreviewUiButton @click="changeOpen = false"
				>保留当前盘点</PreviewUiButton
			><PreviewUiButton @click="applyLocation(pendingLocation)">更换并清除</PreviewUiButton>
		</div>
		<label
			>盘点方式<select
				:value="draft.countMode"
				:disabled="disabled"
				@change="mode(($event.target as HTMLSelectElement).value)"
			>
				<option value="selective">选定物品</option>
				<option value="full">整个库位</option>
			</select></label
		>
		<template v-if="draft.countMode === 'selective' && !disabled"
			><PreviewSearchSelect
				label="添加盘点物品"
				v-model="itemCode"
				:options="
					reviewSession.stock
						.filter(
							(item) =>
								!item.tracksBatch ||
								item.locations.some((row) => row.location === draft.countLocation),
						)
						.map((item) => ({ value: item.code, label: item.name, detail: item.code }))
				"
			/><PreviewUiButton :disabled="!itemCode || !draft.countLocation" @click="add"
				>加入盘点</PreviewUiButton
			></template
		>
		<p role="status">
			已核对 {{ summary.reviewed }} / {{ draft.lines.length }} 行 · 留空不调整库存
		</p>
		<div v-if="draft.baselineStale && !disabled" role="alert">
			账面数量在 ERPNext 中已变化，实点输入已保留。<PreviewUiButton
				@click="refreshCountBaseline(draft)"
				>刷新账面基准</PreviewUiButton
			>
		</div>
		<label v-if="draft.baselineReviewed === false && !disabled"
			><input
				type="checkbox"
				:checked="draft.baselineReviewed"
				@change="draft.baselineReviewed = true"
			/>已重新核对以下差异</label
		>
		<article v-for="line in draft.lines" :key="line.id" class="preview-count-row">
			<strong
				>{{ reviewSession.stock.find((item) => item.code === line.code)?.name }}
				<small>{{ line.batch || "无批次" }}</small></strong
			>
			<span>账面 {{ line.qty }} {{ line.uom }}</span
			><label
				>实点<input
					type="number"
					min="0"
					:step="
						reviewSession.units.find((unit) => unit.name === line.uom)?.whole
							? 1
							: 'any'
					"
					:value="line.countedQty"
					:disabled="disabled"
					@input="
						line.countedQty =
							($event.target as HTMLInputElement).value === ''
								? undefined
								: Number(($event.target as HTMLInputElement).value);
						line.countState = line.countedQty === undefined ? undefined : 'counted';
					"
			/></label>
			<span
				>差异
				{{ line.countedQty === undefined ? "待核对" : line.countedQty - line.qty }}
				<span v-if="line.countState === 'not_found'"> · 未找到</span></span
			><PreviewUiButton
				v-if="!disabled"
				@click="
					line.countedQty = 0;
					line.countState = 'not_found';
					line.reason = '未找到';
				"
				>未找到</PreviewUiButton
			>
			<label v-if="line.countedQty !== undefined && line.countedQty !== line.qty"
				>差异原因<input v-model="line.reason" :disabled="disabled"
			/></label>
		</article>
		<p v-if="!draft.lines.length" class="muted">选择库位和需要盘点的物品。</p>
		<details v-if="!disabled">
			<summary>预览状态</summary>
			<PreviewUiButton @click="draft.baselineStale = true">模拟账面变化</PreviewUiButton>
		</details>
	</section>
</template>
<style scoped>
.preview-count-row {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 12px;
	padding: 12px 0;
	border-bottom: 1px solid var(--p-border);
}
.preview-count-row strong {
	flex: 1 1 180px;
}
.preview-count-row label {
	display: grid;
	max-width: 160px;
}
small {
	display: block;
	font-weight: normal;
}
</style>
