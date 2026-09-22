<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ScannerService, cameraError, type ScannerEngineId } from '../lib/scanner'
import { sessionExpired } from '../lib/api'

export type ScannerPresentation = 'inline' | 'modal' | 'continuous'

const props = withDefaults(defineProps<{ paused?: boolean; presentation?: ScannerPresentation }>(), { presentation: 'inline' })
const emit = defineEmits<{ scan: [value: string]; close: [] }>()
const area = ref<HTMLElement>(), panel = ref<HTMLElement>(), closeButton = ref<HTMLButtonElement>(), error = ref(''), manual = ref(''), starting = ref(false)
const engineId = ref<ScannerEngineId>('frappe')
const engineLabel = ref('Frappe 内置')
const service = new ScannerService()
const titleId = `scanner-title-${Math.random().toString(36).slice(2)}`
let disposed = false, last = '', lastTime = 0, opener: HTMLElement | null = null, previousOverflow = ''
let continuousLayout: MediaQueryList | undefined

function decoded(value: string) {
  value = value.trim()
  if (!value || props.paused || sessionExpired.value || disposed) return
  if (value === last && Date.now() - lastTime < 2000) return
  last = value; lastTime = Date.now(); emit('scan', value); manual.value = ''
}
function focusables() {
  return panel.value ? Array.from(panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')) : []
}
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const elements = focusables()
  if (!elements.length) return
  const current = elements.indexOf(document.activeElement as HTMLElement)
  if (event.shiftKey && current <= 0) { event.preventDefault(); elements[elements.length - 1].focus() }
  else if (!event.shiftKey && current === elements.length - 1) { event.preventDefault(); elements[0].focus() }
}
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape' && props.presentation === 'modal') close() }
function restoreFocus() { void nextTick(() => opener?.focus()) }
function keepScannerVisible() { panel.value?.scrollIntoView?.({ block: 'nearest' }) }
function continuousLayoutChanged(event: MediaQueryListEvent) { if (!event.matches) void nextTick(keepScannerVisible) }
function watchContinuousLayout() {
  continuousLayout?.removeEventListener('change', continuousLayoutChanged)
  continuousLayout = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1600px)') : undefined
  continuousLayout?.addEventListener('change', continuousLayoutChanged)
  void nextTick(keepScannerVisible)
}
async function start() {
  if (starting.value || disposed || props.paused || sessionExpired.value || !area.value) return
  starting.value = true; error.value = ''
  try { await service.start(area.value, decoded, e => { if (!disposed) error.value = cameraError(e) }) }
  catch (e) { if (!disposed) error.value = cameraError(e) }
  finally { starting.value = false }
}
async function stop() { await service.stop() }
async function switchEngine() {
  if (starting.value || disposed) return
  const next: ScannerEngineId = engineId.value === 'frappe' ? 'zxing-wasm' : 'frappe'
  starting.value = true; error.value = ''
  try {
    await service.selectEngine(next); engineId.value = service.engineId; engineLabel.value = service.engineLabel
    if (!props.paused && !sessionExpired.value) await service.start(area.value!, decoded, e => { if (!disposed) error.value = cameraError(e) })
  } catch (e) { if (!disposed) error.value = cameraError(e) }
  finally { starting.value = false }
}
function close() {
  disposed = true
  if (props.presentation === 'modal') {
    document.removeEventListener('keydown', onKeydown); document.body.style.overflow = previousOverflow; restoreFocus()
  }
  void stop(); emit('close')
}
watch(() => props.paused, paused => { if (paused) void stop(); else void start() })
watch(sessionExpired, expired => { if (expired) void stop(); else void start() })
onMounted(() => {
  engineId.value = service.engineId; engineLabel.value = service.engineLabel
  if (props.presentation === 'modal') {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; document.addEventListener('keydown', onKeydown)
    void nextTick(() => { closeButton.value?.focus() })
  }
  if (props.presentation === 'continuous') {
    watchContinuousLayout()
  }
  void start()
})
watch(() => props.presentation, presentation => {
  if (presentation === 'modal') {
    opener ||= document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; document.addEventListener('keydown', onKeydown)
    void nextTick(() => closeButton.value?.focus())
  } else if (props.presentation !== 'modal') {
    document.removeEventListener('keydown', onKeydown); document.body.style.overflow = previousOverflow; restoreFocus()
    if (presentation === 'continuous') watchContinuousLayout()
    else { continuousLayout?.removeEventListener('change', continuousLayoutChanged); continuousLayout = undefined }
  }
})
onBeforeUnmount(() => { disposed = true; document.removeEventListener('keydown', onKeydown); continuousLayout?.removeEventListener('change', continuousLayoutChanged); if (props.presentation === 'modal') document.body.style.overflow = previousOverflow; void stop(); restoreFocus() })
</script>
<template>
  <Teleport v-if="presentation === 'modal'" to="body">
    <div class="scanner-modal-backdrop" @click.self="close">
      <section ref="panel" class="scanner-panel scanner-modal" role="dialog" aria-modal="true" :aria-labelledby="titleId" @keydown="trapFocus">
        <div class="toolbar"><h2 :id="titleId">扫描条码</h2><button ref="closeButton" type="button" @click="close">关闭相机</button></div>
        <div class="scanner-engine"><span>扫描引擎：{{ engineLabel }}</span><button type="button" :disabled="starting" @click="switchEngine">切换到 {{ engineId === 'frappe' ? 'ZXing-WASM' : 'Frappe 内置' }}</button></div>
        <div ref="area" class="scanner-camera"></div>
        <p v-if="paused" role="status">请确认数量与位置后继续扫描</p>
        <p v-if="starting">正在打开相机…</p><p v-if="error" class="error">{{ error }}</p>
        <button v-if="error" type="button" :disabled="starting" @click="start">重试相机</button>
        <form @submit.prevent="decoded(manual)"><label>条码 / 编号 / 扫码枪<input v-model="manual" :disabled="paused" placeholder="输入后按回车" autocomplete="off"></label><button type="submit" :disabled="paused">查找</button></form>
      </section>
    </div>
  </Teleport>
  <section v-else ref="panel" class="scanner-panel" :class="{ 'scanner-continuous': presentation === 'continuous' }" aria-label="条码扫描">
    <div class="toolbar"><b>连续扫码</b><button type="button" @click="close">关闭相机</button></div>
    <div class="scanner-engine"><span>扫描引擎：{{ engineLabel }}</span><button :disabled="starting" @click="switchEngine">切换到 {{ engineId === 'frappe' ? 'ZXing-WASM' : 'Frappe 内置' }}</button></div>
    <div ref="area" class="scanner-camera"></div>
    <p v-if="paused" role="status">请确认数量与位置后继续扫描</p>
    <p v-if="starting">正在打开相机…</p><p v-if="error" class="error">{{ error }}</p>
    <button v-if="error" :disabled="starting" @click="start">重试相机</button>
    <form @submit.prevent="decoded(manual)"><label>条码 / 编号 / 扫码枪<input v-model="manual" :disabled="paused" placeholder="输入后按回车" autocomplete="off"></label><button :disabled="paused">查找</button></form>
  </section>
</template>

<style scoped>
.scanner-modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 16px; background: #17203388; overflow: auto }
.scanner-modal { width: min(560px, 100%); max-height: calc(100dvh - 32px); overflow: auto; margin: 0 }
.scanner-modal h2 { margin: 0; font-size: 20px }
.scanner-continuous { position: relative }
@media (min-width: 1600px) {
  .scanner-continuous { position: fixed; z-index: 15; top: 96px; left: calc(50% + 400px); width: min(360px, calc(50vw - 416px)); max-height: calc(100dvh - 120px); overflow: auto }
}
</style>
