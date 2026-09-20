<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

type Node = { name: string; label?: string; parent?: string; parent_warehouse?: string; parent_item_group?: string; is_group?: number | boolean; lft?: number; rgt?: number }
const props = withDefaults(defineProps<{ modelValue: string[]; options: Node[]; placeholder: string; title: string; tree?: Node[] }>(), { tree: () => [] })
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const open = ref(false)
const term = ref('')
const input = ref<HTMLInputElement>()
const expanded = ref(new Set<string>())
const nodes = computed(() => [...props.options].sort((a, b) => Number(a.lft || 0) - Number(b.lft || 0)))
const parentOf = (node: Node) => node.parent || node.parent_warehouse || node.parent_item_group || ''
const allNodes = computed(() => props.tree.length ? props.tree : nodes.value)
const byName = computed(() => new Map(allNodes.value.map(node => [node.name, node])))
const roots = computed(() => nodes.value.filter(node => !nodes.value.some(parent => parent.name === parentOf(node))))
const children = (node: Node) => nodes.value.filter(child => parentOf(child) === node.name)
const descendants = (node: Node) => nodes.value.filter(child => child.name !== node.name && Number(child.lft) >= Number(node.lft) && Number(child.rgt) <= Number(node.rgt))
const leaves = (node: Node) => node.is_group ? descendants(node).filter(child => !child.is_group) : [node]
const normalize = (value: string) => value.toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim()
const path = (node: Node) => { const values = [node.label || node.name]; let parent = byName.value.get(parentOf(node)); const seen = new Set<string>(); while (parent && !seen.has(parent.name)) { seen.add(parent.name); values.unshift(parent.label || parent.name); parent = byName.value.get(parentOf(parent)) } return values.join(' / ') }
const matches = (node: Node) => !term.value || normalize(`${node.name} ${node.label || ''} ${path(node)} 未指定`).includes(normalize(term.value))
const visible = (node: Node) => matches(node) || descendants(node).some(matches)
function depth(node: Node) {
  let total = 0, parent = byName.value.get(parentOf(node)), seen = new Set<string>()
  while (parent && !seen.has(parent.name)) { seen.add(parent.name); total++; parent = byName.value.get(parentOf(parent)) }
  return total
}
function ancestorsExpanded(node: Node) {
  if (term.value) return true
  let parent = byName.value.get(parentOf(node)), seen = new Set<string>()
  while (parent && !seen.has(parent.name)) {
    if (!expanded.value.has(parent.name)) return false
    seen.add(parent.name); parent = byName.value.get(parentOf(parent))
  }
  return true
}
const displayNodes = computed(() => nodes.value.filter(node => visible(node) && ancestorsExpanded(node)))
const selected = (node: Node) => props.modelValue.includes(node.name) || props.modelValue.some(value => { const parent = byName.value.get(value); return !!parent?.is_group && Number(node.lft) > Number(parent.lft) && Number(node.rgt) < Number(parent.rgt) })
const partial = (node: Node) => Boolean(node.is_group && leaves(node).some(selected) && !leaves(node).every(selected))
function toggle(node: Node) {
  const next = new Set(props.modelValue)
  if (node.is_group) {
    if (leaves(node).every(selected)) { next.delete(node.name); for (const leaf of leaves(node)) next.delete(leaf.name) }
    else { next.add(node.name); for (const leaf of leaves(node)) next.delete(leaf.name) }
  } else {
    const covering = allNodes.value.filter(parent => parent.is_group && next.has(parent.name) && Number(node.lft) > Number(parent.lft) && Number(node.rgt) < Number(parent.rgt))
    if (covering.length) {
      // Excluding one child from an explicit parent expands the parent to its
      // remaining leaves. This is the non-inverting parent/child behavior.
      for (const parent of covering) { next.delete(parent.name); for (const leaf of leaves(parent)) if (leaf.name !== node.name) next.add(leaf.name) }
    } else if (next.has(node.name)) next.delete(node.name)
    else next.add(node.name)
  }
  // A parent makes its explicit descendants redundant.
  for (const value of [...next]) { const candidate = byName.value.get(value); if (candidate && [...next].some(parentName => parentName !== value && byName.value.get(parentName)?.is_group && Number(candidate.lft) > Number(byName.value.get(parentName)?.lft) && Number(candidate.rgt) < Number(byName.value.get(parentName)?.rgt))) next.delete(value) }
  emit('update:modelValue', [...next])
}
function clear() { emit('update:modelValue', []) }
function remove(name: string) { emit('update:modelValue', props.modelValue.filter(value => value !== name)) }
function activate() { open.value = true; void nextTick(() => input.value?.focus()) }
</script>

<template>
  <section class="hierarchy-facet">
    <header><h3>{{ title }}</h3><span>{{ modelValue.length }} 项已选</span><button type="button" class="inline-link" :disabled="!modelValue.length" @click="clear">清除本项</button></header>
    <div v-if="modelValue.length" class="facet-chips"><button v-for="name in modelValue" :key="name" type="button" @click="remove(name)">{{ path(byName.get(name) || { name }) }} ×</button></div>
    <div class="facet-input"><input ref="input" v-model="term" type="search" :placeholder="placeholder" :aria-label="title" @focus="open = true" @click="open = true" @keydown.esc="open = false"><button type="button" aria-label="浏览选项" @click="activate">⌄</button></div>
    <div v-if="open" class="facet-suggestions" role="listbox" :aria-label="`${title}建议`">
      <p v-if="!nodes.length" class="field-hint">暂无可选项目</p>
      <p v-else-if="!roots.some(visible)" class="field-hint">没有匹配的项目</p>
      <ul v-else class="hierarchy-list"><li v-for="node in displayNodes" :key="node.name"><div class="hierarchy-row" :style="{ paddingInlineStart: `${0.3 + depth(node) * 1.5}rem` }"><button v-if="children(node).length" type="button" class="tree-toggle" :aria-expanded="expanded.has(node.name) || !!term" @click="expanded.has(node.name) ? expanded.delete(node.name) : expanded.add(node.name)">{{ expanded.has(node.name) || term ? '−' : '+' }}</button><span v-else class="tree-spacer"></span><label><input type="checkbox" :checked="!!(node.is_group ? leaves(node).every(selected) : selected(node))" :indeterminate="partial(node)" @change="toggle(node)"><span>{{ node.label || node.name }}</span></label></div></li></ul>
    </div>
  </section>
</template>
