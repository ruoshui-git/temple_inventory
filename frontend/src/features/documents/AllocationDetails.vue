<script setup lang="ts">
import { useOptionalReferenceData } from "../../services/contracts";
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import { computed, nextTick, ref, watch } from "vue";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import { useOperationContext, type AllocationLine, type OperationDraft } from "./operationModel";
const context = useOperationContext();
import { isSettlement } from "./operationModel";
import ItemLine from "../../components/ui/ItemLine.vue";
const props = defineProps<{
	line: AllocationLine;
	draft: OperationDraft;
	disabled?: boolean;
	mode?: "edit" | "display";
	field?: string;
}>();
const emit = defineEmits<{ close: []; split: []; replace: [] }>();
const item = computed(() => context.stock.find((row) => row.code === props.line.code)!);
const content = ref<HTMLElement>();
function close() {
	emit("close");
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
const warehouseReference = useOptionalReferenceData();
</script>
<template>
	<Overlay :title="item.name + ' 的物品详情'" drawer @close="close">
		<ItemLine :item="item" />
		<section v-if="line.batchAllocations?.length" class="form-section">
			<h3>记录的批次分配</h3>
			<p>此明细由多个批次组成，分配信息按原记录保留。</p>
			<dl
				v-for="allocation in line.batchAllocations"
				:key="allocation.name"
				class="ti-fields"
			>
				<div>
					<dt>批次</dt>
					<dd>{{ allocation.batch }}</dd>
				</div>
				<div>
					<dt>数量</dt>
					<dd>{{ allocation.qty }} {{ line.uom }}</dd>
				</div>
				<div v-if="allocation.expiry">
					<dt>到期</dt>
					<dd>{{ allocation.expiry }}</dd>
				</div>
				<div v-if="allocation.manufacturingDate">
					<dt>生产日期</dt>
					<dd>{{ allocation.manufacturingDate }}</dd>
				</div>
			</dl>
		</section>
		<dl v-if="mode === 'display'" class="ti-fields">
			<div
				v-for="(value, label) in {
					物品: line.code,
					数量: line.qty,
					单位: line.uom,
					批次: line.batch,
					到期: line.expiry,
					生产日期: line.manufacturingDate,
					库位: warehouseLabel(line.location, warehouseReference?.warehouses || []),
				}"
				:key="label"
			>
				<dt>{{ label }}</dt>
				<dd
					:title="
						label === '库位'
							? warehousePath(line.location, warehouseReference?.warehouses || [])
							: undefined
					"
				>
					{{ value || "未填写" }}
				</dd>
			</div>
		</dl>
		<div v-else ref="content" class="allocation-details">
			<label
				v-if="
					['Damage', 'Loss'].includes(draft.kind) ||
					['damaged', 'lost'].includes(line.returnOutcome || '')
				"
				class="preview-field"
				>原因<input data-field="reason" v-model="line.reason" :disabled="disabled"
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
				借出 {{ line.loanName || draft.loanName }}
			</p>
		</div>
		<template #footer>
			<UiButton
				v-if="mode !== 'display' && !disabled && !isSettlement(draft)"
				@click="emit('replace')"
				>更换物品</UiButton
			>
			<UiButton
				v-if="
					mode !== 'display' && !disabled && (isSettlement(draft) || !item.tracksBatch)
				"
				@click="emit('split')"
				>{{ isSettlement(draft) ? "添加处理明细" : "拆分明细" }}</UiButton
			>
			<UiButton @click="close">完成详情</UiButton>
		</template>
	</Overlay>
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
