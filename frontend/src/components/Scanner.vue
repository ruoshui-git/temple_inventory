<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { loadScanner, cameraError } from '../lib/scanner'
import { sessionExpired } from '../lib/api'
const props = defineProps<{ paused?: boolean }>()
const emit = defineEmits<{ scan: [value: string]; close: [] }>()
const area = ref<HTMLElement>(), error = ref(''), manual = ref(''), starting = ref(false)
let scanner: any, disposed = false, startPromise: Promise<any> | undefined, last = '', lastTime = 0
function decoded(value: string) {
  value = value.trim()
  if (!value || props.paused || sessionExpired.value || disposed) return
  if (value === last && Date.now() - lastTime < 2000) return
  last = value; lastTime = Date.now(); emit('scan', value); manual.value = ''
}
async function start() {
  if (starting.value || scanner || disposed) return
  if (!window.isSecureContext || !navigator.mediaDevices) { error.value = '相机需要 HTTPS 或 localhost。请使用安全网址，或手动输入。'; return }
  starting.value = true; error.value = ''
  try {
    const Scanner = await loadScanner()
    if (disposed) return
    scanner = new Scanner({ container: area.value, multiple: true, on_scan: (r: any) => decoded(r.decodedText) })
    // Framework Scanner swallows camera start errors. Observe its handler promise
    // while leaving all camera configuration and decoding in the built-in scanner.
    const handler = new (window as any).Html5Qrcode(scanner.scan_area_id)
    const original = handler.start.bind(handler)
    handler.start = (...args: any[]) => {
      startPromise = original(...args)
      startPromise!.catch((e: any) => { error.value = cameraError(e) })
      return startPromise
    }
    scanner.handler = handler
    scanner.start_scan()
    await startPromise
    if (disposed) await stop()
  } catch (e) { error.value = cameraError(e); scanner = undefined }
  finally { starting.value = false }
}
async function stop() {
  const active = scanner; scanner = undefined
  if (!active) return
  try { await startPromise; if (active.handler?.isScanning) await active.handler.stop(); active.handler?.clear() } catch { /* failed startup has no stream */ }
}
function close() { disposed = true; void stop(); emit('close') }
watch(sessionExpired, expired => { if (expired) void stop() })
onMounted(start)
onBeforeUnmount(() => { disposed = true; void stop() })
</script>
<template>
  <section class="scanner-panel" aria-label="条码扫描">
    <div class="toolbar"><b>连续扫码</b><button @click="close">关闭相机</button></div>
    <div ref="area" class="scanner-camera"></div>
    <p v-if="paused" role="status">请确认数量与位置后继续扫描</p>
    <p v-if="starting">正在打开相机…</p><p v-if="error" class="error">{{ error }}</p>
    <button v-if="error" @click="start">重试相机</button>
    <form @submit.prevent="decoded(manual)"><label>条码 / 编号 / 扫码枪<input v-model="manual" :disabled="paused" placeholder="输入后按回车" autocomplete="off"></label><button :disabled="paused">查找</button></form>
  </section>
</template>
