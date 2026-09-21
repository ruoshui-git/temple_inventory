<script setup lang="ts">
import { computed } from 'vue'
import HierarchyAutocomplete from './HierarchyAutocomplete.vue'
import { warehouseFilterOptions, warehousePresentation, type WarehouseRecord } from '../lib/warehousePresenter'

const props = withDefaults(defineProps<{
  modelValue: string[]
  rows: WarehouseRecord[]
  counts?: Record<string, number>
  title?: string
  placeholder?: string
}>(), {
  counts: () => ({}),
  title: '仓库 / 位置',
  placeholder: '搜索或浏览仓库 / 位置',
})
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

// The display list excludes fallback leaves; the complete tree is retained for
// parent selection and backend-compatible descendant expansion.
const options = computed(() => warehouseFilterOptions(props.rows, props.counts)
  // Counts are unavailable before the first result response; only an explicit
  // zero suppresses an option.
  .filter(option => option.count !== 0))
const tree = computed(() => props.rows.map(row => ({
  ...row,
  // HierarchyAutocomplete also uses its tree for selected-chip paths.  Raw
  // Warehouse names contain ERPNext's company suffix (for example " - O").
  label: warehousePresentation(row.name, props.rows).localLabel,
})))
</script>

<template>
  <HierarchyAutocomplete
    :model-value="modelValue"
    :title="title"
    :placeholder="placeholder"
    :options="options"
    :tree="tree"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
