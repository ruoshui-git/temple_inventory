<script setup lang="ts">
import { computed } from "vue";
import { groupLabels, groupSequencesForView, type ReportDataset } from "../../lib/reportContract";
import { groupByFieldOptions, nextGroupByField } from "../../lib/groupBy";

const props = defineProps<{
	dataset: ReportDataset;
	view: string;
	modelValue: string[];
}>();
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();
const groups = computed(() => groupByFieldOptions(props.dataset, props.view));
const secondGroups = computed(() =>
	groupByFieldOptions(props.dataset, props.view).filter((field) =>
		groupSequences.value.some(
			(sequence) => sequence[0] === props.modelValue[0] && sequence[1] === field,
		),
	),
);
const groupSequences = computed(() => groupSequencesForView(props.dataset, props.view));
function set(index: number, value: string) {
	emit(
		"update:modelValue",
		nextGroupByField(props.dataset, props.view, props.modelValue, index, value),
	);
}
</script>

<template>
	<fieldset class="browse-group-by" aria-label="结果分组">
		<legend>结果分组</legend>
		<label class="preview-field"
			>第一级<select
				:value="modelValue[0] || ''"
				@change="set(0, ($event.target as HTMLSelectElement).value)"
			>
				<option value="">不分组</option>
				<option v-for="group in groups" :key="group" :value="group">
					{{ groupLabels[group] || group }}
				</option>
			</select></label
		>
		<label class="preview-field"
			>第二级<select
				:value="modelValue[1] || ''"
				@change="set(1, ($event.target as HTMLSelectElement).value)"
				:disabled="!modelValue[0] || !secondGroups.length"
			>
				<option value="">无</option>
				<option v-for="group in secondGroups" :key="group" :value="group">
					{{ groupLabels[group] || group }}
				</option>
			</select></label
		>
	</fieldset>
</template>
