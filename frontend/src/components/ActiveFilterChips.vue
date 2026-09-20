<script setup lang="ts">
export interface FilterChip { key: string; label: string; value?: string }
defineProps<{ chips: FilterChip[] }>()
const emit = defineEmits<{ remove: [chip: FilterChip]; clear: [] }>()
</script>
<template><div v-if="chips.length" class="active-filter-chips" aria-label="已选筛选条件"><span v-for="chip in chips" :key="`${chip.key}:${chip.value || chip.label}`" class="filter-chip">{{ chip.label }} <button type="button" :aria-label="`移除 ${chip.label}`" @click="emit('remove', chip)">×</button></span><button type="button" class="clear-filters" @click="emit('clear')">清除全部</button></div></template>
