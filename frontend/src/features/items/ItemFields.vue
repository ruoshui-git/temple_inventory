<script setup lang="ts">
import { unitLabel } from "../../lib/units";
import CategoryField from "../references/CategoryField.vue";
import UnitField from "../references/UnitField.vue";
import { onBeforeUnmount, onDeactivated, ref, watch } from "vue";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import FormField from "../../components/ui/FormField.vue";
import { useFormValidation } from "../../composables/useFormValidation";
import Scanner from "../../components/Scanner.vue";
import type { ItemInput } from "./useItemEditor";
import { appendBarcode as appendBarcodeValue } from "./barcodeInput";
const props = defineProps<{
	model: ItemInput;
	editing?: boolean;
	disabled?: boolean;
	suggestedCode?: string;
	trackingChangeable?: boolean;
	trackingChangeReason?: string;
}>();
const scannerOpen = ref(false);
const validation = useFormValidation();
const unregisterName = validation.register(
	"item-name",
	() => props.model.name,
	[(v) => (v.trim() ? true : "请输入名称")],
	() => document.getElementById("item-name")?.focus(),
);
const unregisterUom = validation.register(
	"item-uom",
	() => props.model.uom,
	[(v) => (v ? true : "请选择计量单位")],
	() => document.querySelector<HTMLElement>(".unit-field input")?.focus(),
);
onBeforeUnmount(() => {
	unregisterName.unregister();
	unregisterUom.unregister();
});
defineExpose({ validate: validation.validate });
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
	<div class="form-fields creation-fields">
		<dl v-if="editing" class="info-grid">
			<div>
				<dt>物品编号</dt>
				<dd>{{ model.code }}</dd>
			</div>
		</dl>
		<FormField label="名称" for="item-name" required :error="validation.errors['item-name']"
			><template #default="{ fieldAttrs }"
				><input
					v-model="model.name"
					v-bind="fieldAttrs"
					:disabled="disabled"
					required /></template
		></FormField>
		<CategoryField v-model="model.category" :disabled="disabled" />
		<dl v-if="editing" class="info-grid">
			<div>
				<dt>库存单位</dt>
				<dd>{{ unitLabel(model.uom) }}</dd>
			</div>
		</dl>
		<UnitField
			v-else
			v-model="model.uom"
			:disabled="disabled"
			required
			:error="validation.errors['item-uom']"
		/>
		<FormField v-if="!editing" label="物品编号"
			><template #default="{ fieldAttrs }"
				><div class="item-code-control">
					<input
						v-model="model.code"
						v-bind="fieldAttrs"
						:placeholder="
							suggestedCode ? `留空自动生成（${suggestedCode}）` : '留空自动生成'
						"
						:disabled="disabled"
						autocapitalize="off"
						autocorrect="off"
						spellcheck="false"
					/><UiButton
						v-if="suggestedCode && model.code !== suggestedCode"
						size="compact"
						aria-label="恢复自动编号"
						title="恢复自动编号"
						@click="model.code = suggestedCode || ''"
						>↻</UiButton
					>
				</div></template
			></FormField
		>
		<FormField class="full-width item-barcode-field" label="条码" hint="每行一个"
			><template #default="{ fieldAttrs }">
				<textarea
					v-model="model.barcode"
					v-bind="fieldAttrs"
					:disabled="disabled"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
				/></template
		></FormField>
		<div class="full-width">
			<UiButton icon="scan" :disabled="disabled" @click="scannerOpen = true"
				>扫码添加条码</UiButton
			>
		</div>
		<FormField class="full-width" label="物品说明"
			><template #default="{ fieldAttrs }">
				<textarea
					v-model="model.description"
					v-bind="fieldAttrs"
					:disabled="disabled"
				/></template
		></FormField>
		<template v-if="editing && !trackingChangeable"
			><dl class="info-grid">
				<div>
					<dt>按批次管理</dt>
					<dd>{{ model.tracksBatch ? "是" : "否" }}</dd>
				</div>
				<div>
					<dt>记录效期</dt>
					<dd>{{ model.tracksExpiry ? "是" : "否" }}</dd>
				</div>
			</dl>
			<p v-if="trackingChangeReason" class="muted">
				{{ trackingChangeReason }}；如需更改，请新建物品。
			</p></template
		>
		<template v-else>
			<label class="form-choice-label"
				><input
					type="checkbox"
					v-model="model.tracksBatch"
					:disabled="disabled || model.tracksExpiry"
				/>按批次管理</label
			>
			<label class="form-choice-label"
				><input
					type="checkbox"
					v-model="model.tracksExpiry"
					:disabled="disabled"
					@change="
						($event.target as HTMLInputElement).checked && (model.tracksBatch = true)
					"
				/>记录效期</label
			>
			<p class="muted">
				{{ model.tracksExpiry ? "效期按批次记录" : "批次、数量和效期在入库单中填写。" }}
			</p>
		</template>
		<Overlay
			v-if="scannerOpen"
			title="扫码添加条码"
			size="small"
			panel-class="inventory-scanner"
			@close="scannerOpen = false"
			><Scanner
				presentation="inline"
				submit-label="添加条码"
				:paused="disabled"
				@scan="appendBarcode"
				@close="scannerOpen = false"
		/></Overlay>
	</div>
</template>
<style scoped>
.item-code-control {
	display: flex;
	align-items: center;
	gap: 4px;
}
.item-code-control input {
	min-width: 0;
	flex: 1;
}
.item-barcode-field textarea {
	width: min(100%, 640px);
}
</style>
