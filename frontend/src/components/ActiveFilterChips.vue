<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
export interface FilterChip { key: string; label: string; value?: string }
const props = defineProps<{ chips: FilterChip[] }>()
const emit = defineEmits<{ remove: [chip: FilterChip]; clear: [] }>()
const expanded = ref(false)
const overflowTrigger = ref<HTMLButtonElement>()
const visibleChips = computed(() => expanded.value ? props.chips : props.chips.slice(0, 6))
const hiddenCount = computed(() => Math.max(0, props.chips.length - visibleChips.value.length))
watch(() => props.chips.length, value => { if (value <= 6) expanded.value = false })
async function toggleOverflow() {
  expanded.value = !expanded.value
  await nextTick()
  if (!expanded.value) overflowTrigger.value?.focus()
}
</script>
<template><div v-if="chips.length" class="active-filter-chips" aria-label="已选筛选条件"><span v-for="chip in visibleChips" :key="`${chip.key}:${chip.value || chip.label}`" class="filter-chip"><button type="button" :aria-label="`移除 ${chip.label}`" @click="emit('remove', chip)">×</button><span>{{ chip.label }}</span></span><button v-if="hiddenCount || expanded" ref="overflowTrigger" type="button" class="chip-overflow" :aria-expanded="expanded" @click="toggleOverflow">{{ expanded ? '收起' : `另有 ${hiddenCount} 项` }}</button><button type="button" class="clear-filters" @click="emit('clear')">清除全部</button></div></template>
