import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

export type ScannerEngineId = 'frappe' | 'zxing-wasm'
export interface ScannerEngine { readonly id: ScannerEngineId; readonly label: string; start(container: HTMLElement, onScan: (value: string) => void, onError?: (error: unknown) => void): Promise<void>; stop(): Promise<void> }

const scripts = new Map<string, Promise<void>>()
function load(src: string) {
  if (!scripts.has(src)) scripts.set(src, new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = src
    const timer = setTimeout(() => { scripts.delete(src); script.remove(); reject(new Error('扫码组件加载超时，请重试')) }, 15000)
    script.onload = () => { clearTimeout(timer); resolve() }
    script.onerror = () => { clearTimeout(timer); scripts.delete(src); script.remove(); reject(new Error('无法加载扫码组件，请重试')) }
    document.head.append(script)
  }))
  return scripts.get(src)!
}
let loading: Promise<any> | undefined
export function loadScanner(): Promise<any> {
  return loading ||= (async () => {
    const w = window as any
    if (!w.jQuery) await load('/assets/frappe/node_modules/jquery/dist/jquery.min.js')
    if (!w.frappe?.provide) await load('/assets/frappe/js/frappe/provide.js')
    w.frappe.dom ||= {}
    w.frappe.dom.set_unique_id ||= (element: any) => { if (!element.attr('id')) element.attr('id', `scan-${crypto.randomUUID()}`); return element.attr('id') }
    w.frappe.require ||= async (paths: string | string[]) => { for (const path of [paths].flat()) await load(path) }
    if (!w.frappe.ui.Scanner) await load('/assets/frappe/js/frappe/scanner/index.js')
    await load('/assets/frappe/node_modules/html5-qrcode/html5-qrcode.min.js')
    return w.frappe.ui.Scanner
  })().catch(e => { loading = undefined; throw e })
}
export function cameraError(e: any) {
  const message = String(e?.name || e?.message || e)
  if (/NotAllowed|Permission|denied/i.test(message)) return '相机权限被拒绝，请在浏览器设置中允许使用相机。也可手动输入。'
  if (/NotFound|DevicesNotFound/i.test(message)) return '未找到相机，请使用手动输入或扫码枪。'
  if (/NotReadable|TrackStart/i.test(message)) return '相机正在被其他程序使用，请关闭后重试。'
  return `无法启动相机：${message}`
}

export class FrappeScannerEngine implements ScannerEngine {
  readonly id = 'frappe' as const; readonly label = 'Frappe 内置'
  private scanner: any; private startPromise?: Promise<any>; private container?: HTMLElement
  private generation = 0
	async start(container: HTMLElement, onScan: (value: string) => void) {
		const generation = ++this.generation
		this.container = container
		const Scanner = await loadScanner()
		if (generation !== this.generation) return
    const scanner = new Scanner({ container, multiple: true, on_scan: (result: any) => onScan(String(result?.decodedText || '')) })
    this.scanner = scanner
    const handler = new (window as any).Html5Qrcode(scanner.scan_area_id)
    const original = handler.start.bind(handler)
		handler.start = (...args: any[]) => { this.startPromise = original(...args); return this.startPromise }
		scanner.handler = handler
		try {
			const result = scanner.start_scan()
			if (!this.startPromise && result && typeof result.then === 'function') this.startPromise = result
		} catch (error) {
			this.startPromise = Promise.reject(error)
		}
		await this.startPromise
		if (generation !== this.generation) await this.stop()
	}
	async stop() {
		this.generation++
		const active = this.scanner; this.scanner = undefined
		try {
			// Do not await an unresolved startup: camera teardown must be cancellable.
			// Consume a later rejection so it cannot become an unhandled promise.
			this.startPromise?.catch(() => undefined)
			if (active?.handler?.isScanning) await active.handler.stop()
			active?.handler?.clear()
		}
    finally { this.startPromise = undefined; this.container?.replaceChildren(); this.container = undefined }
  }
}

let zxingReady: Promise<unknown> | undefined
let zxingModule: Promise<typeof import('zxing-wasm/reader')> | undefined
function loadZXing() {
  if (!zxingModule) {
    zxingModule = import('zxing-wasm/reader').catch(error => { zxingModule = undefined; throw error })
  }
  return zxingModule
}
function prepareReader() {
	return zxingReady ||= loadZXing().then(({ prepareZXingModule }) => prepareZXingModule({ fireImmediately: true, overrides: { locateFile: () => zxingWasmUrl } })).catch(error => { zxingReady = undefined; throw error })
}

export class ZxingWasmScannerEngine implements ScannerEngine {
  readonly id = 'zxing-wasm' as const; readonly label = 'ZXing-WASM'
  private video?: HTMLVideoElement; private stream?: MediaStream; private container?: HTMLElement; private startup?: Promise<void>
  private canvas?: HTMLCanvasElement; private context?: CanvasRenderingContext2D; private cancelVideoWait?: () => void
  private generation = 0; private timer?: ReturnType<typeof setTimeout>; private decoding = false; private lastDecodeError = 0
  async start(container: HTMLElement, onScan: (value: string) => void, onError?: (error: unknown) => void) {
    await this.stop(); const generation = ++this.generation; this.container = container
    this.startup = this.startInternal(container, generation, onScan, onError)
    try { await this.startup } catch (error) { this.startup = undefined; await this.stop(); throw error } finally { this.startup = undefined }
  }
  private async startInternal(container: HTMLElement, generation: number, onScan: (value: string) => void, onError?: (error: unknown) => void) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
    if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return }
    this.stream = stream
    const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.playsInline = true; video.srcObject = stream
    container.replaceChildren(video); this.video = video
    await this.waitForVideo(video); if (generation !== this.generation) return
    await video.play(); if (generation !== this.generation) return
    await prepareReader(); this.scheduleDecode(generation, onScan, onError)
  }
  private waitForVideo(video: HTMLVideoElement) {
    if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const done = () => { cleanup(); resolve() }; const timer = setTimeout(() => { cleanup(); reject(new Error('相机视频未准备好，请重试')) }, 10000)
      const cleanup = () => { clearTimeout(timer); video.removeEventListener('loadedmetadata', done); video.removeEventListener('canplay', done) }
      this.cancelVideoWait = () => { cleanup(); resolve() }
      video.addEventListener('loadedmetadata', done, { once: true }); video.addEventListener('canplay', done, { once: true })
    })
  }
  private reportDecodeError(error: unknown, generation: number, onError?: (error: unknown) => void) {
    if (generation === this.generation && Date.now() - this.lastDecodeError > 2000) {
      this.lastDecodeError = Date.now(); onError?.(error)
    }
  }
  private scheduleDecode(generation: number, onScan: (value: string) => void, onError?: (error: unknown) => void) {
    if (generation === this.generation && this.video) {
      this.timer = setTimeout(() => {
        // decode has a few browser APIs (canvas/video) outside the WASM call
        // that can throw synchronously. Never create an unhandled rejection
        // from the timer; the component must retain manual entry and retry.
        void this.decode(generation, onScan, onError).catch(error => this.reportDecodeError(error, generation, onError))
      }, 250)
    }
  }
  private async decode(generation: number, onScan: (value: string) => void, onError?: (error: unknown) => void) {
    if (generation !== this.generation || !this.video || this.decoding) return
    const video = this.video; const width = video.videoWidth || video.clientWidth; const height = video.videoHeight || video.clientHeight
    if (!width || !height) { this.scheduleDecode(generation, onScan, onError); return }
    const canvas = this.canvas ||= document.createElement('canvas'); canvas.width = width; canvas.height = height
    if (!this.context) this.context = canvas.getContext('2d') || undefined
    const context = this.context
    if (!context) { this.reportDecodeError(new Error('浏览器不支持画布读取，请改用 Frappe 内置。'), generation, onError); return }
    context.drawImage(video, 0, 0, width, height); this.decoding = true
    try {
      const { readBarcodes } = await loadZXing(); const results = await readBarcodes(context.getImageData(0, 0, width, height), { maxNumberOfSymbols: 1 })
      if (generation === this.generation && results[0]?.text) onScan(results[0].text)
    } catch (error) {
      // A damaged frame can fail repeatedly. Keep scanning but do not turn the
      // panel into a 4 Hz error announcer.
      this.reportDecodeError(error, generation, onError)
    }
    finally { this.decoding = false; if (generation === this.generation) this.scheduleDecode(generation, onScan, onError) }
  }
  async stop() {
    this.generation++; if (this.timer) clearTimeout(this.timer); this.timer = undefined
    this.cancelVideoWait?.(); this.cancelVideoWait = undefined
    this.video?.pause(); if (this.video) this.video.srcObject = null; this.stream?.getTracks().forEach(track => track.stop())
    this.stream = undefined; this.video = undefined; this.canvas = undefined; this.context = undefined; this.container?.replaceChildren(); this.container = undefined; this.decoding = false; this.lastDecodeError = 0
  }
}

export interface ScannerEngineFactories { frappe: () => ScannerEngine; 'zxing-wasm': () => ScannerEngine }
const STORAGE_KEY = 'temple_inventory.scanner_engine'
const validEngine = (value: string | null): value is ScannerEngineId => value === 'frappe' || value === 'zxing-wasm'
export class ScannerService {
  private selected: ScannerEngineId; private active?: ScannerEngine; private queue = Promise.resolve(); private factories: ScannerEngineFactories; private generation = 0
  constructor(factories: Partial<ScannerEngineFactories> = {}) {
    let stored: string | null = null; try { stored = localStorage.getItem(STORAGE_KEY) } catch { /* storage may be unavailable */ }
    this.selected = validEngine(stored) ? stored : 'zxing-wasm'
    this.factories = { frappe: () => new FrappeScannerEngine(), 'zxing-wasm': () => new ZxingWasmScannerEngine(), ...factories }
  }
  get engineId() { return this.selected }
  get engineLabel() { return this.selected === 'frappe' ? 'Frappe 内置' : 'ZXing-WASM' }
  private enqueue<T>(operation: () => Promise<T>) { const next = this.queue.then(operation, operation); this.queue = next.then(() => undefined, () => undefined); return next }
  start(container: HTMLElement, onScan: (value: string) => void, onError?: (error: unknown) => void) {
    const generation = ++this.generation
    return this.enqueue(async () => {
      if (generation !== this.generation) return
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('相机需要 HTTPS 或 localhost。请使用安全网址，或手动输入。')
      await this.active?.stop(); if (generation !== this.generation) return
      const engine = this.factories[this.selected](); this.active = engine
      try {
        await engine.start(container, onScan, onError)
        if (generation !== this.generation) { if (this.active === engine) this.active = undefined; await engine.stop() }
      } catch (error) { if (this.active === engine) this.active = undefined; await engine.stop(); throw error }
    })
  }
  stop() {
    ++this.generation
    const active = this.active; this.active = undefined
    const stopping = active?.stop() || Promise.resolve()
    return this.enqueue(async () => { await stopping })
  }
  selectEngine(id: ScannerEngineId) {
    if (!validEngine(id)) return Promise.reject(new Error('未知扫描引擎'))
    ++this.generation
    const active = this.active; this.active = undefined
    const stopping = active?.stop() || Promise.resolve()
    return this.enqueue(async () => {
      await stopping
      if (id === this.selected) return
      this.selected = id
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* storage may be unavailable */ }
  }) }
}
