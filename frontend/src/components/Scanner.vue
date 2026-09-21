<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ScannerService, cameraError, type ScannerEngineId } from '../lib/scanner'
import { sessionExpired } from '../lib/api'

const props = defineProps<{ paused?: boolean }>()
const emit = defineEmits<{ scan: [value: string]; close: [] }>()
const area = ref<HTMLElement>(), error = ref(''), manual = ref(''), starting = ref(false)
const engineId = ref<ScannerEngineId>('frappe')
const engineLabel = ref('Frappe 内置')
const service = new ScannerService()
let disposed = false, last = '', lastTime = 0

function decoded(value: string) {
  value = value.trim()
  if (!value || props.paused || sessionExpired.value || disposed) return
  if (value === last && Date.now() - lastTime < 2000) return
  last = value; lastTime = Date.now(); emit('scan', value); manual.value = ''
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
function close() { disposed = true; void stop(); emit('close') }
watch(() => props.paused, paused => { if (paused) void stop(); else void start() })
watch(sessionExpired, expired => { if (expired) void stop(); else void start() })
onMounted(() => { engineId.value = service.engineId; engineLabel.value = service.engineLabel; void start() })
onBeforeUnmount(() => { disposed = true; void stop() })
</script>
<template>
  <section class="scanner-panel" aria-label="条码扫描">
    <div class="toolbar"><b>连续扫码</b><button @click="close">关闭相机</button></div>
    <div class="scanner-engine"><span>扫描引擎：{{ engineLabel }}</span><button :disabled="starting" @click="switchEngine">切换到 {{ engineId === 'frappe' ? 'ZXing-WASM' : 'Frappe 内置' }}</button></div>
    <div ref="area" class="scanner-camera"></div>
    <p v-if="paused" role="status">请确认数量与位置后继续扫描</p>
    <p v-if="starting">正在打开相机…</p><p v-if="error" class="error">{{ error }}</p>
    <button v-if="error" :disabled="starting" @click="start">重试相机</button>
    <form @submit.prevent="decoded(manual)"><label>条码 / 编号 / 扫码枪<input v-model="manual" :disabled="paused" placeholder="输入后按回车" autocomplete="off"></label><button :disabled="paused">查找</button></form>
  </section>
</template>
