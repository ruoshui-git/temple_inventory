<script setup lang="ts">
withDefaults(
	defineProps<{
		modelValue: string;
		label: string;
		placeholder?: string;
		autocomplete?: string;
	}>(),
	{ placeholder: "", autocomplete: "off" },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
	<label class="browse-persistent-search shared-search-field">
		<span class="sr-only">{{ label }}</span>
		<input
			:value="modelValue"
			type="search"
			:aria-label="label"
			:placeholder="placeholder || label"
			:autocomplete="autocomplete"
			@input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
		/>
	</label>
</template>
