<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ src?: string; alt: string }>()
const open = ref(false)
const pinned = ref(false)
const button = ref<HTMLButtonElement | null>(null)
const popover = ref<HTMLElement | null>(null)
const popoverStyle = ref<Record<string, string>>({})
let timer: ReturnType<typeof setTimeout> | undefined

function cancelHover() {
  if (timer) clearTimeout(timer)
  timer = undefined
}
function show(fromHover = false) {
  cancelHover()
  open.value = true
  if (!fromHover) pinned.value = true
  void nextTick(positionPreview)
}
function toggle() {
  if (open.value && pinned.value) close()
  else show(false)
}
function positionPreview() {
  if (!button.value || !popover.value || window.innerWidth <= 600) return
  const rect = button.value.getBoundingClientRect()
  const width = Math.min(280, window.innerWidth - 24)
  const height = Math.min(300, window.innerHeight - 24)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  const below = rect.bottom + 8
  const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 8)
  popoverStyle.value = { left: left + 'px', top: top + 'px', maxWidth: width + 'px' }
}
function isInsideHoverRegion(event: PointerEvent) {
  if (!button.value || !popover.value) return false
  const anchor = button.value.getBoundingClientRect()
  const panel = popover.value.getBoundingClientRect()
  const padding = 12
  return event.clientX >= Math.min(anchor.left, panel.left) - padding
    && event.clientX <= Math.max(anchor.right, panel.right) + padding
    && event.clientY >= Math.min(anchor.top, panel.top) - padding
    && event.clientY <= Math.max(anchor.bottom, panel.bottom) + padding
}
function trackPointer(event: PointerEvent) {
  if (!open.value || pinned.value) return
  if (isInsideHoverRegion(event)) cancelHover()
  else scheduleDismiss()
}
function scheduleHover() {
  cancelHover()
  timer = setTimeout(() => show(true), 280)
}
function scheduleDismiss() {
  cancelHover()
  if (!pinned.value) timer = setTimeout(close, 160)
}
function close() {
  cancelHover()
  open.value = false
  pinned.value = false
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation()
    close()
  }
}
function outsidePress(event: PointerEvent) {
  const target = event.target as Node | null
  if (target && (button.value?.contains(target) || popover.value?.contains(target))) return
  close()
}
function refreshPosition() {
  if (open.value) positionPreview()
}
onMounted(() => {
  document.addEventListener('pointermove', trackPointer)
  document.addEventListener('pointerdown', outsidePress)
  document.addEventListener('keydown', keydown)
  window.addEventListener('resize', refreshPosition)
  window.addEventListener('scroll', refreshPosition, true)
})
onBeforeUnmount(() => {
  cancelHover()
  document.removeEventListener('pointermove', trackPointer)
  document.removeEventListener('pointerdown', outsidePress)
  document.removeEventListener('keydown', keydown)
  window.removeEventListener('resize', refreshPosition)
  window.removeEventListener('scroll', refreshPosition, true)
})
</script>

<template>
  <span v-if="props.src" class="image-preview" @keydown="keydown">
    <button ref="button" type="button" class="image-thumb-button" :aria-label="'预览' + alt" :aria-expanded="open" @mouseenter="scheduleHover" @mouseleave="scheduleDismiss" @focus="show(true)" @focusout="scheduleDismiss" @click="toggle">
      <img :src="src" :alt="alt" loading="lazy" width="52" height="52">
    </button>
    <span v-if="open" class="image-preview-backdrop" @click.self="close">
      <span ref="popover" class="image-popover" role="dialog" :aria-label="alt" :style="popoverStyle" @mouseenter="cancelHover" @mouseleave="scheduleDismiss">
        <img :src="src" :alt="alt">
      </span>
    </span>
  </span>
</template>
