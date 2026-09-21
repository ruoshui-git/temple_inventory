import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const zxing = vi.hoisted(() => ({
  prepare: vi.fn(async () => undefined),
  read: vi.fn(async () => [] as Array<{ text?: string }>),
}))

vi.mock('zxing-wasm/reader', () => ({
  prepareZXingModule: zxing.prepare,
  readBarcodes: zxing.read,
}))

import { FrappeScannerEngine, ZxingWasmScannerEngine } from '../src/lib/scanner'

function stream() {
  const track = { stop: vi.fn() }
  return { getTracks: () => [track], track }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers()
  vi.clearAllMocks()
  zxing.prepare.mockResolvedValue(undefined)
  zxing.read.mockResolvedValue([])
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers() })

describe('FrappeScannerEngine', () => {
  it('cleans up a handler when startup rejects and preserves the original failure', async () => {
    const handler = { isScanning: false, start: vi.fn().mockRejectedValue(new Error('camera startup failed')), stop: vi.fn(), clear: vi.fn() }
    class Scanner {
      scan_area_id = 'scan-area'
      start_scan() { this.handler.start() }
      handler: any
      constructor(_options: any) { }
    }
    ;(window as any).jQuery = {}
    ;(window as any).frappe = { ui: { Scanner }, dom: {}, provide: vi.fn() }
    ;(window as any).Html5Qrcode = class { constructor() { return handler as any } }
    vi.spyOn(document.head, 'append').mockImplementation((node: Node) => {
      queueMicrotask(() => (node as HTMLScriptElement).onload?.(new Event('load')))
    })
    const engine = new FrappeScannerEngine()
    const container = document.createElement('div')
    await expect(engine.start(container, vi.fn())).rejects.toThrow('camera startup failed')
    await engine.stop()
    expect(handler.clear).toHaveBeenCalled()
    expect(handler.stop).not.toHaveBeenCalled()
	})

	it('reports a synchronous start_scan failure', async () => {
		;(window as any).jQuery = {}
		;(window as any).Html5Qrcode = class { constructor() { return { start: vi.fn(() => { throw new Error('sync camera startup failed') }), isScanning: false, clear: vi.fn() } as any } }
		const engine = new FrappeScannerEngine()
		await expect(engine.start(document.createElement('div'), vi.fn())).rejects.toThrow('sync camera startup failed')
	})

	it('does not wait for a pending startup during stop', async () => {
		const pending = deferred<void>()
		const handler = { isScanning: false, start: vi.fn(() => pending.promise), stop: vi.fn(), clear: vi.fn() }
		class Scanner {
			scan_area_id = 'scan-area'
			start_scan() { this.handler.start() }
			handler: any
			constructor(_options: any) { }
		}
		;(window as any).jQuery = {}
		;(window as any).frappe = { ui: { Scanner }, dom: {}, provide: vi.fn() }
		;(window as any).Html5Qrcode = class { constructor() { return handler as any } }
		const engine = new FrappeScannerEngine()
		const started = engine.start(document.createElement('div'), vi.fn())
		await Promise.resolve()
		await expect(engine.stop()).resolves.toBeUndefined()
		expect(handler.clear).toHaveBeenCalled()
		pending.resolve()
		await expect(started).resolves.toBeUndefined()
	})
})

describe('ZxingWasmScannerEngine', () => {
  it('initializes the reader with the bundled app-local WASM URL', async () => {
    const current = stream(); (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(current)
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const element = originalCreate(tag, options)
      if (tag === 'video') Object.defineProperties(element, { videoWidth: { value: 640 }, videoHeight: { value: 480 } })
      if (tag === 'canvas') vi.spyOn(element as HTMLCanvasElement, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: vi.fn(() => ({})) } as any)
      return element
    })
    const container = document.createElement('div')
    const engine = new ZxingWasmScannerEngine()
    await engine.start(container, vi.fn())
    expect(zxing.prepare).toHaveBeenCalledWith(expect.objectContaining({
      fireImmediately: true,
      overrides: expect.objectContaining({ locateFile: expect.any(Function) }),
    }))
    const options = zxing.prepare.mock.calls.at(-1)?.[0]
    expect(options.overrides.locateFile()).toMatch(/zxing_reader.*\.wasm$/)
    await engine.stop()
  })

  it('stops tracks when video playback rejects', async () => {
    const current = stream(); (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(current)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(new Error('play rejected'))
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const element = originalCreate(tag, options)
      if (tag === 'video') Object.defineProperties(element, { videoWidth: { value: 640 }, videoHeight: { value: 480 } })
      return element
    })
    await expect(new ZxingWasmScannerEngine().start(document.createElement('div'), vi.fn())).rejects.toThrow('play rejected')
    expect(current.track.stop).toHaveBeenCalled()
  })

  it('cancels a getUserMedia startup and stops a late stream', async () => {
    const pending = deferred<ReturnType<typeof stream>>()
    ;(navigator.mediaDevices.getUserMedia as any).mockReturnValue(pending.promise)
    const engine = new ZxingWasmScannerEngine()
    const started = engine.start(document.createElement('div'), vi.fn())
    await Promise.resolve()
    await engine.stop()
    const current = stream(); pending.resolve(current)
    await expect(started).resolves.toBeUndefined()
    expect(current.track.stop).toHaveBeenCalled()
  })

  it('deduplicates decode errors while continuing the decode loop', async () => {
    const current = stream(); (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(current)
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const element = originalCreate(tag, options)
      if (tag === 'video') Object.defineProperties(element, { videoWidth: { value: 640 }, videoHeight: { value: 480 } })
      if (tag === 'canvas') vi.spyOn(element as HTMLCanvasElement, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: vi.fn(() => ({})) } as any)
      return element
    })
    zxing.read.mockRejectedValue(new Error('bad frame'))
    const error = vi.fn(); const engine = new ZxingWasmScannerEngine()
    await engine.start(document.createElement('div'), vi.fn(), error)
    vi.advanceTimersByTime(250); await Promise.resolve(); await Promise.resolve()
    vi.advanceTimersByTime(250); await Promise.resolve(); await Promise.resolve()
    expect(error).toHaveBeenCalledTimes(1)
    expect(zxing.read).toHaveBeenCalledTimes(2)
    await engine.stop()
  })

  it('decodes ImageData, reuses one canvas, and does not overlap calls', async () => {
    const current = stream()
    ;(navigator.mediaDevices.getUserMedia as any).mockResolvedValue(current)
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(), width: 2, height: 2 })) }
    const originalCreate = document.createElement.bind(document)
    const create = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const element = originalCreate(tag, options)
      if (tag === 'video') Object.defineProperties(element, { videoWidth: { value: 640 }, videoHeight: { value: 480 } })
      if (tag === 'canvas') vi.spyOn(element as HTMLCanvasElement, 'getContext').mockReturnValue(context as any)
      return element
    })
    const first = deferred<Array<{ text?: string }>>()
    zxing.read.mockReturnValueOnce(first.promise).mockResolvedValueOnce([{ text: 'A001' }])
    const scan = vi.fn()
    const engine = new ZxingWasmScannerEngine()
    await engine.start(document.createElement('div'), scan)
    vi.advanceTimersByTime(250)
    await Promise.resolve()
    expect(zxing.read).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(250)
    expect(zxing.read).toHaveBeenCalledOnce()
    first.resolve([])
    await Promise.resolve(); await Promise.resolve()
    vi.advanceTimersByTime(250)
    await Promise.resolve(); await Promise.resolve()
    expect(zxing.read).toHaveBeenCalledTimes(2)
    expect(scan).toHaveBeenCalledWith('A001')
    expect(create.mock.calls.filter(([tag]) => tag === 'canvas')).toHaveLength(1)
    await engine.stop()
    expect(current.track.stop).toHaveBeenCalled()
    create.mockRestore()
  })

  it('reports canvas failures without an unhandled timer rejection', async () => {
    const current = stream()
    ;(navigator.mediaDevices.getUserMedia as any).mockResolvedValue(current)
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const element = originalCreate(tag, options)
      if (tag === 'video') Object.defineProperties(element, { videoWidth: { value: 640 }, videoHeight: { value: 480 } })
      if (tag === 'canvas') vi.spyOn(element as HTMLCanvasElement, 'getContext').mockReturnValue(null)
      return element
    })
    const error = vi.fn()
    const engine = new ZxingWasmScannerEngine()
    await engine.start(document.createElement('div'), vi.fn(), error)
    vi.advanceTimersByTime(250)
    await Promise.resolve()
    expect(error).toHaveBeenCalledWith(expect.any(Error))
    await engine.stop()
  })

  it('suppresses a result that resolves after cancellation', async () => {
    const current = stream(); (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(current)
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const element = originalCreate(tag, options)
      if (tag === 'video') Object.defineProperties(element, { videoWidth: { value: 640 }, videoHeight: { value: 480 } })
      if (tag === 'canvas') vi.spyOn(element as HTMLCanvasElement, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: vi.fn(() => ({})) } as any)
      return element
    })
    const pending = deferred<Array<{ text?: string }>>(); zxing.read.mockReturnValue(pending.promise)
    const scan = vi.fn(); const engine = new ZxingWasmScannerEngine()
    await engine.start(document.createElement('div'), scan); vi.advanceTimersByTime(250); await Promise.resolve()
    await engine.stop(); pending.resolve([{ text: 'STALE' }]); await Promise.resolve(); await Promise.resolve()
    expect(scan).not.toHaveBeenCalled(); expect(current.track.stop).toHaveBeenCalled()
  })
})
