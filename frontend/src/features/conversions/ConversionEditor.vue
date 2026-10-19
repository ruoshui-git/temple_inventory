<script setup lang="ts">
import SearchSelect from "../../components/ui/SearchSelect.vue";
import UiButton from "../../components/ui/UiButton.vue";
import type { ConversionLine } from "../../lib/quantityConversion";
import type { StockItem } from "../../lib/stockPresentation";
import { useConversionEditor, type SavedItemConversions } from "./useConversionEditor";
const props = defineProps<{
	line: ConversionLine;
	item: StockItem;
	selectedUnit?: string;
	reusableOnly?: boolean;
	disabled?: boolean;
}>();
const emit = defineEmits<{
	applied: [];
	dirtyChange: [dirty: boolean];
	itemUpdated: [result: SavedItemConversions];
}>();
const {
	reference,
	unit,
	quantity,
	factor,
	canUpdate,
	reuse,
	busy,
	error,
	conflict,
	savedFactor,
	replacement,
	creation,
	apply,
	reload,
} = useConversionEditor(
	props,
	() => emit("applied"),
	(value) => emit("dirtyChange", value),
	(value) => emit("itemUpdated", value),
);
const {
	creating,
	name: newName,
	whole,
	permitted: createUnit,
	create,
	error: creationError,
} = creation;
</script>
<template>
	<section class="preview-conversion-editor">
		<h3>单位与换算</h3>
		<SearchSelect
			data-field="entryUom"
			label="输入单位"
			v-model="unit"
			:options="reference.units.map((row) => row.name)"
			:disabled="disabled || busy"
		/>
		<p>库存单位：{{ line.uom }}（只读）</p>
		<UiButton
			v-if="!creating"
			:disabled="disabled || busy || !createUnit"
			@click="creating = true"
			>新建单位</UiButton
		>
		<p v-if="!createUnit" class="muted">没有新建单位的权限，可选择已有单位。</p>
		<fieldset v-if="creating" :disabled="disabled || busy">
			<label class="preview-field">单位名称<input v-model="newName" /></label>
			<label class="preview-choice-label"
				><input v-model="whole" type="checkbox" />只允许整数数量</label
			>
			<UiButton @click="create">保存并使用单位</UiButton>
			<UiButton
				@click="
					creating = false;
					newName = '';
				"
				>取消新建单位</UiButton
			>
		</fieldset>
		<dl v-if="unit === line.uom" class="preview-info-grid">
			<div>
				<dt>单位换算</dt>
				<dd>1 {{ unit }} = 1 {{ line.uom }}</dd>
			</div>
		</dl>
		<label v-else class="preview-field"
			>1 {{ unit || "所选单位" }} = （{{ line.uom }}）<input
				data-field="conversionFactor"
				v-model="factor"
				type="number"
				step="any"
				min="0"
				:disabled="disabled || busy"
		/></label>
		<label v-if="!reusableOnly" class="preview-field"
			>输入数量（{{ unit }}）<input
				v-model="quantity"
				type="number"
				step="any"
				:disabled="disabled || busy"
		/></label>
		<p v-if="!reusableOnly" role="status">
			{{ quantity }} {{ unit }} · 折合
			{{ factor === "" ? "待填写比例" : Number(quantity) * Number(factor) }} {{ line.uom }}
		</p>
		<p v-if="replacement">
			原换算：1 {{ unit }} = {{ savedFactor }} {{ line.uom }}；新换算：1 {{ unit }} =
			{{ factor }} {{ line.uom }}
		</p>
		<p v-if="reusableOnly">保存为此物品的常用换算：是</p>
		<label v-else class="preview-choice-label"
			><input
				v-model="reuse"
				type="checkbox"
				:disabled="disabled || busy || reusableOnly || !canUpdate"
			/>保存为此物品的常用换算</label
		>
		<p v-if="!canUpdate" class="muted">没有更新物品的权限；可仅应用于此明细。</p>
		<p class="muted">已保存的单位与常用换算会保留；取消操作单不会删除它们。</p>
		<p v-if="error || creationError" role="alert">{{ error || creationError }}</p>
		<UiButton :disabled="disabled || busy" variant="primary" @click="apply">{{
			replacement ? "更新常用换算并应用" : "应用换算"
		}}</UiButton>
		<UiButton v-if="conflict || error" :disabled="busy" @click="reload"
			>重新载入常用换算</UiButton
		>
	</section>
</template>
<style scoped>
.preview-conversion-editor {
	display: grid;
	gap: var(--p-space-3);
	min-width: 0;
}
p {
	overflow-wrap: anywhere;
}
</style>
