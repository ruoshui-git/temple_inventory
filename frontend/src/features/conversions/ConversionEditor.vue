<script setup lang="ts">
import SearchSelect from "../../components/ui/SearchSelect.vue";
import Overlay from "../../components/ui/Overlay.vue";
import FormField from "../../components/ui/FormField.vue";
import UiButton from "../../components/ui/UiButton.vue";
import { useFormValidation } from "../../composables/useFormValidation";
import type { ConversionLine } from "../../lib/quantityConversion";
import type { StockItem } from "../../lib/stockPresentation";
import { unitLabel, unitOption } from "../../lib/units";
import { formatConversion } from "../../lib/conversionText";
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
	displayLabel: newDisplayLabel,
	existingUnit,
	whole,
	permitted: canCreateUnit,
	create,
	finish: finishCreation,
	busy: creationBusy,
	error: creationError,
} = creation;
const unitValidation = useFormValidation();
unitValidation.register(
	"conversion-unit-name",
	() => newName.value,
	[(value) => (value.trim() ? true : "请输入计量单位")],
	() => document.querySelector<HTMLElement>(".conversion-unit-name")?.focus(),
);
async function closeCreation() {
	await finishCreation();
}
async function saveNewUnit() {
	if (!unitValidation.validate().ok) return;
	await create();
}
async function selectExistingUnit() {
	const row = reference.units.find((entry) => entry.name === existingUnit.value);
	if (!row) return;
	unit.value = row.name;
	await finishCreation(false);
}
</script>
<template>
	<section class="conversion-editor">
		<h3>单位与换算</h3>
		<FormField label="输入单位" required>
			<template #default="{ fieldAttrs }">
				<SearchSelect
					v-bind="fieldAttrs"
					external-label
					data-field="entryUom"
					label="输入单位"
					v-model="unit"
					:options="
						reference.units.map((row) => ({
							...unitOption(row.name, { ...row, stockUom: line.uom }),
						}))
					"
					:disabled="disabled || busy"
				/>
			</template>
		</FormField>
		<p>库存单位：{{ unitLabel(line.uom) }}（只读）</p>
		<UiButton
			v-if="!creating && canCreateUnit"
			:disabled="disabled || busy || !canCreateUnit"
			@click="creating = true"
			>新建单位</UiButton
		>
		<Overlay v-if="creating" title="新建单位" size="small" @close="closeCreation">
			<FormField
				label="计量单位"
				required
				:error="unitValidation.errors['conversion-unit-name']"
			>
				<template #default="{ fieldAttrs }">
					<input
						v-model="newName"
						v-bind="fieldAttrs"
						class="conversion-unit-name"
						:disabled="creationBusy"
						autocapitalize="off"
						autocorrect="off"
						spellcheck="false"
					/>
				</template>
			</FormField>
			<FormField label="显示名称" hint="可选；留空时使用单位名称">
				<template #default="{ fieldAttrs }"
					><input v-model="newDisplayLabel" v-bind="fieldAttrs" :disabled="creationBusy"
				/></template>
			</FormField>
			<label class="form-choice-label">
				<input v-model="whole" type="checkbox" :disabled="creationBusy" />
				只允许整数数量
			</label>
			<p v-if="creationError" class="utility-error" role="alert">{{ creationError }}</p>
			<UiButton v-if="existingUnit" :disabled="creationBusy" @click="selectExistingUnit"
				>使用此单位</UiButton
			>
			<template #footer>
				<UiButton :disabled="creationBusy" @click="closeCreation">取消</UiButton>
				<UiButton
					variant="primary"
					:disabled="creationBusy"
					:loading="creationBusy"
					@click="saveNewUnit"
					>保存并使用单位</UiButton
				>
			</template>
		</Overlay>
		<dl v-if="unit === line.uom" class="info-grid">
			<div>
				<dt>单位换算</dt>
				<dd>1 {{ unitLabel(unit) }} = 1 {{ unitLabel(line.uom) }}</dd>
			</div>
		</dl>
		<FormField v-else label="单位换算" required :error="error || undefined">
			<template #default="{ fieldAttrs }">
				<div class="conversion-factor-control">
					<span>1 {{ unitLabel(unit) || "所选单位" }} =</span>
					<input
						v-bind="fieldAttrs"
						data-field="conversionFactor"
						v-model="factor"
						type="number"
						inputmode="decimal"
						enterkeyhint="next"
						step="any"
						min="0"
						:disabled="disabled || busy"
					/>
					<span>{{ unitLabel(line.uom) }}</span>
				</div>
			</template>
		</FormField>
		<FormField
			v-if="!reusableOnly"
			:label="'输入数量（' + unitLabel(unit) + '）'"
			required
			:error="error || undefined"
		>
			<template #default="{ fieldAttrs }">
				<input
					v-bind="fieldAttrs"
					v-model="quantity"
					type="number"
					inputmode="decimal"
					enterkeyhint="next"
					step="any"
					:disabled="disabled || busy"
				/>
			</template>
		</FormField>
		<p v-if="!reusableOnly" role="status">
			{{
				factor === ""
					? `${quantity} ${unitLabel(unit)} · 待填写比例`
					: formatConversion({
							qty: Number(quantity),
							uom: unit,
							factor: Number(factor),
							stockUom: line.uom,
						}) || `${quantity} ${unitLabel(unit)}`
			}}
		</p>
		<p v-if="replacement">
			将替换原换算：1 {{ unitLabel(unit) }} = {{ savedFactor }} {{ unitLabel(line.uom) }}
		</p>
		<p v-if="reusableOnly">保存为此物品的常用换算：是</p>
		<label v-else class="form-choice-label"
			><input
				v-model="reuse"
				type="checkbox"
				:disabled="disabled || busy || reusableOnly || !canUpdate"
			/>记住此换算（下次自动使用）</label
		>
		<p v-if="!canUpdate" class="muted">没有更新物品的权限；可仅应用于此明细。</p>
		<p class="muted">已保存的单位与常用换算会保留；取消操作单不会删除它们。</p>
		<p v-if="error || creationError" role="alert">{{ error || creationError }}</p>
		<UiButton
			:disabled="disabled"
			:loading="busy"
			loading-label="正在应用换算…"
			variant="primary"
			@click="apply"
			>{{ replacement ? "更新常用换算并应用" : "应用换算" }}</UiButton
		>
		<UiButton
			v-if="conflict || error"
			:disabled="busy"
			:loading="busy"
			loading-label="正在重新载入常用换算…"
			@click="reload"
			>重新载入常用换算</UiButton
		>
	</section>
</template>
<style scoped>
.conversion-editor {
	display: grid;
	gap: var(--p-space-3);
	min-width: 0;
}
.conversion-factor-control {
	display: grid;
	grid-template-columns: auto minmax(5ch, 1fr) auto;
	align-items: center;
	gap: var(--p-space-2);
}
.conversion-factor-control input {
	min-width: 5ch;
}
p {
	overflow-wrap: anywhere;
}
</style>
