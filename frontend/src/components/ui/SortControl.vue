<script setup lang="ts" generic="TField extends string">
import UiButton from "./UiButton.vue";

withDefaults(
	defineProps<{
		field: TField;
		direction: "asc" | "desc";
		fields: ReadonlyArray<{ value: TField; label: string }>;
		label?: string;
	}>(),
	{ label: "排序字段" },
);
const emit = defineEmits<{
	"update:field": [value: TField];
	"update:direction": [value: "asc" | "desc"];
}>();
</script>

<template>
	<div class="browse-sort-control">
		<label class="preview-inline-field">
			{{ label }}
			<select
				:aria-label="label"
				:value="field"
				@change="emit('update:field', ($event.target as HTMLSelectElement).value as TField)"
			>
				<option v-for="option in fields" :key="option.value" :value="option.value">
					{{ option.label }}
				</option>
			</select>
		</label>
		<UiButton
			:aria-label="direction === 'asc' ? '切换为降序' : '切换为升序'"
			:title="direction === 'asc' ? '升序' : '降序'"
			@click="emit('update:direction', direction === 'asc' ? 'desc' : 'asc')"
		>
			{{ direction === "asc" ? "↑ 升序" : "↓ 降序" }}
		</UiButton>
	</div>
</template>
