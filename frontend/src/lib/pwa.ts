import { computed, ref } from 'vue'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const updateAvailable = ref(false)
const installEvent = ref<InstallPromptEvent | null>(null)
const standalone = ref(false)
let registration: ServiceWorkerRegistration | undefined
let registered = false
let reloading = false

export type InstallPlatform = 'ios' | 'android' | 'other'

export function detectInstallPlatform(userAgent: string, platform: string, maxTouchPoints: number): InstallPlatform {
  if (/iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'other'
}

export function installInstructions(platform: InstallPlatform) {
  if (platform === 'ios') return '请在 Safari 中点击分享按钮，再选择「添加到主屏幕」，然后点击「添加」。'
  if (platform === 'android') return '请在 Chrome 中打开右上角菜单，选择「安装应用」或「添加到主屏幕」。'
  return '请打开浏览器菜单，寻找「安装应用」或「添加到主屏幕」。'
}

function detectStandalone() {
  standalone.value = (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export const isStandalone = computed(() => standalone.value)
export const canInstall = computed(() => !!installEvent.value && !standalone.value)

if (typeof window !== 'undefined') {
  detectStandalone()
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    installEvent.value = event as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    installEvent.value = null
    detectStandalone()
  })
}

export async function installPwa() {
  const event = installEvent.value
  if (!event) return false
  await event.prompt()
  await event.userChoice.catch(() => undefined)
  installEvent.value = null
  return true
}

function showUpdateIfReady(worker: ServiceWorker | null, controller: ServiceWorker | null) {
  if (worker?.state === 'installed' && controller) updateAvailable.value = true
}

export async function registerPwa() {
  if (registered || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  registered = true
  try {
    registration = await navigator.serviceWorker.register('/temple-inventory-sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
    if (registration.waiting && navigator.serviceWorker.controller) updateAvailable.value = true
    registration.addEventListener('updatefound', () => {
      const worker = registration?.installing
      worker?.addEventListener('statechange', () => showUpdateIfReady(worker, navigator.serviceWorker.controller))
    })
    void registration.update().catch(() => undefined)
    const check = () => { if (document.visibilityState === 'visible') void registration?.update().catch(() => undefined) }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
  } catch (error) {
    registered = false
    console.warn('PWA registration failed', error)
  }
}

export function applyUpdate() {
  const waiting = registration?.waiting
  if (!waiting) return
  const reload = () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
  waiting.postMessage({ type: 'SKIP_WAITING' })
}
