<script setup lang="ts">
import UiButton from "./UiButton.vue";
import { useAttrs } from "vue";

defineOptions({ inheritAttrs: false });
const attrs = useAttrs();

const props = withDefaults(
	defineProps<{
		modelValue?: string;
		min?: string;
		max?: string;
		label?: string;
		id?: string;
		name?: string;
		required?: boolean;
		disabled?: boolean;
		clearable?: boolean;
		ariaLabel?: string;
		ariaInvalid?: boolean | "true" | "false";
	}>(),
	{ modelValue: "", required: false, disabled: false, clearable: false },
);
const emit = defineEmits<{
	"update:modelValue": [value: string];
	input: [event: Event];
	change: [event: Event];
}>();
function update(event: Event) {
	const input = event.target as HTMLInputElement;
	emit("update:modelValue", input.value);
	if (event.type === "input") emit("input", event);
	else emit("change", event);
}
</script>

<template>
	<span class="date-field">
		<input
			v-bind="attrs"
			:id="id"
			:name="name"
			:value="modelValue"
			type="date"
			:min="min"
			:max="max"
			:required="required"
			:disabled="disabled"
			:aria-label="ariaLabel || label"
			:aria-invalid="ariaInvalid"
			@input="update"
			@change="update"
		/>
		<UiButton
			v-if="clearable && modelValue && !required"
			class="date-field-clear"
			variant="ghost"
			:disabled="disabled"
			:aria-label="`清除${label || '日期'}`"
			@click="emit('update:modelValue', '')"
			>清除</UiButton
		>
	</span>
</template>

<style scoped>
.date-field {
	display: flex;
	align-items: center;
	gap: var(--p-space-2);
	min-width: 0;
}
.date-field input {
	flex: 1 1 auto;
	min-width: 0;
}
.date-field-clear {
	flex: 0 0 auto;
}
</style>
