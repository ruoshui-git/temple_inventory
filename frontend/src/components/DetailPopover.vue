<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
defineProps<{ label: string; triggerText?: string }>()
const open = ref(false)
function close(event?: Event) { if (!event || !(event.target as Element)?.closest('.detail-popover')) open.value = false }
function escape(event: KeyboardEvent) { if (event.key === 'Escape') open.value = false }
onMounted(() => { document.addEventListener('click', close); document.addEventListener('keydown', escape) })
onBeforeUnmount(() => { document.removeEventListener('click', close); document.removeEventListener('keydown', escape) })
</script>
<template><span class="detail-popover" @mouseenter="open = true" @mouseleave="open = false" @focusin="open = true" @focusout="open = false"><button type="button" class="detail-popover-trigger" :aria-expanded="open" :aria-label="label" @click.stop="open = !open" @keydown.stop>{{ triggerText || label }}</button><span v-if="open" class="detail-popover-content" role="region" :aria-label="label"><slot /></span></span></template>
