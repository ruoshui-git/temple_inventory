<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import PreviewOverlay from "../PreviewOverlay.vue";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
import PreviewConversionEditor from "./PreviewConversionEditor.vue";
import { reviewSession, type DraftLine, type ReviewDraft } from "../reviewModel";
import { isSettlement, lineStock } from "../formModel";
const props = defineProps<{
	line: DraftLine;
	draft: ReviewDraft;
	disabled?: boolean;
	mode?: "edit" | "display";
	field?: string;
	selectedUnit?: string;
}>();
const emit = defineEmits<{ close: []; batchChange: []; split: []; replace: [] }>();
const item = computed(() => reviewSession.stock.find((row) => row.code === props.line.code)!);
const conversion = ref(
	!!props.selectedUnit || ["entryUom", "conversionFactor"].includes(props.field || ""),
);
const dirty = ref(false);
const discard = ref(false);
const discardPanel = ref<HTMLElement>();
watch(discard, async (value) => {
	if (value) {
		await nextTick();
		discardPanel.value?.focus();
	}
});
const content = ref<HTMLElement>();
const conversionTrigger = ref<InstanceType<typeof PreviewUiButton>>();
async function appliedConversion() {
	conversion.value = false;
	await nextTick();
	(conversionTrigger.value?.$el as HTMLElement)?.focus();
}
function close() {
	if (dirty.value) discard.value = true;
	else emit("close");
}
watch(
	() => props.field,
	async () => {
		await nextTick();
		await nextTick();
		const target = content.value?.querySelector<HTMLElement>(`[data-field="${props.field}"]`);
		(target?.matches("input,select")
			? target
			: target?.querySelector<HTMLElement>("input,select")
		)?.focus();
	},
	{ immediate: true, flush: "post" },
);
</script>
<template>
	<PreviewOverlay :title="`${item.name} · 详情`" drawer @close="close">
		<dl v-if="mode === 'display'" class="preview-info-grid">
			<div
				v-for="(value, label) in {
					物品: line.code,
					数量: line.qty,
					单位: line.uom,
					批次: line.batch,
					到期: line.expiry,
					库位: line.location,
					换算率: line.conversionFactor || 1,
				}"
				:key="label"
			>
				<dt>{{ label }}</dt>
				<dd>{{ value || "未填写" }}</dd>
			</div>
		</dl>
		<div v-else ref="content" class="allocation-details" :inert="discard || undefined">
			<p>{{ line.code }} · {{ line.qty }} {{ line.uom }}</p>
			<template v-if="item.tracksBatch">
				<label v-if="draft.kind === 'Receive'" class="preview-field"
					>批次编号<input
						data-field="batch"
						v-model="line.batch"
						placeholder="留空自动生成"
						:disabled="disabled"
				/></label>
				<p v-else-if="isSettlement(draft)">批次：{{ line.batch || "原借用未记录批次" }}</p>
				<PreviewSearchSelect
					v-else
					data-field="batch"
					label="现有批次"
					v-model="line.batch"
					:disabled="disabled"
					:options="
						(lineStock(line)?.batches || []).map((batch) => ({
							value: batch.id,
							label: batch.id,
							detail: `可用 ${batch.available} · 损坏 ${batch.damaged || 0} · 到期 ${batch.expiry || '无效期'}`,
						}))
					"
					@update:model-value="emit('batchChange')"
				/>
			</template>
			<dl v-if="item.tracksExpiry && draft.kind !== 'Receive'" class="preview-info-grid">
				<div>
					<dt>到期日期</dt>
					<dd>{{ line.expiry || "无效期" }}</dd>
				</div>
			</dl>
			<label v-else-if="item.tracksExpiry" class="preview-field"
				>到期日期<input
					data-field="expiry"
					v-model="line.expiry"
					type="date"
					:disabled="disabled || draft.kind !== 'Receive'"
			/></label>
			<label v-if="draft.kind === 'Receive' && item.tracksBatch" class="preview-field"
				>生产日期（可选）<input
					data-field="manufacturingDate"
					v-model="line.manufacturingDate"
					type="date"
					:disabled="disabled"
			/></label>
			<label
				v-if="
					['Damage', 'Loss'].includes(draft.kind) ||
					['damaged', 'lost'].includes(line.returnOutcome || '')
				"
				class="preview-field"
				>原因（可选）<input data-field="reason" v-model="line.reason" :disabled="disabled"
			/></label>
			<label v-if="isSettlement(draft) && draft.kind === 'Return'" class="preview-field"
				>处理结果<select
					data-field="returnOutcome"
					v-model="line.returnOutcome"
					:disabled="disabled"
				>
					<option value="returned">完好归还</option>
					<option value="damaged">损坏归还</option>
				</select></label
			>
			<p v-if="isSettlement(draft)" data-field="loanName">
				借出 {{ line.loanName || draft.loanName }} / 原明细
				{{ (line.loanLineIndex || 0) + 1 }}
			</p>
			<PreviewUiButton ref="conversionTrigger" v-if="!conversion" @click="conversion = true"
				>单位与换算</PreviewUiButton
			>
			<PreviewConversionEditor
				v-if="conversion"
				:line="line"
				:selected-unit="selectedUnit"
				:disabled="disabled"
				@dirty-change="dirty = $event"
				@applied="appliedConversion"
			/>
		</div>
		<div v-if="discard" ref="discardPanel" role="alert" tabindex="-1">
			<p>放弃尚未应用的换算？其他详情已保留。</p>
			<PreviewUiButton @click="discard = false">继续填写换算</PreviewUiButton
			><PreviewUiButton @click="emit('close')">放弃换算并关闭</PreviewUiButton>
		</div>
		<template #footer>
			<PreviewUiButton
				v-if="mode !== 'display' && !disabled && !isSettlement(draft)"
				:disabled="dirty"
				@click="!dirty && emit('replace')"
				>更换物品</PreviewUiButton
			>
			<PreviewUiButton
				v-if="mode !== 'display' && !disabled"
				:disabled="dirty"
				@click="!dirty && emit('split')"
				>{{
					isSettlement(draft)
						? "添加处理分配"
						: item.tracksBatch
							? draft.kind === "Receive"
								? "添加批次分配"
								: "分配其他批次"
							: "拆分分配"
				}}</PreviewUiButton
			><PreviewUiButton @click="close">完成详情</PreviewUiButton></template
		>
	</PreviewOverlay>
</template>
<style scoped>
.allocation-details {
	display: grid;
	gap: var(--p-space-3);
	min-width: 0;
}
.allocation-details p {
	overflow-wrap: anywhere;
}
</style>
