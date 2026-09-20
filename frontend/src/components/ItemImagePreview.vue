<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{ src?: string; alt: string }>(); const open = ref(false), button = ref<HTMLButtonElement | null>(null); let timer: number | undefined
function show() { open.value = true }; function hover() { timer = window.setTimeout(show, 280) }; function leave() { if (timer) window.clearTimeout(timer); timer = undefined }; function close() { open.value = false; leave(); button.value?.focus() }; function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && open.value) close() }
</script>
<template><span v-if="src" class="image-preview" @mouseleave="leave" @keydown="keydown"><button ref="button" type="button" class="image-thumb-button" :aria-label="`预览${alt}`" @mouseenter="hover" @focus="show" @click="show"><img :src="src" :alt="alt" loading="lazy" width="52" height="52"></button><span v-if="open" class="image-popover" role="dialog" :aria-label="alt"><img :src="src" :alt="alt"><button type="button" aria-label="关闭图片预览" @click="close">关闭</button></span></span></template>
