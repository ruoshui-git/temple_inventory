<script setup lang="ts">
import { computed } from "vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import type { HierarchyFilterNode } from "../../components/ui/HierarchyFilter.vue";

export interface CategoryDraft {
	label: string;
	parent: string;
	is_group: boolean;
}
const props = withDefaults(
	defineProps<{
		modelValue: CategoryDraft;
		categories: HierarchyFilterNode[];
		disabled?: boolean;
		excludedNames?: string[];
	}>(),
	{ disabled: false, excludedNames: () => [] },
);
const emit = defineEmits<{ "update:modelValue": [value: CategoryDraft] }>();
const parentOptions = computed(() => [
	{ value: "", label: "顶层分类", detail: "类别根目录" },
	...props.categories
		.filter((category) => category.is_group && !props.excludedNames.includes(category.name))
		.map((category) => ({
			value: category.name,
			label: category.label || category.name,
			detail: category.parent
				? `${props.categories.find((row) => row.name === category.parent)?.label || category.parent} / ${category.label || category.name}`
				: "顶层分类",
		})),
]);
function update<K extends keyof CategoryDraft>(field: K, value: CategoryDraft[K]) {
	emit("update:modelValue", { ...props.modelValue, [field]: value });
}
</script>

<template>
	<label class="preview-field">
		分类名称<input
			data-category-name
			:value="modelValue.label"
			:disabled="disabled"
			@input="update('label', ($event.target as HTMLInputElement).value)"
		/>
	</label>
	<SearchSelect
		label="上级分类"
		:model-value="modelValue.parent"
		:disabled="disabled"
		:options="parentOptions"
		@update:model-value="update('parent', $event)"
	/>
	<label class="preview-choice-label">
		<input
			:checked="modelValue.is_group"
			type="checkbox"
			:disabled="disabled"
			@change="update('is_group', ($event.target as HTMLInputElement).checked)"
		/>
		允许下级分类
	</label>
</template>
