<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ open?: boolean; count?: number; title?: string }>(), {
  open: false,
  count: 0,
  title: '筛选',
})
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const invoker = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const titleId = 'filter-title-' + Math.random().toString(36).slice(2)
const drawerTitleId = titleId + '-drawer'

function close() {
  emit('update:open', false)
  void nextTick(() => invoker.value?.focus())
}
function openPanel(event?: Event) {
  if (event?.currentTarget instanceof HTMLElement) invoker.value = event.currentTarget
  emit('update:open', true)
}
function keydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab' || !panel.value) return
  const focusable = Array.from(panel.value.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(node => !node.hasAttribute('disabled'))
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
watch(() => props.open, async value => {
  if (value) {
    // Pages may use their own visible mobile trigger so the sidebar trigger
    // can stay out of the desktop grid. Preserve that trigger for close.
    if (!invoker.value && document.activeElement instanceof HTMLElement) invoker.value = document.activeElement
    await nextTick()
    panel.value?.querySelector<HTMLElement>('button,input,select,textarea,[tabindex="0"]')?.focus()
  }
})
onMounted(() => window.addEventListener('keydown', keydown))
onBeforeUnmount(() => window.removeEventListener('keydown', keydown))
defineExpose({ openPanel, close })
</script>

<template>
  <button type="button" class="filter-trigger" @click="openPanel($event)">筛选<span v-if="count" class="filter-count">{{ count }}</span></button>
  <aside class="filter-sidebar" :aria-labelledby="titleId"><h2 :id="titleId">{{ title }}</h2><slot /></aside>
  <div v-if="open" class="filter-drawer-backdrop" @click.self="close">
    <aside ref="panel" class="filter-drawer" role="dialog" aria-modal="true" :aria-labelledby="drawerTitleId" @keydown="keydown">
      <header><h2 :id="drawerTitleId">{{ title }}</h2><button type="button" aria-label="关闭筛选" @click="close">×</button></header>
      <slot />
      <button type="button" class="primary filter-done" @click="close">完成</button>
    </aside>
  </div>
</template>
