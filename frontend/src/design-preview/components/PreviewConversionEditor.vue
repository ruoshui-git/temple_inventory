<script setup lang="ts">
import { computed, ref, watch } from "vue";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
import { reviewSession, type DraftLine } from "../reviewModel";
import {
	applyLineConversion,
	conversionAccess,
	conversionError,
	conversionFactorError,
	createPreviewUnit,
	recordConversion,
	saveItemConversion,
} from "../conversionModel";
const props = defineProps<{
	line: DraftLine;
	selectedUnit?: string;
	reusableOnly?: boolean;
	disabled?: boolean;
}>();
const emit = defineEmits<{ applied: []; dirtyChange: [dirty: boolean] }>();
recordConversion(props.line);
const item = computed(() => reviewSession.stock.find((row) => row.code === props.line.code)!);
const unit = ref(props.selectedUnit || props.line.entryUom || props.line.uom);
const quantity = ref(props.line.entryQty!);
const factor = ref<number | string>("");
const reuse = ref(conversionAccess.updateItem);
const newName = ref("");
const whole = ref(true);
const creating = ref(false);
const error = ref("");
let version = item.value.conversionVersion || 0;
const savedFactor = computed(() =>
	unit.value === props.line.uom
		? 1
		: item.value.alternateUnits?.find((row) => row.uom === unit.value)?.factor,
);
watch(
	unit,
	() => {
		factor.value =
			unit.value === props.line.entryUom
				? props.line.conversionFactor!
				: (savedFactor.value ?? "");
		quantity.value =
			unit.value === props.line.entryUom
				? props.line.entryQty!
				: savedFactor.value
					? props.line.qty / savedFactor.value
					: props.line.entryQty!;
	},
	{ immediate: true },
);
const baseline = ref("");
const snapshot = () =>
	JSON.stringify([
		unit.value,
		factor.value,
		quantity.value,
		reuse.value,
		newName.value,
		whole.value,
		creating.value,
	]);
baseline.value = snapshot();
const dirty = computed(() => snapshot() !== baseline.value || unit.value !== props.line.entryUom);
watch(dirty, (value) => emit("dirtyChange", value), { immediate: true });
const replacement = computed(
	() =>
		reuse.value &&
		savedFactor.value !== undefined &&
		Number(factor.value) !== savedFactor.value,
);
function create() {
	error.value = createPreviewUnit(newName.value, whole.value);
	if (error.value) return;
	unit.value = newName.value.trim();
	newName.value = "";
	creating.value = false;
}
function apply() {
	if (props.disabled) return;
	if (creating.value && newName.value.trim()) {
		error.value = "请先保存或取消正在填写的单位。";
		return;
	}
	if (props.reusableOnly && !conversionAccess.updateItem) {
		error.value = "没有更新物品的权限。";
		return;
	}
	error.value = props.reusableOnly
		? conversionFactorError(unit.value, Number(factor.value), props.line.uom)
		: conversionError(
				Number(quantity.value),
				unit.value,
				Number(factor.value),
				props.line.uom,
			);
	if (error.value) return;
	if ((reuse.value || props.reusableOnly) && unit.value !== props.line.uom) {
		error.value = saveItemConversion(
			props.line.code,
			unit.value,
			Number(factor.value),
			version,
		);
		if (error.value) return;
		version = item.value.conversionVersion || 0;
	}
	applyLineConversion(props.line, unit.value, Number(factor.value), Number(quantity.value));
	baseline.value = snapshot();
	emit("dirtyChange", false);
	emit("applied");
}
</script>
<template>
	<section class="preview-conversion-editor">
		<h3>单位与换算</h3>
		<PreviewSearchSelect
			data-field="entryUom"
			label="输入单位"
			v-model="unit"
			:options="reviewSession.units.map((row) => row.name)"
			:disabled="disabled"
		/>
		<p>库存单位：{{ line.uom }}（只读）</p>
		<PreviewUiButton
			v-if="!creating"
			:disabled="disabled || !conversionAccess.createUnit"
			@click="creating = true"
			>新建单位</PreviewUiButton
		>
		<p v-if="!conversionAccess.createUnit" class="muted">
			没有新建单位的权限，可选择已有单位。
		</p>
		<fieldset v-if="creating" :disabled="disabled">
			<label class="preview-field">单位名称<input v-model="newName" /></label>
			<label class="preview-choice-label"
				><input v-model="whole" type="checkbox" />只允许整数数量</label
			>
			<PreviewUiButton @click="create">保存并使用单位</PreviewUiButton>
			<PreviewUiButton
				@click="
					creating = false;
					newName = '';
				"
				>取消新建单位</PreviewUiButton
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
				:disabled="disabled"
		/></label>
		<label v-if="!reusableOnly" class="preview-field"
			>输入数量（{{ unit }}）<input
				v-model="quantity"
				type="number"
				step="any"
				:disabled="disabled"
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
				:disabled="disabled || reusableOnly || !conversionAccess.updateItem"
			/>保存为此物品的常用换算</label
		>
		<p v-if="!conversionAccess.updateItem" class="muted">
			没有更新物品的权限；可仅应用于此分配。
		</p>
		<p class="muted">已保存的单位与常用换算会保留；取消操作单不会删除它们。</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<PreviewUiButton :disabled="disabled" variant="primary" @click="apply">{{
			replacement ? "更新常用换算并应用" : "应用换算"
		}}</PreviewUiButton>
		<details>
			<summary>预览换算状态</summary>
			<label class="preview-choice-label"
				><input v-model="conversionAccess.createUnit" type="checkbox" />允许新建单位</label
			>
			<label class="preview-choice-label"
				><input
					v-model="conversionAccess.updateItem"
					type="checkbox"
					@change="!conversionAccess.updateItem && (reuse = false)"
				/>允许更新物品</label
			>
			<label class="preview-choice-label"
				><input v-model="conversionAccess.failSave" type="checkbox" />模拟保存失败</label
			>
			<label class="preview-choice-label"
				><input
					v-model="conversionAccess.staleItem"
					type="checkbox"
				/>模拟物品版本冲突</label
			>
			<PreviewUiButton
				@click="
					version = item.conversionVersion || 0;
					conversionAccess.staleItem = false;
					error = '';
				"
				>重新载入常用换算</PreviewUiButton
			>
		</details>
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
