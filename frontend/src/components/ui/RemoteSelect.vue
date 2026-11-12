<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { preferenceUser } from "../../lib/uiPreferences";
import SearchSelect, { type SearchOption } from "./SearchSelect.vue";
const props = defineProps<{
	modelValue?: string;
	label: string;
	disabled?: boolean;
	context?: string;
	selectedLabel?: string;
	externalLabel?: boolean;
	load: (
		query: string,
		start: number,
		signal: AbortSignal,
	) => Promise<{ rows: SearchOption[]; total: number; next: number | null }>;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const rows = ref<SearchOption[]>([]),
	loading = ref(false),
	error = ref(""),
	query = ref("");
const next = ref<number | null>(null),
	total = ref(0);
let generation = 0;
let controller: AbortController | undefined;
let failedStart = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
const firstPages = new Map<
	string,
	{ savedAt: number; result: { rows: SearchOption[]; total: number; next: number | null } }
>();
const labels = new Map<string, string>();
async function search(value = query.value, start = 0, immediate = false) {
	query.value = value;
	if (debounceTimer) clearTimeout(debounceTimer);
	if (start === 0 && value && !immediate) {
		generation++;
		controller?.abort();
		rows.value = [];
		total.value = 0;
		next.value = null;
		loading.value = true;
		error.value = "";
		debounceTimer = setTimeout(() => void search(value, start, true), 250);
		return;
	}
	const cacheKey = `${preferenceUser.value}\u0000${props.context || ""}\u0000${value}`;
	const cached = start === 0 ? firstPages.get(cacheKey) : undefined;
	const showCached = Boolean(cached && Date.now() - cached.savedAt < 30_000);
	if (showCached) {
		rows.value = cached!.result.rows;
		total.value = cached!.result.total;
		next.value = cached!.result.next;
		cached!.result.rows.forEach((row) => labels.set(row.value, row.label));
	}
	const request = ++generation;
	controller?.abort();
	controller = new AbortController();
	loading.value = !showCached;
	error.value = "";
	failedStart = start;
	try {
		const result = await props.load(value, start, controller.signal);
		if (request !== generation) return;
		if (start === 0) firstPages.set(cacheKey, { savedAt: Date.now(), result });
		rows.value = start
			? [
					...rows.value,
					...result.rows.filter(
						(row) => !rows.value.some((old) => old.value === row.value),
					),
				]
			: result.rows;
		result.rows.forEach((row) => labels.set(row.value, row.label));
		total.value = result.total;
		next.value = result.next;
	} catch (reason) {
		if (request !== generation) return;
		error.value = reason instanceof Error ? reason.message : "选项加载失败";
	} finally {
		if (request === generation) loading.value = false;
	}
}
watch(
	() => props.context,
	() => {
		firstPages.clear();
		generation++;
		controller?.abort();
		if (debounceTimer) clearTimeout(debounceTimer);
		rows.value = [];
		total.value = 0;
		next.value = null;
		loading.value = false;
		error.value = "";
	},
);
watch(preferenceUser, () => {
	firstPages.clear();
	generation++;
	controller?.abort();
	rows.value = [];
	total.value = 0;
	next.value = null;
	loading.value = false;
	error.value = "";
});
onBeforeUnmount(() => {
	generation++;
	controller?.abort();
	if (debounceTimer) clearTimeout(debounceTimer);
});
</script>
<template>
	<SearchSelect
		:model-value="modelValue"
		:options="rows"
		:label="label"
		:disabled="disabled"
		remote
		:loading="loading"
		:error="error"
		:total="total"
		:has-more="next !== null"
		:selected-label="selectedLabel || labels.get(modelValue || '')"
		:external-label="externalLabel"
		:aria-label="externalLabel ? label : undefined"
		@update:model-value="emit('update:modelValue', $event)"
		@search="search($event, 0, !$event)"
		@load-more="next !== null && search(query, next, true)"
		@retry="search(query, failedStart, true)"
	/>
</template>
