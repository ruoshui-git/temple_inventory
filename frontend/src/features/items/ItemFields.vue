<script setup lang="ts">
import CategoryField from "../references/CategoryField.vue";
import UnitField from "../references/UnitField.vue";
import type { ItemInput } from "./useItemEditor";
defineProps<{
	model: ItemInput;
	editing?: boolean;
	disabled?: boolean;
	editorTarget?: HTMLElement;
}>();
const emit = defineEmits<{ supportingDirty: [field: "category" | "unit", dirty: boolean] }>();
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
		<label class="preview-field full-width"
			>条码（每行一个，可选）<textarea v-model="model.barcode" :disabled="disabled" /></label
		><label class="preview-field full-width"
			>物品说明（可选）<textarea v-model="model.description" :disabled="disabled" />
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
