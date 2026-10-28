<script setup lang="ts">
import FilterDisclosure from "../ui/FilterDisclosure.vue";

const props = defineProps<{
	modelValue: "enabled" | "disabled" | "all";
}>();
const emit = defineEmits<{ "update:modelValue": [value: "enabled" | "disabled" | "all"] }>();
const labels = { enabled: "启用", disabled: "停用", all: "全部" };
</script>

<template>
	<FilterDisclosure label="物品状态" :summary="labels[props.modelValue]" field="itemStatus">
		<label class="preview-field">
			<select
				:value="modelValue"
				aria-label="物品状态"
				@change="
					emit(
						'update:modelValue',
						($event.target as HTMLSelectElement).value as typeof modelValue,
					)
				"
			>
				<option value="enabled">启用</option>
				<option value="disabled">停用</option>
				<option value="all">全部</option>
			</select>
		</label>
	</FilterDisclosure>
</template>
