<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props = withDefaults(defineProps<{ open?: boolean; count?: number; title?: string }>(), { open: false, count: 0, title: '筛选' })
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const invoker = ref<HTMLElement | null>(null), panel = ref<HTMLElement | null>(null)
function close() { emit('update:open', false); nextTick(() => invoker.value?.focus()) }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && props.open) close() }
function openPanel(event?: Event) { if (event?.currentTarget instanceof HTMLElement) invoker.value = event.currentTarget; emit('update:open', true) }
watch(() => props.open, async value => { if (value) { await nextTick(); panel.value?.querySelector<HTMLElement>('button,input,[tabindex="0"]')?.focus() } })
onMounted(() => window.addEventListener('keydown', keydown)); onBeforeUnmount(() => window.removeEventListener('keydown', keydown))
defineExpose({ openPanel, close })
</script>
<template><button type="button" class="filter-trigger" @click="openPanel($event)">筛选<span v-if="count" class="filter-count">{{ count }}</span></button><aside class="filter-sidebar" aria-label="筛选条件"><h2>{{ title }}</h2><slot /></aside><div v-if="open" class="filter-drawer-backdrop" @click.self="close"><aside ref="panel" class="filter-drawer" role="dialog" aria-modal="true" :aria-label="title"><header><h2>{{ title }}</h2><button type="button" aria-label="关闭筛选" @click="close">×</button></header><slot /><button type="button" class="primary filter-done" @click="close">完成</button></aside></div></template>
