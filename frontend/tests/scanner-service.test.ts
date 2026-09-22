import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScannerService, type ScannerEngine } from '../src/lib/scanner'

function engine(id: ScannerEngine['id'], label = id) {
  return { id, label, start: vi.fn(async () => {}), stop: vi.fn(async () => {}) } satisfies ScannerEngine
}

beforeEach(() => localStorage.clear())

describe('ScannerService', () => {
  it('defaults to ZXing-WASM, validates persisted choices, and persists deliberate switches', async () => {
    const frappe = engine('frappe', 'Frappe 内置'); const wasm = engine('zxing-wasm', 'ZXing-WASM')
    const service = new ScannerService({ frappe: () => frappe, 'zxing-wasm': () => wasm })
    expect(service.engineId).toBe('zxing-wasm'); expect(service.engineLabel).toBe('ZXing-WASM')
    await service.selectEngine('frappe'); expect(service.engineId).toBe('frappe')
    expect(localStorage.getItem('temple_inventory.scanner_engine')).toBe('frappe')
    const restored = new ScannerService({ frappe: () => frappe, 'zxing-wasm': () => wasm })
    expect(restored.engineId).toBe('frappe')
    localStorage.setItem('temple_inventory.scanner_engine', 'other')
    expect(new ScannerService({ frappe: () => frappe, 'zxing-wasm': () => wasm }).engineId).toBe('zxing-wasm')
  })

  it('stops the old engine before starting a switched engine and serializes operations', async () => {
    const frappe = engine('frappe'); const wasm = engine('zxing-wasm'); const order: string[] = []
    frappe.start.mockImplementation(async () => { order.push('frappe start') })
    frappe.stop.mockImplementation(async () => { order.push('frappe stop') })
    wasm.start.mockImplementation(async () => { order.push('wasm start') })
    const service = new ScannerService({ frappe: () => frappe, 'zxing-wasm': () => wasm })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
    await service.start(document.createElement('div'), vi.fn()); await service.selectEngine('frappe'); await service.start(document.createElement('div'), vi.fn())
    expect(order).toEqual(['wasm start', 'frappe start'])
  })

  it('leaves manual callers usable when an engine fails and cleans up the failed engine', async () => {
    const failing = engine('frappe'); failing.start.mockRejectedValue(new Error('load failed'))
    const service = new ScannerService({ frappe: () => failing, 'zxing-wasm': () => engine('zxing-wasm') })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
    await service.selectEngine('frappe')
    await expect(service.start(document.createElement('div'), vi.fn())).rejects.toThrow('load failed')
    expect(failing.stop).toHaveBeenCalledOnce()
  })
})
