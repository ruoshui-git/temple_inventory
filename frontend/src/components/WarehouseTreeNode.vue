<script setup lang="ts">
import { computed, ref } from 'vue'
import { warehouseLabel } from '../lib/api'
type Node = { name:string; warehouse_name?:string; parent_warehouse?:string; is_group?:number|boolean; lft?:number; rgt?:number; warehouse_type?:string }
const props=defineProps<{node:Node;nodes:Node[];modelValue:string[];tree:Node[]}>(); const emit=defineEmits<{ 'update:modelValue':[value:string[]] }>(); const expanded=ref(false)
const children=computed(()=>props.nodes.filter(child=>child.parent_warehouse===props.node.name)); const descendants=()=>props.nodes.filter(child=>(child.lft||0)>=(props.node.lft||0)&&(child.rgt||0)<=(props.node.rgt||0)&&child.name!==props.node.name)
function checked(){const leaves=props.node.is_group?descendants().filter(n=>!n.is_group).map(n=>n.name):[props.node.name];return leaves.length>0&&leaves.every(v=>props.modelValue.includes(v)||props.modelValue.includes(props.node.name))}
function indeterminate(){if(!props.node.is_group)return false;const leaves=descendants().filter(n=>!n.is_group).map(n=>n.name);const selected=leaves.filter(v=>props.modelValue.includes(v)||props.modelValue.includes(props.node.name)).length;return selected>0&&selected<leaves.length}
function toggle(){const next=new Set(props.modelValue);if(props.node.is_group){if(checked())next.delete(props.node.name);else next.add(props.node.name);for(const child of descendants().filter(n=>!n.is_group))next.delete(child.name)}else next.has(props.node.name)?next.delete(props.node.name):next.add(props.node.name);emit('update:modelValue',[...next])}
function update(value:string[]){emit('update:modelValue',value)}
</script>
<template><li><div class="tree-row"><button v-if="children.length" type="button" class="tree-toggle" :aria-expanded="expanded" :aria-label="`${expanded?'收起':'展开'} ${node.warehouse_name||node.name}`" @click="expanded=!expanded">{{expanded?'−':'+'}}</button><span v-else class="tree-spacer"/><label><input type="checkbox" :checked="checked()" :indeterminate="indeterminate()" @change="toggle"><span>{{warehouseLabel(node.name,tree)}}</span><small v-if="node.is_group">分组</small></label></div><ul v-if="expanded&&children.length" class="tree-children"><WarehouseTreeNode v-for="child in children" :key="child.name" :node="child" :nodes="nodes" :tree="tree" :model-value="modelValue" @update:model-value="update"/></ul></li></template>
