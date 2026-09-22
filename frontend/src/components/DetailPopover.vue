<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ label: string; triggerText?: string }>()

const open = ref(false)
const pinned = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
let dismissTimer: ReturnType<typeof setTimeout> | undefined

function cancelDismiss() {
  if (dismissTimer) clearTimeout(dismissTimer)
  dismissTimer = undefined
}

function positionPanel() {
  if (!trigger.value || !panel.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const bounds = panel.value.getBoundingClientRect()
  const gutter = 10
  const viewportPadding = 12
  const left = Math.max(
    viewportPadding,
    Math.min(anchor.left + anchor.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - viewportPadding),
  )
  const above = anchor.top - bounds.height - gutter
  const top = above >= viewportPadding
    ? above
    : Math.min(anchor.bottom + gutter, window.innerHeight - bounds.height - viewportPadding)
  panelStyle.value = { left: `${left}px`, top: `${Math.max(viewportPadding, top)}px` }
}

function show(pin = false) {
  cancelDismiss()
  if (pin) pinned.value = true
  open.value = true
  void nextTick(positionPanel)
}

function hide() {
  cancelDismiss()
  open.value = false
  pinned.value = false
}

function scheduleDismiss() {
  cancelDismiss()
  if (!pinned.value) dismissTimer = setTimeout(hide, 120)
}

function toggle() {
  if (open.value && pinned.value) hide()
  else show(true)
}

function handleDocumentPointer(event: Event) {
  const target = event.target as Node | null
  if (target && (trigger.value?.contains(target) || panel.value?.contains(target))) return
  hide()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation()
    hide()
  }
}

function handleViewportChange() {
  if (open.value) positionPanel()
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointer)
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})

onBeforeUnmount(() => {
  cancelDismiss()
  document.removeEventListener('pointerdown', handleDocumentPointer)
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})
</script>

<template>
  <span class="detail-popover">
    <button
      ref="trigger"
      type="button"
      class="detail-popover-trigger"
      :aria-expanded="open"
      :aria-label="label"
      @mouseenter="show()"
      @mouseleave="scheduleDismiss"
      @focus="show()"
      @blur="scheduleDismiss"
      @click.stop="toggle"
    >{{ triggerText || label }}</button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="detail-popover-content"
        role="tooltip"
        :aria-label="label"
        :style="panelStyle"
        @mouseenter="cancelDismiss"
        @mouseleave="scheduleDismiss"
      ><slot /></div>
    </Teleport>
  </span>
</template>
