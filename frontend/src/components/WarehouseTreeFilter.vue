<script setup lang="ts">
import { computed, ref } from 'vue'
import WarehouseTreeNode from './WarehouseTreeNode.vue'

type Node = { name: string; parent_warehouse?: string; lft?: number; rgt?: number }
const props = defineProps<{ modelValue: string[]; options: Node[]; tree?: Node[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const search = ref('')
const nodes = computed(() => [...(props.options || [])].sort((a, b) => (a.lft || 0) - (b.lft || 0)))
const roots = computed(() => nodes.value.filter(node =>
  !node.parent_warehouse || !nodes.value.some(parent => parent.name === node.parent_warehouse),
))
</script>

<template>
  <fieldset class="warehouse-tree-filter">
    <legend>仓库 / 位置</legend>
    <input v-if="nodes.length > 8" v-model="search" type="search" placeholder="搜索位置或路径" aria-label="搜索位置或路径">
    <p v-if="!modelValue.length" class="field-hint">全部可见位置</p>
    <ul class="warehouse-tree">
      <WarehouseTreeNode v-for="node in roots" :key="node.name" :node="node" :nodes="nodes" :tree="tree || options" :model-value="modelValue" :search-term="search" @update:model-value="emit('update:modelValue', $event)" />
    </ul>
  </fieldset>
</template>
