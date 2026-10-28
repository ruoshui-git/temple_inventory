<script setup lang="ts">
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import { computed, nextTick, ref, watch } from "vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import UiButton from "../../components/ui/UiButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import FormField from "../../components/ui/FormField.vue";
import { useFormValidation } from "../../composables/useFormValidation";
import { useReferenceCreation } from "./useReferenceCreation";
import { unitOption } from "../../lib/units";
const props = withDefaults(
	defineProps<{ modelValue?: string; disabled?: boolean; required?: boolean; error?: string }>(),
	{ required: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const {
	reference,
	creating,
	name,
	displayLabel,
	existingUnit,
	whole,
	busy,
	error,
	permitted,
	finish,
	create,
	candidates,
	recover,
} = useReferenceCreation("unit", (value) => emit("update:modelValue", value));
const trigger = ref<InstanceType<typeof UiButton>>();
watch(creating, async (value) => {
	if (!value) {
		await nextTick();
		(
			document.querySelector<HTMLElement>(
				".preview-supporting-field .search-select-input input",
			) || (trigger.value?.$el as HTMLElement | undefined)
		)?.focus();
	}
});
const validation = useFormValidation();
validation.register(
	"unit-name",
	() => name.value,
	[(v) => (v.trim() ? true : "请输入计量单位")],
	() => document.querySelector<HTMLElement>(".preview-unit-create input")?.focus(),
);
const requiredError = computed(() => props.error || validation.errors["unit-name"]);
const unitOptions = computed(() => reference.units.map((unit) => unitOption(unit.name, unit)));
async function close() {
	await finish();
}
async function submit() {
	if (!validation.validate().ok) return;
	await create();
}
async function selectExisting() {
	const unit = reference.units.find((row) => row.name === existingUnit.value);
	if (!unit) return;
	emit("update:modelValue", unit.name);
	await finish(false);
}
</script>
<template>
	<div class="preview-supporting-field preview-unit-field">
		<div class="supporting-field-control">
			<FormField label="计量单位" :required="required" :error="requiredError"
				><template #default="{ fieldAttrs }"
					><SearchSelect
						v-bind="fieldAttrs"
						external-label
						label="计量单位"
						:model-value="modelValue"
						:options="unitOptions"
						:disabled="disabled || busy"
						@update:model-value="
							emit('update:modelValue', $event)
						" /></template></FormField
			><UiButton
				ref="trigger"
				v-if="!disabled && !creating && permitted"
				class="reference-create-button"
				aria-label="新建单位"
				title="新建单位"
				@click="creating = true"
				>+ 单位</UiButton
			>
		</div>
		<p v-if="!permitted" class="muted">没有新建单位的权限；可选择已有单位。</p>
		<DisclosureSection
			v-if="candidates.length"
			title="此浏览器有未完成输入"
			:count="candidates.length"
			:summary="`最近 ${candidates[0].updatedAt}`"
			><article v-for="candidate in candidates" :key="candidate.editorId">
				<p>{{ candidate.updatedAt }}</p>
				<RecoverySummary
					kind="UOM"
					:values="candidate.values"
					:copy-text="JSON.stringify(candidate.values, null, 2)"
					><UiButton @click="recover(candidate)">恢复输入</UiButton></RecoverySummary
				>
			</article></DisclosureSection
		>
		<Overlay v-if="creating" title="新建单位" size="small" @close="close"
			><form class="preview-unit-create" novalidate @submit.prevent="submit">
				<FormField label="计量单位" required :error="validation.errors['unit-name']"
					><template #default="{ fieldAttrs }"
						><input v-model="name" v-bind="fieldAttrs" /></template></FormField
				><FormField label="显示名称" hint="可选；留空时使用单位名称"
					><template #default="{ fieldAttrs }"
						><input v-model="displayLabel" v-bind="fieldAttrs" /></template></FormField
				><label class="preview-choice-label"
					><input v-model="whole" type="checkbox" />只允许整数数量</label
				>
				<div v-if="error" class="notice-bar warning" role="alert">{{ error }}</div>
				<div class="dialog-actions">
					<UiButton @click="close">取消</UiButton
					><UiButton v-if="existingUnit" @click="selectExisting">使用此单位</UiButton
					><UiButton variant="primary" :disabled="busy" :loading="busy" type="submit"
						>保存并使用单位</UiButton
					>
				</div>
			</form></Overlay
		>
	</div>
</template>
<style scoped>
.supporting-field-control {
	display: flex;
	align-items: end;
	gap: 8px;
}
.supporting-field-control :deep(.form-field) {
	flex: 1;
	min-width: 0;
}
.supporting-field-control :deep(.reference-create-button) {
	flex: 0 0 auto;
	min-width: 5.5rem;
	white-space: nowrap;
}
.dialog-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 16px;
}
</style>
