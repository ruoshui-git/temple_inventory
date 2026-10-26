<script setup lang="ts">
import { computed, useId } from "vue";

const props = withDefaults(
	defineProps<{
		label: string;
		required?: boolean;
		hint?: string;
		error?: string;
		for?: string;
	}>(),
	{ required: false },
);
const uid = useId();
const controlId = computed(() => props.for || `field-${uid}`);
const hintId = `${uid}-hint`;
const errorId = `${uid}-error`;
const describedBy = computed(
	() =>
		[props.hint ? hintId : "", props.error ? errorId : ""].filter(Boolean).join(" ") ||
		undefined,
);
const fieldAttrs = computed(() => ({
	id: controlId.value,
	"aria-describedby": describedBy.value,
	"aria-invalid": props.error ? true : undefined,
	"aria-required": props.required ? true : undefined,
}));
defineSlots<{
	default(props: { fieldAttrs: typeof fieldAttrs.value; controlId: string }): unknown;
}>();
</script>
<template>
	<div class="form-field">
		<label :for="controlId">
			{{ label
			}}<span v-if="required" class="form-field-required" aria-hidden="true">*</span>
		</label>
		<slot :field-attrs="fieldAttrs" :control-id="controlId" />
		<p v-if="hint" :id="hintId" class="field-hint">{{ hint }}</p>
		<p v-if="error" :id="errorId" class="utility-error form-field-error" role="alert">
			{{ error }}
		</p>
	</div>
</template>
