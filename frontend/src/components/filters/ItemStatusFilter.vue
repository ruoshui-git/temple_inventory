<script setup lang="ts">
import DisclosureIcon from "../ui/DisclosureIcon.vue";

const props = defineProps<{
	modelValue: "enabled" | "disabled" | "all";
}>();
const emit = defineEmits<{ "update:modelValue": [value: "enabled" | "disabled" | "all"] }>();
const labels = { enabled: "启用", disabled: "停用", all: "全部" };
</script>

<template>
	<details class="browse-filter-disclosure" data-filter-field="itemStatus">
		<summary class="ti-disclosure">
			<DisclosureIcon variant="inline" />物品状态<small>{{
				labels[props.modelValue]
			}}</small>
		</summary>
		<label class="preview-field">
			物品状态<select
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
	</details>
</template>
