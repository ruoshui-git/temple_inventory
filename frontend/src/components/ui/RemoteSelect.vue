<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import SearchSelect, { type SearchOption } from "./SearchSelect.vue";
const props = defineProps<{
  modelValue?: string; label: string; disabled?: boolean; context?: string;
  selectedLabel?: string;
  load: (query: string, start: number, signal: AbortSignal) => Promise<{ rows: SearchOption[]; total: number; next: number | null }>;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const rows = ref<SearchOption[]>([]), loading = ref(false), error = ref(""), query = ref("");
const next = ref<number | null>(null), total = ref(0);
let generation = 0;
let controller: AbortController | undefined;
let failedStart = 0;
const labels = new Map<string, string>();
async function search(value = query.value, start = 0) {
  query.value = value;
  const request = ++generation;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = "";
  failedStart = start;
  try {
    const result = await props.load(value, start, controller.signal);
    if (request !== generation) return;
    rows.value = start ? [...rows.value, ...result.rows.filter((row) => !rows.value.some((old) => old.value === row.value))] : result.rows;
    result.rows.forEach((row) => labels.set(row.value, row.label));
    total.value = result.total;
    next.value = result.next;
  } catch (reason) {
    if (request !== generation) return;
    error.value = reason instanceof Error ? reason.message : "选项加载失败";
  } finally { if (request === generation) loading.value = false; }
}
watch(() => props.context, () => { generation++; controller?.abort(); rows.value = []; next.value = null; });
onBeforeUnmount(() => { generation++; controller?.abort(); });
</script>
<template>
  <SearchSelect :model-value="modelValue" :options="rows" :label="label" :disabled="disabled" remote :loading="loading" :error="error" :total="total" :has-more="next !== null" :selected-label="selectedLabel || labels.get(modelValue || '')" @update:model-value="emit('update:modelValue', $event)" @search="search($event)" @load-more="next !== null && search(query, next)" @retry="search(query, failedStart)" />
</template>
