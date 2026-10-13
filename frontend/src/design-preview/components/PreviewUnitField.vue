<script setup lang="ts">
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import { ref } from "vue";
import { reviewSession } from "../reviewModel";
import PreviewUiButton from "./PreviewUiButton.vue";
defineProps<{ modelValue?: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const creating = ref(false);
const name = ref("");
const whole = ref(false);
const error = ref("");
function create() {
	const value = name.value.trim();
	if (!value) {
		error.value = "请填写单位名称";
		return;
	}
	if (reviewSession.units.some((unit) => unit.name === value)) {
		error.value = "单位已存在，请直接选择";
		return;
	}
	reviewSession.units.push({ name: value, whole: whole.value });
	emit("update:modelValue", value);
	creating.value = false;
	error.value = "";
}
</script>
<template>
	<div class="preview-unit-field">
		<PreviewSearchSelect
			label="计量单位"
			:model-value="modelValue"
			:options="
				reviewSession.units.map((unit) => ({
					value: unit.name,
					label: unit.name,
					detail: unit.whole ? '整数数量' : '允许小数',
				}))
			"
			:disabled="disabled"
			@update:model-value="emit('update:modelValue', $event)"
		/>
		<PreviewUiButton v-if="!disabled && !creating" variant="ghost" @click="creating = true"
			>新建单位</PreviewUiButton
		>
		<fieldset v-if="creating" :disabled="disabled">
			<legend>新建单位</legend>
			<label>单位名称<input v-model="name" /></label>
			<label><input v-model="whole" type="checkbox" />只允许整数数量</label>
			<p v-if="error" role="alert">{{ error }}</p>
			<PreviewUiButton @click="creating = false">取消</PreviewUiButton>
			<PreviewUiButton @click="create">保存并使用单位</PreviewUiButton>
		</fieldset>
	</div>
</template>
