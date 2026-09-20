import { reactive } from 'vue'

export type ToastKind = 'success' | 'warning' | 'error'
export type Toast = { id: number; message: string; kind: ToastKind; duration: number; created: number }
export const toasts = reactive<Toast[]>([])
let nextId = 0
const timers = new Map<number, number>()

function schedule(item: Toast) {
  const remaining = Math.max(0, item.duration - (Date.now() - item.created))
  timers.set(item.id, window.setTimeout(() => dismissToast(item.id), remaining))
}

export function toast(message: string, kind: ToastKind = 'success') {
  const clean = String(message || '').trim()
  if (!clean || toasts.some(item => item.message === clean && item.kind === kind)) return
  const duration = kind === 'error' ? 8000 : kind === 'warning' ? 6000 : 4000
  const item = { id: ++nextId, message: clean, kind, duration, created: Date.now() }
  toasts.push(item)
  schedule(item)
}

export function dismissToast(id: number) {
	if (timers.has(id)) window.clearTimeout(timers.get(id))
	timers.delete(id)
  const index = toasts.findIndex(item => item.id === id)
  if (index >= 0) toasts.splice(index, 1)
}

export function pauseToast(item: Toast) {
	const timer = timers.get(item.id)
	if (timer) window.clearTimeout(timer)
	timers.delete(item.id)
	item.duration = Math.max(0, item.duration - (Date.now() - item.created))
}

export function resumeToast(item: Toast) {
	if (!timers.has(item.id)) { item.created = Date.now(); schedule(item) }
}
