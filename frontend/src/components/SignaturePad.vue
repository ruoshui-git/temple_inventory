<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
const props = defineProps<{ modelValue: string; disabled?: boolean; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; complete: []; start: [] }>()
const canvas = ref<HTMLCanvasElement>(); let drawing = false
function paint() { const c = canvas.value?.getContext('2d'); if (!c || !canvas.value) return; c.clearRect(0,0,800,240); if (props.modelValue) { const image = new Image(); image.onload = () => c.drawImage(image,0,0,800,240); image.src = props.modelValue } }
function point(e: PointerEvent) { const r = canvas.value!.getBoundingClientRect(); return [(e.clientX-r.left)*800/r.width, (e.clientY-r.top)*240/r.height] as const }
function begin(e: PointerEvent) { if (props.disabled) return; emit('start'); drawing = true; canvas.value!.setPointerCapture(e.pointerId); const c = canvas.value!.getContext('2d')!; c.beginPath(); c.lineWidth = 3; c.lineCap = 'round'; c.moveTo(...point(e)) }
function move(e: PointerEvent) { if (!drawing) return; const c = canvas.value!.getContext('2d')!; c.lineTo(...point(e)); c.stroke() }
function end() { if (!drawing) return; drawing = false; emit('update:modelValue', canvas.value!.toDataURL('image/png')); emit('complete') }
function clear() { emit('update:modelValue',''); emit('complete') }
onMounted(paint); watch(() => props.modelValue, paint)
</script>
<template><div class="signature"><label>{{ props.label || '经手人签名' }} <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span></label><canvas ref="canvas" width="800" height="240" :aria-label="`${props.label || '签名'}输入区域`" role="application" tabindex="0" @pointerdown="begin" @pointermove="move" @pointerup="end" @pointercancel="end"/><button v-if="!disabled" @click="clear">清除签名</button></div></template>
