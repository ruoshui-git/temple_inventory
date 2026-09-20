<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'

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
function scheduleHover() {
  cancelHover()
  timer = setTimeout(() => show(true), 280)
}
function leave() {
  cancelHover()
  if (!pinned.value) open.value = false
}
function close(restore = true) {
  cancelHover()
  open.value = false
  pinned.value = false
  if (restore) void nextTick(() => button.value?.focus())
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation()
    close()
  }
}
onBeforeUnmount(cancelHover)
</script>

<template>
  <span v-if="props.src" class="image-preview" @mouseleave="leave" @keydown="keydown">
    <button ref="button" type="button" class="image-thumb-button" :aria-label="'预览' + alt" :aria-expanded="open" @mouseenter="scheduleHover" @focus="show(false)" @click="show(false)">
      <img :src="src" :alt="alt" loading="lazy" width="52" height="52">
    </button>
    <span v-if="open" ref="popover" class="image-popover" role="dialog" :aria-label="alt" :style="popoverStyle" @mouseenter="cancelHover">
      <img :src="src" :alt="alt">
      <button type="button" aria-label="关闭图片预览" @click="close()">关闭</button>
    </span>
  </span>
</template>
