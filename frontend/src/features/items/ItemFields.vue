<script setup lang="ts">
import CategoryField from "../references/CategoryField.vue";
import UnitField from "../references/UnitField.vue";
import { onDeactivated, ref, watch } from "vue";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import Scanner from "../../components/Scanner.vue";
import type { ItemInput } from "./useItemEditor";
import { appendBarcode as appendBarcodeValue } from "./barcodeInput";
const props = defineProps<{
	model: ItemInput;
	editing?: boolean;
	disabled?: boolean;
	editorTarget?: HTMLElement;
}>();
const emit = defineEmits<{ supportingDirty: [field: "category" | "unit", dirty: boolean] }>();
const scannerOpen = ref(false);
function appendBarcode(value: string) {
	if (props.disabled) return;
	props.model.barcode = appendBarcodeValue(props.model.barcode, value);
	scannerOpen.value = false;
}
watch(
	() => props.disabled,
	(disabled) => {
		if (disabled) scannerOpen.value = false;
	},
);
onDeactivated(() => {
	scannerOpen.value = false;
});
</script>
<template>
	<div class="form-fields preview-creation-fields">
		<dl v-if="editing" class="preview-info-grid">
			<div>
				<dt>物品编号</dt>
				<dd>{{ model.code }}</dd>
			</div>
		</dl>
		<label v-else class="preview-field"
			>物品编号<input v-model="model.code" :disabled="disabled"
		/></label>
		<label class="preview-field"
			>物品名称<input v-model="model.name" :disabled="disabled" required
		/></label>
		<CategoryField
			v-model="model.category"
			:disabled="disabled"
			:editor-target="editorTarget"
			@dirty-change="emit('supportingDirty', 'category', $event)"
		/>
		<dl v-if="editing" class="preview-info-grid">
			<div>
				<dt>库存单位</dt>
				<dd>{{ model.uom }}</dd>
			</div>
		</dl>
		<UnitField
			v-else
			v-model="model.uom"
			:disabled="disabled"
			:editor-target="editorTarget"
			@dirty-change="emit('supportingDirty', 'unit', $event)"
		/>
		<label class="preview-field full-width">
			条码（每行一个，可选）
			<textarea v-model="model.barcode" :disabled="disabled" />
		</label>
		<div class="full-width">
			<UiButton icon="scan" :disabled="disabled" @click="scannerOpen = true"
				>扫码添加条码</UiButton
			>
		</div>
		<Overlay
			v-if="scannerOpen"
			title="扫码添加条码"
			adaptive-creation
			@close="scannerOpen = false"
		>
			<Scanner
				presentation="inline"
				submit-label="添加条码"
				:paused="disabled"
				@scan="appendBarcode"
				@close="scannerOpen = false"
			/>
		</Overlay>
		<label class="preview-field full-width">
			物品说明（可选）
			<textarea v-model="model.description" :disabled="disabled" />
		</label>
		<template v-if="editing"
			><dl class="preview-info-grid">
				<div>
					<dt>按批次管理</dt>
					<dd>{{ model.tracksBatch ? "是" : "否" }}</dd>
				</div>
				<div>
					<dt>记录效期</dt>
					<dd>{{ model.tracksExpiry ? "是" : "否" }}</dd>
				</div>
			</dl></template
		>
		<template v-else
			><label class="preview-choice-label"
				><input
					type="checkbox"
					v-model="model.tracksBatch"
					:disabled="disabled || model.tracksExpiry"
				/>按批次管理</label
			><label class="preview-choice-label"
				><input
					type="checkbox"
					v-model="model.tracksExpiry"
					:disabled="disabled"
				/>记录效期</label
			>
			<p class="muted">批次、数量和效期在入库单中填写。</p></template
		>
	</div>
</template>
