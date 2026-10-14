<script setup lang="ts">
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import { computed, nextTick, ref, watch } from "vue";
import { reviewSession } from "../reviewModel";
import PreviewUiButton from "./PreviewUiButton.vue";
defineProps<{ modelValue?: string; disabled?: boolean; editorTarget?: HTMLElement }>();
const emit = defineEmits<{
	"update:modelValue": [value: string];
	dirtyChange: [dirty: boolean];
}>();
const creating = ref(false);
const name = ref("");
const whole = ref(false);
const error = ref("");

const editor = ref<HTMLElement>();
const trigger = ref<InstanceType<typeof PreviewUiButton>>();
watch(creating, async (value) => {
	await nextTick();
	if (value) editor.value?.querySelector<HTMLInputElement>("input")?.focus();
	else (trigger.value?.$el as HTMLButtonElement | undefined)?.focus();
});
const dirty = computed(() => !!name.value || whole.value);
function finish() {
	creating.value = false;
	name.value = "";
	whole.value = false;
	error.value = "";
}
watch(dirty, (value) => emit("dirtyChange", value), { immediate: true, flush: "sync" });

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
	finish();
}
</script>
<template>
	<div class="preview-unit-field preview-supporting-field">
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
		<PreviewUiButton
			ref="trigger"
			v-if="!disabled && !creating"
			variant="ghost"
			@click="creating = true"
			>新建单位</PreviewUiButton
		>
		<Teleport :to="editorTarget || 'body'" :disabled="!editorTarget">
			<fieldset
				ref="editor"
				class="preview-supporting-editor"
				v-if="creating"
				:disabled="disabled"
			>
				<legend>新建单位</legend>
				<label class="preview-field">单位名称<input v-model="name" /></label>
				<label class="preview-choice-label"
					><input v-model="whole" type="checkbox" />只允许整数数量</label
				>
				<p v-if="error" role="alert">{{ error }}</p>
				<PreviewUiButton @click="finish">取消</PreviewUiButton>
				<PreviewUiButton @click="create">保存并使用单位</PreviewUiButton>
			</fieldset>
		</Teleport>
	</div>
</template>
