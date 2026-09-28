<script setup lang="ts">
import { ref } from "vue";
import IconButton from "./IconButton.vue";
import Scanner from "./Scanner.vue";

const props = withDefaults(
	defineProps<{
		modelValue: string;
		label: string;
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		scanLabel?: string;
	}>(),
	{ placeholder: "", required: false, disabled: false, scanLabel: "扫描条码" },
);
const emit = defineEmits<{
	"update:modelValue": [value: string];
	scan: [value: string];
}>();
const scanner = ref(false);
const inputId = `scannable-input-${Math.random().toString(36).slice(2)}`;

function update(event: Event) {
	emit("update:modelValue", (event.target as HTMLInputElement).value);
}
function scanned(value: string) {
	emit("update:modelValue", value);
	emit("scan", value);
	scanner.value = false;
}
</script>

<template>
	<div class="scannable-field">
		<label :for="inputId"
			>{{ label }} <span v-if="required" class="required-mark" aria-hidden="true">*</span
			><span v-if="required" class="sr-only">必填</span></label
		>
		<div class="input-with-action">
			<input
				:id="inputId"
				:value="modelValue"
				:placeholder="placeholder"
				:required="required"
				:disabled="disabled"
				autocomplete="off"
				@input="update"
			/><IconButton :label="scanLabel" :disabled="disabled" @click="scanner = true">
				<svg aria-hidden="true" viewBox="0 0 24 24">
					<path
						d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10M8 9v6m3-6v6m3-6v6m3-6v6"
					/>
				</svg>
			</IconButton>
		</div>
	</div>
	<Scanner v-if="scanner" presentation="modal" @scan="scanned" @close="scanner = false" />
</template>

<style scoped>
.input-with-action {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 0.5rem;
	align-items: start;
}

.input-with-action :deep(.icon-button) {
	width: 2.75rem;
	height: 2.75rem;
	margin-top: 0.25rem;
	flex: 0 0 auto;
}
</style>
