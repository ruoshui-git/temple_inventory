<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiButton from "./UiButton.vue";
import DateField from "./DateField.vue";

/** "" reads stock now; "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" reads that site-local moment. */
const props = defineProps<{ modelValue: string; today: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const draftDate = ref("");
const draftTime = ref("");
const error = ref("");

function reset(value: string) {
	const [date = "", time = ""] = value.split(" ");
	draftDate.value = date;
	draftTime.value = time.length === 5 ? `${time}:00` : time;
	error.value = "";
}

watch(() => props.modelValue, reset, { immediate: true });

const summary = computed(() => props.modelValue || "现在");

function apply() {
	if (!draftDate.value) {
		error.value = "请选择截至日期";
		return;
	}
	if (props.today && draftDate.value > props.today) {
		error.value = "截至日期不能晚于今天";
		return;
	}
	error.value = "";
	emit(
		"update:modelValue",
		draftTime.value ? `${draftDate.value} ${draftTime.value}` : draftDate.value,
	);
}

function useNow() {
	error.value = "";
	emit("update:modelValue", "");
}
</script>

<template>
	<div class="as-of-filter">
		<p class="as-of-summary">当前显示：{{ summary }}</p>
		<form class="as-of-fields" @submit.prevent="apply">
			<label class="form-field">
				<span>截至日期</span>
				<DateField v-model="draftDate" :max="props.today" aria-label="截至日期" />
			</label>
			<label class="form-field">
				<span>时间（可选）</span>
				<input v-model="draftTime" type="time" step="1" aria-label="截至时间" />
			</label>
			<p v-if="error" role="alert">{{ error }}</p>
			<div class="as-of-actions">
				<UiButton @click="reset(props.modelValue)">撤销</UiButton>
				<UiButton @click="useNow">现在</UiButton>
				<UiButton variant="primary" type="submit">应用</UiButton>
			</div>
		</form>
	</div>
</template>

<style scoped>
.as-of-filter {
	display: grid;
	gap: var(--p-space-2);
	min-width: 0;
}
.as-of-summary {
	margin: 0;
	color: var(--p-muted);
}
.as-of-fields {
	display: grid;
	gap: var(--p-space-2);
}
.as-of-actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: var(--p-space-2);
}
</style>
