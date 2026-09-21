<script setup lang="ts">
import { computed } from 'vue'
import HierarchyAutocomplete from './HierarchyAutocomplete.vue'

type Category = { name: string; item_group_name?: string; parent_item_group?: string; is_group?: number | boolean; lft?: number; rgt?: number }
const props = withDefaults(defineProps<{
  modelValue: string[]
  rows: Category[]
  counts?: Record<string, number>
  title?: string
  placeholder?: string
}>(), {
  counts: () => ({}),
  title: '物品类别',
  placeholder: '搜索或浏览物品类别',
})
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

// ERPNext's universal root is not a user-facing category.  Remove it from
// both structures and re-root its children; otherwise the autocomplete sees
// a hidden, collapsed ancestor and renders no category rows at all.
const tree = computed(() => props.rows
  .filter(row => row.name !== 'All Item Groups')
  .map(row => {
    const parent = row.parent_item_group === 'All Item Groups' ? undefined : row.parent_item_group
    return { ...row, parent, parent_item_group: parent, label: row.item_group_name || row.name }
  }))
const options = computed(() => tree.value
  .filter(row => props.counts[row.name] !== 0)
  .map(row => ({ ...row, count: props.counts[row.name] })))
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
