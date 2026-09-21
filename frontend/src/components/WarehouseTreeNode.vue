<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { warehouseLabelContract } from '../lib/api'

type Node = {
  name: string
  warehouse_name?: string
  parent_warehouse?: string
  is_group?: number | boolean
  lft?: number
  rgt?: number
  warehouse_type?: string
}

const props = defineProps<{
  node: Node
  nodes: Node[]
  modelValue: string[]
  tree: Node[]
  searchTerm?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const expanded = ref(false)

const children = computed(() => props.nodes.filter(child => child.parent_warehouse === props.node.name))
const leaves = computed(() => props.nodes.filter(node =>
  (node.lft || 0) >= (props.node.lft || 0) &&
  (node.rgt || 0) <= (props.node.rgt || 0) &&
  node.name !== props.node.name &&
  !node.is_group,
))
const normalizedSearch = computed(() => props.searchTerm?.trim().toLowerCase() || '')
const selfMatches = computed(() => {
  if (!normalizedSearch.value) return true
  return warehouseLabelContract(props.node.name, props.tree).search_text
    .toLowerCase()
    .includes(normalizedSearch.value)
})
const visible = computed(() => selfMatches.value || children.value.some(child => {
  const descendants = props.nodes.filter(node =>
    (node.lft || 0) >= (child.lft || 0) &&
    (node.rgt || 0) <= (child.rgt || 0),
  )
  return descendants.some(node =>
    warehouseLabelContract(node.name, props.tree).search_text
      .toLowerCase()
      .includes(normalizedSearch.value),
  )
}))
function coveredBySelection(name: string) {
  if (props.modelValue.includes(name)) return true
  const node = props.nodes.find(candidate => candidate.name === name)
  return Boolean(node && props.modelValue.some(value => {
    const ancestor = props.tree.find(candidate => candidate.name === value)
    return Boolean(ancestor?.is_group && (node.lft || 0) > (ancestor.lft || 0) && (node.rgt || 0) < (ancestor.rgt || 0))
  }))
}
const selectedLeaves = computed(() => leaves.value.filter(leaf => coveredBySelection(leaf.name)))
const checked = computed(() => {
  if (!props.node.is_group) return coveredBySelection(props.node.name)
  return leaves.value.length > 0 && selectedLeaves.value.length === leaves.value.length
})
const indeterminate = computed(() => Boolean(props.node.is_group && selectedLeaves.value.length > 0 && selectedLeaves.value.length < leaves.value.length))

watch(normalizedSearch, value => {
  if (value) expanded.value = true
})

function toggle() {
  const next = new Set(props.modelValue)
  if (props.node.is_group) {
    if (checked.value) next.delete(props.node.name)
    else next.add(props.node.name)
    for (const leaf of leaves.value) next.delete(leaf.name)
  } else {
    const coveringParent = props.tree.find(parent =>
      parent.is_group &&
      (props.node.lft || 0) > (parent.lft || 0) &&
      (props.node.rgt || 0) < (parent.rgt || 0) &&
      next.has(parent.name),
    )
    if (coveringParent) next.delete(coveringParent.name)
    next.has(props.node.name) ? next.delete(props.node.name) : next.add(props.node.name)
  }
  emit('update:modelValue', [...next])
}
</script>

<template>
  <li v-if="visible">
    <div class="tree-row">
      <button v-if="children.length" type="button" class="tree-toggle" :aria-expanded="expanded" :aria-label="(expanded ? '收起' : '展开') + ' ' + (node.warehouse_name || node.name)" @click="expanded = !expanded">{{ expanded ? '−' : '+' }}</button>
      <span v-else class="tree-spacer" aria-hidden="true"></span>
      <label><input type="checkbox" :checked="checked" :indeterminate="indeterminate" @change="toggle"><span>{{ warehouseLabelContract(node.name, tree).full_label }}</span><small v-if="node.is_group">分组</small></label>
    </div>
    <ul v-if="children.length && (expanded || searchTerm)" class="tree-children">
      <WarehouseTreeNode v-for="child in children" :key="child.name" :node="child" :nodes="nodes" :tree="tree" :model-value="modelValue" :search-term="searchTerm" @update:model-value="emit('update:modelValue', $event)" />
    </ul>
  </li>
</template>
