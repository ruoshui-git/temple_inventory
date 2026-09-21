<script setup lang="ts">
import { computed } from 'vue'
import { warehousePresentation } from '../lib/warehousePresenter'

type Node = { name: string; parent_warehouse?: string; is_group?: number | boolean; lft?: number; rgt?: number; warehouse_name?: string; warehouse_type?: string }
const props = defineProps<{ nodes: Node[]; tree: Node[]; selected: string; summaries: Record<string, any> }>()
const emit = defineEmits<{ select: [name: string] }>()
const roots = computed(() => props.nodes.filter(node => !props.nodes.some(parent => parent.name === node.parent_warehouse)))
const children = (node: Node) => props.nodes.filter(child => child.parent_warehouse === node.name)
const depth = (node: Node) => { let value = 0, parent = props.nodes.find(item => item.name === node.parent_warehouse); while (parent) { value++; parent = props.nodes.find(item => item.name === parent?.parent_warehouse) } return value }
</script>

<template>
  <ul class="warehouse-tree"><li v-for="node in roots" :key="node.name"><button type="button" class="selection-row warehouse-tree-row" :class="{ selected: selected === node.name }" :style="{ paddingInlineStart: `${12 + depth(node) * 18}px` }" @click="emit('select', node.name)"><b>{{ warehousePresentation(node.name, tree).localLabel }}</b><small>{{ summaries[node.name]?.distinct_products || 0 }} 种物品<template v-if="summaries[node.name]?.quantities?.length"> · {{ summaries[node.name].quantities.map((value: any) => `${value.qty} ${value.uom}`).join(' · ') }}</template></small></button><WarehouseTree v-if="children(node).length" :nodes="children(node)" :tree="tree" :selected="selected" :summaries="summaries" @select="emit('select', $event)" /></li></ul>
</template>
