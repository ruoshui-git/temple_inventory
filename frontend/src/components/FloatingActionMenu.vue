<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ actions: { kind: string; label: string }[]; label?: string }>(), { label: '新建操作' })
const emit = defineEmits<{ select: [kind: string] }>()
const open = ref(false)
const trigger = ref<HTMLButtonElement>()
function close() { open.value = false }
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') { close(); void trigger.value?.focus() } }
function onPointerdown(event: PointerEvent) { if (!(event.target instanceof Node) || !((event.currentTarget as Document).querySelector('.floating-action-menu') as HTMLElement)?.contains(event.target)) close() }
function choose(kind: string) { close(); emit('select', kind) }
onMounted(() => { document.addEventListener('keydown', onKeydown); document.addEventListener('pointerdown', onPointerdown) })
onBeforeUnmount(() => { document.removeEventListener('keydown', onKeydown); document.removeEventListener('pointerdown', onPointerdown) })
</script>

<template>
  <div class="floating-action-menu">
    <div v-if="open" class="floating-actions" role="menu" :aria-label="label">
      <button v-for="action in props.actions" :key="action.kind" type="button" role="menuitem" @click="choose(action.kind)">{{ action.label }}</button>
    </div>
    <button ref="trigger" type="button" class="action-fab" :aria-expanded="open" :aria-label="label" @click="open = !open">＋</button>
  </div>
</template>
